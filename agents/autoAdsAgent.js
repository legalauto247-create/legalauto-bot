/**
 * LegalAuto — Auto Ads Agent v2
 *
 * Читает посты из партнёрских Telegram-каналов, переписывает через Claude
 * и публикует в твой канал/группу с одобрения Эдо.
 *
 * Как работает:
 *  1. Партнёрский канал публикует объявление об авто
 *  2. Бот (добавленный в канал) получает channel_post
 *  3. Claude анализирует — это объявление об авто? Да / нет
 *  4. Если да — переписывает под твою аудиторию
 *  5. Отправляет Эдо на одобрение → кнопки ✅/❌
 *  6. Эдо нажимает ✅ → публикуется в AUTO_ADS_CHANNEL
 *
 * Railway env:
 *   PARTNER_CHANNELS    = "@channel1,@channel2,-1001234567890"  (через запятую)
 *   AUTO_ADS_CHANNEL    = "@твоя_группа" или ID
 *   AUTO_ADS_ENABLED    = "true"
 *
 * Настройка:
 *   Добавь бота (@LegalAutoAssist_bot или @LegalAutoPartsBot) в каждый
 *   партнёрский канал как администратора (права: чтение сообщений).
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch     from 'node-fetch';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { extractPriceFromText } from './priceUtil.js';
import { HEAVY, FAST } from './models.js';

const {
  CLAUDE_API_KEY,
  ADMIN_BOT_TOKEN,
  ADMIN_CHAT_ID,
  AUTO_ADS_CHANNEL,
  AUTO_STORE_BOT_TOKEN,
  PARTNER_CHANNELS,
} = process.env;

// Публикуем в @LegalAutoStore через его собственный бот (он там админ),
// а не через admin-бот, который в канал не добавлен.
const PUBLISH_TOKEN = AUTO_STORE_BOT_TOKEN || ADMIN_BOT_TOKEN;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// Парсим список партнёрских каналов из env
function getPartnerChannels() {
  if (!PARTNER_CHANNELS) return [];
  return PARTNER_CHANNELS.split(',').map(s => s.trim()).filter(Boolean);
}

// Нормализуем ID канала для сравнения (@username → lowercase, числа → строка)
function normalizeChannelId(id) {
  return String(id).toLowerCase().replace(/^@/, '');
}

function isPartnerChannel(chatId, chatUsername) {
  const partners = getPartnerChannels();
  if (!partners.length) return false;

  const normalizedId       = normalizeChannelId(chatId);
  const normalizedUsername = chatUsername ? normalizeChannelId(chatUsername) : '';

  return partners.some(p => {
    const norm = normalizeChannelId(p);
    return norm === normalizedId || norm === normalizedUsername;
  });
}

// ── Дедупликация (не переобрабатываем одно и то же) ────────────────────────
const processedMessageIds = new Set(); // "channelId_messageId"

// ── Ожидающие одобрения объявления ─────────────────────────────────────────
export const pendingAds = new Map(); // id → { text, originalText, channelName }

export function getPendingAd(id)   { return pendingAds.get(String(id)); }
export function clearPendingAd(id) { pendingAds.delete(String(id)); }

// ── Проверка через Claude — это объявление об авто? ────────────────────────
async function isCarListing(text) {
  if (!claude) return isCarListingSimple(text);
  if (text.length < 30) return false;

  try {
    const msg = await claude.messages.create({
      model:      FAST,
      max_tokens: 5,
      messages: [{
        role: 'user',
        content:
          `Это сообщение из Telegram-канала автоимпортёра. Это предложение конкретного автомобиля — продажа, пригон/привоз под заказ, авто в наличии или в пути (есть марка/модель/цена/пробег/год)?\n\n"${text.substring(0, 400)}"\n\nОтветь ТОЛЬКО: ДА или НЕТ. (ДА — если речь о конкретной машине; НЕТ — если это реклама услуги без машины, новость, опрос или приветствие.)`,
      }],
    });
    return msg.content[0].text.trim().toUpperCase().startsWith('ДА');
  } catch {
    return isCarListingSimple(text);
  }
}

// Простая проверка без AI (если Claude недоступен)
function isCarListingSimple(text) {
  const lower = text.toLowerCase();
  const keywords = [
    'продаю', 'продам', 'продаётся', 'продается',
    'авто', 'автомобиль', 'машина', 'машину',
    'год выпуска', 'пробег', 'двигатель',
    'кузов', 'коробка', 'привод',
    'тыс км', 'т.км', 'л.с', 'литра', 'литр',
    'bmw', 'mercedes', 'geely', 'li auto', 'chery',
    'toyota', 'honda', 'hyundai', 'kia', 'audi',
    'volkswagen', 'volvo', 'lexus',
  ];
  return keywords.filter(kw => lower.includes(kw)).length >= 2;
}

// ── Брендинг LegalAutoStore (зашит, не от AI — чужие контакты не просочатся) ─
const BRAND_MANAGER  = process.env.STORE_MANAGER  || '@LegalAuto247';
const BRAND_PHONE    = process.env.STORE_PHONE    || '+79385152429';
const BRAND_WHATSAPP = process.env.STORE_WHATSAPP || '+79385152429';

const BRAND_FOOTER =
  `🎯 LegalAutoStore — гарантированная легальность и надёжность каждого автомобиля! ✅\n\n` +
  `━━━━━━━━━━━━━━━\n` +
  `✅ Менеджер: ${BRAND_MANAGER}\n` +
  `📞 Телефон: ${BRAND_PHONE}\n` +
  `💬 WhatsApp: ${BRAND_WHATSAPP}`;

// Вырезаем ВСЕ чужие контакты из исходника/AI-вывода:
// чужие @юзернеймы, телефоны, ссылки, строки "Заказать/Связаться" партнёра.
function stripForeignContacts(text) {
  const OURS = /^(legalauto|legalautostore|legalauto247|legalautoassist|legalautoparts|legalauto24|legalautopartsbot)/i;
  return text
    .split('\n')
    .map(line => {
      // строки с телефоном / WhatsApp / «Заказать» / «Связаться» источника — убираем целиком
      if (/(\+?\d[\d\s\-()]{8,}\d)/.test(line)) return '';
      if (/заказать|связаться|звоните|пишите|менеджер|контакт|whatsapp|ватсап|телефон/i.test(line) &&
          /@|\d{6,}|t\.me|wa\.me/i.test(line)) return '';
      // вырезаем чужие @юзернеймы и ссылки внутри строки
      let l = line
        .replace(/@([a-z0-9_]+)/gi, (m, u) => OURS.test(u) ? m : '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/t\.me\/\S+/gi, '')
        .replace(/wa\.me\/\S+/gi, '');
      return l;
    })
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === '')) // схлопываем пустые
    .join('\n')
    .trim();
}

// ── Переписать объявление под свой бренд (твои контакты, без конкурента) ─────
// Подставляем/чиним строку цены в готовом посте на точную из источника
function enforcePrice(body, price) {
  if (!price) return body;
  if (/Цена под ключ:/i.test(body)) {
    return body.replace(/Цена под ключ:.*/i, `💰 Цена под ключ: ${price}`);
  }
  return `${body}\n💰 Цена под ключ: ${price}`;
}

async function rewriteForChannel(originalText, channelName) {
  const clean = stripForeignContacts(originalText);
  const price = extractPriceFromText(originalText);   // точная цена из источника
  if (!claude) return enforcePrice(buildFallbackPost(clean, channelName), price);

  try {
    const msg = await claude.messages.create({
      model:      HEAVY,
      max_tokens: 450,
      messages: [{
        role: 'user',
        content:
`Перепиши объявление об авто в фирменный пост канала LegalAutoStore. Строго по шаблону ниже.

ЖЁСТКИЕ ЗАПРЕТЫ:
- НЕ упоминай другие магазины, каналы, @юзернеймы, телефоны, ссылки, имена продавцов из исходника. Только LegalAutoStore.
- НЕ пиши про СБКТС, ЭПТС, "оформим документы", "помощь с документами". Это пост о ПРОДАЖЕ авто, не об услугах.
- НЕ добавляй блок контактов — его добавят автоматически.

ШАБЛОН (заполни данными из исходника, что нет — пропусти строку):
🚗 Автомобиль в продаже

✨ {Марка Модель} — {краткий цепляющий эпитет}!

📋 Технические характеристики:
📅 Год выпуска: {год}
🛣 Пробег: {пробег} км
⛽ Двигатель: {топливо}, {объём} ({л.с} л.с)
🔄 Привод: {привод}

💰 Цена под ключ: ${price || '{цена}'}
🌍 Доставка в РФ: 6-8 недель

ЦЕНА: впиши РОВНО «${price || 'как в исходнике'}», не меняй цифры.

Исходное объявление:
"${clean.substring(0, 700)}"`,
      }],
    });
    const body = enforcePrice(stripForeignContacts(msg.content[0].text.trim()), price);
    return `${body}\n\n${BRAND_FOOTER}`;
  } catch (e) {
    console.error('[AutoAds] Claude rewrite error:', e.message);
    return enforcePrice(buildFallbackPost(clean, channelName), price);
  }
}

function buildFallbackPost(text, channelName) {
  const body = stripForeignContacts(text).substring(0, 600);
  return `🚗 Автомобиль в продаже\n\n${body}\n\n${BRAND_FOOTER}`;
}

// ── Отправить Эдо на одобрение ─────────────────────────────────────────────
async function sendForApproval(rewrittenText, originalText, channelName, photos = []) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.log('[AutoAds] Нет ADMIN_BOT_TOKEN — публикую напрямую');
    return publishAd(rewrittenText, photos);
  }

  const id = `autoads_${Date.now()}`;
  pendingAds.set(id, { text: rewrittenText, originalText, channelName, photos });

  const preview = rewrittenText.length > 350
    ? rewrittenText.substring(0, 350) + '...'
    : rewrittenText;

  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    ADMIN_CHAT_ID,
        text:       `🚗 *Авто из канала "${channelName}"*\n\n${preview}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Опубликовать', callback_data: `autoads_approve_${id}` },
            { text: '❌ Пропустить',   callback_data: `autoads_reject_${id}`  },
            { text: '📄 Оригинал',     callback_data: `autoads_orig_${id}`    },
          ]],
        },
      }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[AutoAds] 📨 На одобрение: ${rewrittenText.substring(0, 60)}`);
    }
    return data.ok;
  } catch (e) {
    console.error('[AutoAds] sendForApproval error:', e.message);
    return false;
  }
}

// Скачиваем фото сами (с таймаутом). Возвращаем Buffer или null, если битое.
async function fetchPhotoBuffer(url) {
  try {
    const ctrl = AbortController ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    const res = await fetch(url, {
      signal: ctrl?.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (t) clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Telegram: фото ≤ 10 МБ; отсекаем пустые/гиганты
    if (buf.length < 1024 || buf.length > 10 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Прямая публикация в канал/группу ───────────────────────────────────────
// Фото скачиваем сами и заливаем БАЙТАМИ (multipart) — Telegram не тянет ссылки,
// поэтому WEBPAGE_CURL_FAILED невозможен. Битые ссылки тихо отсеиваются.
export async function publishAd(text, photos = []) {
  const channel = AUTO_ADS_CHANNEL;
  if (!channel || !PUBLISH_TOKEN) {
    console.log('[AutoAds] AUTO_ADS_CHANNEL или токен публикации не задан');
    return false;
  }
  const caption = text.substring(0, 1024);

  const apiJson = (method, body) =>
    fetch(`https://api.telegram.org/bot${PUBLISH_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());

  // Нативный fetch Node — корректно собирает multipart из нативного FormData/Blob
  const apiForm = (method, form) =>
    globalThis.fetch(`https://api.telegram.org/bot${PUBLISH_TOKEN}/${method}`, {
      method: 'POST', body: form,
    }).then(r => r.json());

  const sendText = async () => {
    const data = await apiJson('sendMessage', {
      chat_id: channel, text, parse_mode: 'Markdown', disable_web_page_preview: true,
    });
    if (data.ok) console.log('[AutoAds] ✅ Опубликовано в канал (текст)');
    else         console.error('[AutoAds] ❌ Ошибка публикации:', data.description);
    return data.ok;
  };

  try {
    const urls = (photos || []).filter(Boolean).slice(0, 10);

    // Скачиваем все фото параллельно, оставляем только рабочие
    const buffers = (await Promise.all(urls.map(fetchPhotoBuffer))).filter(Boolean);
    const dropped = urls.length - buffers.length;
    if (dropped > 0) console.log(`[AutoAds] отсеяно битых фото: ${dropped}/${urls.length}`);

    if (buffers.length === 0) return sendText();

    if (buffers.length === 1) {
      const fd = new FormData();
      fd.append('chat_id', channel);
      fd.append('caption', caption);
      fd.append('parse_mode', 'Markdown');
      fd.append('photo', new Blob([buffers[0]], { type: 'image/jpeg' }), 'p.jpg');
      const data = await apiForm('sendPhoto', fd);
      if (data.ok) { console.log('[AutoAds] ✅ Опубликовано с фото'); return true; }
      console.error('[AutoAds] ❌ sendPhoto:', data.description, '— откат на текст');
      return sendText();
    }

    const fd = new FormData();
    fd.append('chat_id', channel);
    const media = buffers.map((b, i) => ({
      type: 'photo', media: `attach://p${i}`,
      ...(i === 0 ? { caption, parse_mode: 'Markdown' } : {}),
    }));
    fd.append('media', JSON.stringify(media));
    buffers.forEach((b, i) =>
      fd.append(`p${i}`, new Blob([b], { type: 'image/jpeg' }), `p${i}.jpg`));
    const data = await apiForm('sendMediaGroup', fd);
    if (data.ok) { console.log(`[AutoAds] ✅ Опубликовано с ${buffers.length} фото`); return true; }
    console.error('[AutoAds] ❌ sendMediaGroup:', data.description, '— откат на текст');
    return sendText();
  } catch (e) {
    console.error('[AutoAds] publish error:', e.message);
    return sendText();
  }
}

// ── ГЛАВНАЯ ФУНКЦИЯ: вызывается из setupAdminBot/setupClientBot ─────────────
// Подключается к Telegraf боту и слушает channel_post
export function setupAutoAdsListener(bot, botName = 'bot') {
  if (process.env.AUTO_ADS_ENABLED !== 'true') {
    console.log(`[AutoAds] Выключено (AUTO_ADS_ENABLED≠true). Установи в Railway.`);
    return;
  }

  const partners = getPartnerChannels();
  if (!partners.length) {
    console.log('[AutoAds] ⚠️ PARTNER_CHANNELS не задан. Добавь каналы в Railway.');
    return;
  }

  console.log(`[AutoAds] 👂 Слушаю ${partners.length} партнёрских каналов через ${botName}: ${partners.join(', ')}`);

  // Слушаем посты из каналов
  bot.on('channel_post', async (ctx) => {
    try {
      const chat     = ctx.channelPost?.chat;
      const message  = ctx.channelPost;
      const text     = message?.text || message?.caption || '';

      if (!chat || !text) return;

      // Проверяем — это партнёрский канал?
      if (!isPartnerChannel(chat.id, chat.username)) return;

      const msgKey = `${chat.id}_${message.message_id}`;
      if (processedMessageIds.has(msgKey)) return;
      processedMessageIds.add(msgKey);
      // Чистим старые ключи (максимум 500)
      if (processedMessageIds.size > 500) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
      }

      const channelName = chat.title || chat.username || String(chat.id);
      console.log(`[AutoAds] 📩 Пост из "${channelName}": ${text.substring(0, 60)}`);

      // Проверяем — это объявление об авто?
      const isListing = await isCarListing(text);
      if (!isListing) {
        console.log(`[AutoAds] ⏭ Не объявление об авто — пропускаю`);
        return;
      }

      console.log(`[AutoAds] 🚗 Объявление найдено — переписываю через Claude`);
      const rewritten = await rewriteForChannel(text, channelName);
      await sendForApproval(rewritten, text, channelName);

    } catch (e) {
      console.error('[AutoAds] channel_post error:', e.message);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЙ ПОЛЛЕР — читает t.me/s/<канал> без бота-админа
// Работает для любых ПУБЛИЧНЫХ каналов (с @username). Не нужен доступ к каналу.
// ═══════════════════════════════════════════════════════════════════════════

const SEEN_FILE = 'data/autoads_seen.json';

function loadSeen() {
  try {
    if (existsSync(SEEN_FILE)) return JSON.parse(readFileSync(SEEN_FILE, 'utf8'));
  } catch (e) { console.error('[AutoAds] loadSeen:', e.message); }
  return {};
}

function saveSeen(seen) {
  try {
    mkdirSync(dirname(SEEN_FILE), { recursive: true });
    writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  } catch (e) { console.error('[AutoAds] saveSeen:', e.message); }
}

function decodeEntities(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

// Парсим HTML публичной ленты в массив постов { id, num, text, photos[] }
function parsePublicFeed(html, channel) {
  const posts = [];
  // Границы постов — по data-post="channel/NUM"
  const re = /data-post="([^"/]+\/(\d+))"/g;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) marks.push({ id: m[1], num: +m[2], at: m.index });

  for (let i = 0; i < marks.length; i++) {
    const block = html.slice(marks[i].at, marks[i + 1]?.at ?? html.length);

    const tm = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const text = tm ? decodeEntities(tm[1]) : '';

    const photos = [];
    const seenUrls = new Set();
    const pre = /background-image:url\('([^']+)'\)/g;
    let pm;
    while ((pm = pre.exec(block)) !== null) {
      const url = pm[1];
      // Только настоящие фото с CDN Telegram (https://cdn*.telesco.pe/file/...).
      // Эмодзи (//telegram.org/img/emoji/...) и protocol-relative — отсекаем.
      if (!/^https:\/\/[^/]*telesco\.pe\/file\//i.test(url)) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      photos.push(url);
    }

    posts.push({ id: marks[i].id, num: marks[i].num, text, photos });
  }
  return posts;
}

async function fetchPublicFeed(channel) {
  const handle = channel.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').replace(/\/s\//, '');
  const url = `https://t.me/s/${handle}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  const html = await res.text();
  return parsePublicFeed(html, handle);
}

let pollerRunning = false;

export async function pollPublicChannels() {
  if (process.env.AUTO_ADS_ENABLED !== 'true') return;
  if (pollerRunning) return;            // не наслаиваем запуски
  pollerRunning = true;

  try {
    const partners = getPartnerChannels();
    const seen = loadSeen();

    for (const ch of partners) {
      const handle = normalizeChannelId(ch);
      let posts;
      try {
        posts = await fetchPublicFeed(ch);
      } catch (e) {
        console.error(`[AutoAds] poll ${ch}:`, e.message);
        continue;
      }

      const lastSeen = seen[handle] || 0;
      // Холодный старт (после деплоя память пустая): НИЧЕГО не шлём — только
      // запоминаем текущую позицию. Иначе каждый редеплой = спам теми же 5 авто
      // + повторная оплата Claude за переписывание.
      if (lastSeen === 0) {
        seen[handle] = Math.max(...posts.map(p => p.num), 0);
        console.log(`[AutoAds] ${handle}: первый прогон — запомнил позицию ${seen[handle]}, ничего не шлю`);
        continue;
      }
      // Новые посты (которых ещё не присылали), по возрастанию
      const fresh = posts.filter(p => p.num > lastSeen).sort((a, b) => a.num - b.num);
      const batch = fresh;

      if (!batch.length) { seen[handle] = Math.max(lastSeen, ...posts.map(p => p.num), 0); continue; }

      const MAX_PER_RUN = 5;       // присылаем не больше 5 авто за прогон
      let sent = 0, maxProcessed = lastSeen;
      for (const post of batch) {
        if (sent >= MAX_PER_RUN) break;   // остальные подтянем следующим прогоном
        maxProcessed = Math.max(maxProcessed, post.num);
        if (!post.text || post.text.length < 30) continue;
        const isListing = await isCarListing(post.text);
        if (!isListing) { console.log(`[AutoAds] ⏭ ${post.id} не авто`); continue; }

        console.log(`[AutoAds] 🚗 ${post.id} — переписываю (${sent + 1}/${MAX_PER_RUN})`);
        const rewritten = await rewriteForChannel(post.text, ch);
        await sendForApproval(rewritten, post.text, ch, post.photos);
        sent++;
      }
      // seen двигаем только до реально просмотренных — непросмотренные останутся на след. прогон
      seen[handle] = Math.max(lastSeen, maxProcessed);
      console.log(`[AutoAds] ${handle}: отправлено ${sent} авто на одобрение`);
    }

    saveSeen(seen);
  } finally {
    pollerRunning = false;
  }
}

// Запускает периодический опрос публичных лент
export function startPublicChannelPoller(intervalMin = 10) {
  if (process.env.AUTO_ADS_ENABLED !== 'true') {
    console.log('[AutoAds] Поллер выключен (AUTO_ADS_ENABLED≠true)');
    return;
  }
  const partners = getPartnerChannels();
  if (!partners.length) {
    console.log('[AutoAds] ⚠️ PARTNER_CHANNELS не задан — поллер не запущен');
    return;
  }
  console.log(`[AutoAds] 🔄 Публичный поллер: ${partners.join(', ')} каждые ${intervalMin} мин`);
  // первый прогон через 20 сек после старта
  setTimeout(() => pollPublicChannels().catch(e => console.error('[AutoAds] poll:', e.message)), 20_000);
  setInterval(() => pollPublicChannels().catch(e => console.error('[AutoAds] poll:', e.message)), intervalMin * 60_000);
}

// ── Статус для adminBot ─────────────────────────────────────────────────────
export function getAutoAdsStatus() {
  const partners = getPartnerChannels();
  return {
    enabled:  process.env.AUTO_ADS_ENABLED === 'true',
    channel:  AUTO_ADS_CHANNEL || 'не задан',
    partners: partners.length,
    list:     partners,
    pending:  pendingAds.size,
  };
}

console.log('🚗 Auto Ads Agent v2 загружен (режим: Telegram партнёрские каналы)');

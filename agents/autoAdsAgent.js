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

const {
  CLAUDE_API_KEY,
  ADMIN_BOT_TOKEN,
  ADMIN_CHAT_ID,
  AUTO_ADS_CHANNEL,
  PARTNER_CHANNELS,
} = process.env;

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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content:
          `Это сообщение из Telegram-канала. Это объявление о продаже/покупке автомобиля?\n\n"${text.substring(0, 400)}"\n\nОтветь ТОЛЬКО: ДА или НЕТ.`,
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

// ── Переписать объявление под свою аудиторию ───────────────────────────────
async function rewriteForChannel(originalText, channelName) {
  if (!claude) return buildFallbackPost(originalText, channelName);

  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content:
          `Ты ведёшь Telegram-группу по продаже авто. Перепиши это объявление из партнёрского канала "${channelName}" как пост для своей аудитории.

Исходное объявление:
"${originalText.substring(0, 600)}"

Требования:
- Сохрани все технические данные (год, пробег, цена, марка, модель)
- Добавь 2-3 эмодзи
- Стиль: живой, как советует друг-автоэксперт
- Длина: 5-7 строк
- В конце одна из этих строк (выбери подходящую):
  "💬 Помощь с документами → @LegalAuto247"
  "📋 Оформим СБКТС/ЭПТС → @LegalAutoAssist_bot"
  "🚗 Вопросы по авто → @LegalAuto247"
- НЕ добавляй "Источник:" или "Из канала"`,
      }],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.error('[AutoAds] Claude rewrite error:', e.message);
    return buildFallbackPost(originalText, channelName);
  }
}

function buildFallbackPost(text, channelName) {
  return `${text.substring(0, 500)}\n\n💬 Помощь с документами → @LegalAuto247`;
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

// ── Прямая публикация в канал/группу ───────────────────────────────────────
export async function publishAd(text, photos = []) {
  const channel = AUTO_ADS_CHANNEL;
  if (!channel || !ADMIN_BOT_TOKEN) {
    console.log('[AutoAds] AUTO_ADS_CHANNEL или ADMIN_BOT_TOKEN не задан');
    return false;
  }
  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then(r => r.json());

  try {
    // С фото: одно → sendPhoto с подписью, несколько → sendMediaGroup + текст
    const pics = (photos || []).filter(Boolean).slice(0, 10);

    const sendText = async () => {
      const data = await api('sendMessage', {
        chat_id: channel, text, parse_mode: 'Markdown', disable_web_page_preview: true,
      });
      if (data.ok) console.log('[AutoAds] ✅ Опубликовано в канал (текст)');
      else         console.error('[AutoAds] ❌ Ошибка публикации:', data.description);
      return data.ok;
    };

    if (pics.length === 1) {
      const data = await api('sendPhoto', {
        chat_id: channel, photo: pics[0],
        caption: text.substring(0, 1024), parse_mode: 'Markdown',
      });
      if (data.ok) { console.log('[AutoAds] ✅ Опубликовано с фото'); return true; }
      console.error('[AutoAds] ❌ sendPhoto:', data.description, '— откат на текст');
      return sendText();
    }

    if (pics.length > 1) {
      const media = pics.map((url, i) => ({
        type: 'photo', media: url,
        ...(i === 0 ? { caption: text.substring(0, 1024), parse_mode: 'Markdown' } : {}),
      }));
      const data = await api('sendMediaGroup', { chat_id: channel, media });
      if (data.ok) { console.log(`[AutoAds] ✅ Опубликовано с ${pics.length} фото`); return true; }
      console.error('[AutoAds] ❌ sendMediaGroup:', data.description, '— откат на текст');
      return sendText();
    }

    // Без фото — обычный текст
    return sendText();
  } catch (e) {
    console.error('[AutoAds] publish error:', e.message);
    return false;
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
      // только фото-CDN, без аватарок канала (у них /a/ в пути), без дублей
      if (!/cdn|telesco|telegram/i.test(url)) continue;
      if (/\/file\/.*?\/a[a-z]?\//i.test(url)) continue; // аватарки
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
      // Первый запуск: не заваливаем одобрениями — берём только самый свежий пост
      const fresh = posts.filter(p => p.num > lastSeen);
      const toProcess = lastSeen === 0 ? fresh.slice(-1) : fresh;

      if (!toProcess.length) { seen[handle] = Math.max(lastSeen, ...posts.map(p => p.num), 0); continue; }

      for (const post of toProcess) {
        if (!post.text || post.text.length < 30) continue;
        const isListing = await isCarListing(post.text);
        if (!isListing) { console.log(`[AutoAds] ⏭ ${post.id} не авто`); continue; }

        console.log(`[AutoAds] 🚗 ${post.id} — переписываю`);
        const rewritten = await rewriteForChannel(post.text, ch);
        await sendForApproval(rewritten, post.text, ch, post.photos);
      }

      seen[handle] = Math.max(lastSeen, ...posts.map(p => p.num), 0);
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

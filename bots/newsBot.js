/**
 * LegalAuto — News Bot v2
 * Claude Haiku фильтрует RSS → генерирует экспертный пост → публикует в @LegalAuto24
 *
 * Запуск: из index.js каждые 3 часа
 * Публикует не более 2 постов за запуск, не более 4 в сутки
 * Темы: импорт авто, таможня, СБКТС/ЭПТС, параллельный импорт, цены на авто
 */

import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';
import { HEAVY, FAST } from '../agents/models.js';

const {
  CLAUDE_API_KEY,
  ADMIN_BOT_TOKEN,
  NEWS_CHANNEL_ID,   // @LegalAuto24
} = process.env;

const anthropic = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// ── RSS источники (импорт авто, таможня, авторынок РФ) ───────────────────
const RSS_FEEDS = [
  { url: 'https://www.autonews.ru/rss.xml',               topic: 'авторынок импорт Россия' },
  { url: 'https://www.rbc.ru/v10/rss/auto.rss',           topic: 'авторынок RBC' },
  { url: 'https://www.zr.ru/rss.xml',                     topic: 'запчасти авто' },
  { url: 'https://motor.ru/feed',                         topic: 'автоновости' },
  { url: 'https://www.drom.ru/rss/news.xml',              topic: 'авторынок Россия' },
  { url: 'https://kolesa.ru/feed/rss/',                   topic: 'автомобили Россия' },
  { url: 'https://www.avtovzglyad.ru/rss.xml',            topic: 'авто импорт' },
];

// ── Веб-скрапинг сайтов без RSS ───────────────────────────────────────────
// Парсим заголовки и анонсы новостей напрямую с сайтов
async function scrapeWebsite(url, selector) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items = [];
    // Ищем теги <a> с заголовками статей (href + текст)
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]{20,200})<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && items.length < 10) {
      const href = match[1].startsWith('http') ? match[1] : new URL(match[1], url).href;
      const title = match[2].trim().replace(/\s+/g, ' ');
      if (title.length > 20) items.push({ title, link: href, desc: '' });
    }
    return items;
  } catch (e) {
    console.error(`[NewsBot] Скрапинг ${url}: ${e.message}`);
    return [];
  }
}

// Дополнительные сайты через скрапинг
const SCRAPE_SOURCES = [
  { url: 'https://www.autonews.ru/import/',         topic: 'импорт авто Россия' },
  { url: 'https://www.rbc.ru/auto/',                topic: 'авторынок RBC' },
  { url: 'https://dzen.ru/api/v3/feed?channel=auto', topic: 'авто новости Дзен' },
];

// Счётчик постов за сутки (сбрасывается при рестарте)
let dailyCount = 0;
let lastReset  = new Date().toDateString();
const publishedUrls = new Set();

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastReset) { dailyCount = 0; lastReset = today; }
}

// ── RSS парсер ─────────────────────────────────────────────────────────────
function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = get('title');
    const link  = get('link') || get('guid');
    const desc  = get('description');
    if (title && link) items.push({ title, link, desc });
  }
  return items.slice(0, 8);
}

// ── Проверка релевантности (Claude Haiku) ─────────────────────────────────
async function isRelevant(title, desc) {
  if (!anthropic) return false;
  try {
    const msg = await anthropic.messages.create({
      model:      FAST,
      max_tokens: 10,
      messages: [{
        role:    'user',
        content: `Ты фильтр новостей для Telegram-канала @LegalAuto24.
Аудитория: профессиональные импортёры авто (74 компании) — они сами ввозят автомобили в Россию (BMW, Geely, Li Auto, Chery, Haval и др.) и нуждаются в актуальной информации для бизнеса.

ДА — пропускаем новость, если она про:
- Изменения таможенных пошлин или утилизационного сбора на авто
- СБКТС / ЭПТС — новые требования, изменения правил, сроки
- Параллельный импорт: разрешения, ограничения, новые марки
- Цены на авто в Китае (BMW, Geely, Li Auto, Chery, BYD, Haval и др.)
- Ограничения и санкции, влияющие на ввоз авто
- Изменения в таможенном законодательстве РФ
- Документы при ввозе авто (ПТС, постановка на учёт, сертификация)

НЕТ — отклоняем, если это:
- Тест-драйвы, обзоры авто, новые модели для внутреннего рынка
- ОСАГО/КАСКО/страхование
- Городской транспорт, электробусы, метро
- Отечественные марки (Lada, Газель) — если не про параллельный импорт
- Гонки, тюнинг, автоспорт
- Как купить авто (для конечного покупателя, не импортёра)

Новость: "${title}"
Описание: "${(desc||'').substring(0,150)}"

Ответь ТОЛЬКО: ДА или НЕТ.`
      }]
    });
    return msg.content[0].text.trim().toUpperCase().includes('ДА');
  } catch { return false; }
}

// ── Генерация поста (Claude Haiku) ────────────────────────────────────────
async function generatePost(title, link, desc) {
  if (!anthropic) return null;
  try {
    const msg = await anthropic.messages.create({
      model:      HEAVY,
      max_tokens: 450,
      messages: [{
        role:    'user',
        content: `Ты ведёшь Telegram-канал @LegalAuto24 для профессиональных импортёров авто.
Аудитория: 74 компании, которые сами ввозят автомобили в Россию из Китая и Европы. Они хорошо разбираются в теме.
Стиль: экспертный, деловой, конкретный. Без воды и общих слов. 2-3 эмодзи.
Длина: 5-7 строк.
В конце ОБЯЗАТЕЛЬНО: ссылка на источник и "Оформление документов → @LegalAuto247".

Напиши пост на основе новости:
Заголовок: ${title}
Описание: ${(desc||'').substring(0,400)}
Ссылка: ${link}

Обязательно: конкретный совет что делать импортёрам прямо сейчас (ускорить оформление, отложить завоз, пересчитать стоимость и т.д.).
НЕ пиши: "как купить авто", "стоит ли покупать" — они уже занимаются импортом профессионально.`
      }]
    });
    return msg.content[0].text.trim();
  } catch { return null; }
}

// ── Оригинальный пост (без RSS) — полезный контент ─────────────────────────
const ORIGINAL_TOPICS = [
  'Как правильно оформить СБКТС на авто из Китая в 2025 году — пошаговый гайд',
  'Параллельный импорт BMW: что изменилось и как это работает сейчас',
  'Топ-5 ошибок при растаможке авто из Китая — не повторяй их',
  'Geely vs Li Auto vs Chery: что выгоднее везти в Россию в 2025?',
  'Таможенные пошлины на авто в 2025: актуальные ставки и расчёт на примере',
  'ЭПТС для параллельного импорта: полный гайд от А до Я',
  'Как законно сэкономить на ввозе авто из Китая',
  'Утилизационный сбор в 2025: кто платит и сколько',
  'СБКТС vs ЭПТС: в чём разница и что нужно именно тебе',
  'Li Auto L9 в России: сколько стоит растаможить в 2025 году',
  'Что проверить при покупке параллельного импорта BMW',
  'Как ускорить оформление документов на авто из Китая',
  'Черный список ошибок при ввозе Geely: реальные истории клиентов',
  'Новые правила сертификации авто в России 2025 — что изменилось',
  'Стоит ли везти авто самому или через агента? Честное сравнение',
];

async function generateOriginalPost() {
  if (!anthropic) return null;
  const topic = ORIGINAL_TOPICS[Math.floor(Math.random() * ORIGINAL_TOPICS.length)];
  try {
    const msg = await anthropic.messages.create({
      model:      HEAVY,
      max_tokens: 550,
      messages: [{
        role:    'user',
        content: `Ты ведёшь экспертный Telegram-канал @LegalAuto24 для профессиональных импортёров авто.
Аудитория: 74 компании, которые профессионально занимаются ввозом авто в Россию (BMW, Geely, Li Auto, Chery, Haval, BYD и др.).
Они разбираются в теме — пишут для равных, не для новичков.

Напиши экспертный пост-совет на тему: "${topic}"
Стиль: деловой, конкретный, с реальными цифрами и практическими шагами. Эмодзи 2-3 штуки.
Длина: 6-9 строк.
В конце: "Оформление документов → @LegalAuto247".
НЕ объясняй базовые вещи — аудитория профессиональная.`
      }]
    });
    return msg.content[0].text.trim();
  } catch { return null; }
}

// ── Хранилище постов на одобрение ────────────────────────────────────────
const pendingNewsPosts = new Map(); // id → { text, source }

export function getPendingNewsPost(id)        { return pendingNewsPosts.get(String(id)); }
export function clearPendingNewsPost(id)       { pendingNewsPosts.delete(String(id)); }

// ── Прямая публикация в канал (вызывается после одобрения) ────────────────
// Генерим брендовую картинку-новость и постим фото с подписью; если не вышло — текстом.
export async function publishNewsToChannel(text) {
  if (!ADMIN_BOT_TOKEN || !NEWS_CHANNEL_ID) return false;

  const sendText = async () => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id: NEWS_CHANNEL_ID, text, parse_mode: 'Markdown', disable_web_page_preview: false,
        })
      });
      return (await res.json()).ok;
    } catch { return false; }
  };

  try {
    const { renderNewsCard } = await import('../agents/newsImageAgent.js');
    const img = await renderNewsCard(text);
    if (!img) return sendText();
    const caption = text.length > 1024 ? text.slice(0, 1021) + '…' : text;
    const fd = new FormData();
    fd.append('chat_id', String(NEWS_CHANNEL_ID));
    fd.append('caption', caption);
    fd.append('parse_mode', 'Markdown');
    fd.append('photo', new Blob([img], { type: 'image/png' }), 'news.png');
    const res = await globalThis.fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) { console.log('[NewsBot] ✅ Опубликовано с картинкой'); return true; }
    console.error('[NewsBot] sendPhoto:', data.description, '— откат на текст');
    return sendText();
  } catch (e) {
    console.error('[NewsBot] publish image error:', e.message);
    return sendText();
  }
}

// ── Отправка поста на согласование в adminBot ──────────────────────────────
async function sendForApproval(text, source) {
  const { ADMIN_BOT_TOKEN: token, ADMIN_CHAT_ID: chatId } = process.env;
  if (!token || !chatId) {
    console.log('[NewsBot] ADMIN_BOT_TOKEN или ADMIN_CHAT_ID не заданы — публикую напрямую');
    return publishNewsToChannel(text);
  }

  const id = `news_${Date.now()}`;
  pendingNewsPosts.set(id, { text, source });

  const preview = text.length > 300 ? text.substring(0, 300) + '...' : text;
  const approvalMsg = `📰 *Пост для @LegalAuto24* (на согласование)\n\n${preview}\n\n_Источник: ${source || 'AI генерация'}_`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: approvalMsg,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Опубликовать', callback_data: `news_approve_${id}` },
              { text: '❌ Отклонить',    callback_data: `news_reject_${id}`  },
            ],
            [
              { text: '✏️ Редактировать', callback_data: `news_edit_${id}` },
            ]
          ]
        }
      })
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[NewsBot] Пост отправлен на одобрение (id: ${id})`);
      return true;
    }
  } catch (e) {
    console.error('[NewsBot] sendForApproval error:', e.message);
  }
  return false;
}

// ── Основной цикл ──────────────────────────────────────────────────────────
export async function runNewsBot() {
  if (!NEWS_CHANNEL_ID) {
    console.log('[NewsBot] NEWS_CHANNEL_ID не задан — пропуск');
    return;
  }
  if (!anthropic) {
    console.log('[NewsBot] ANTHROPIC_API_KEY не задан — пропуск');
    return;
  }

  resetDailyIfNeeded();
  if (dailyCount >= 4) {
    console.log('[NewsBot] Лимит 4 поста/день достигнут');
    return;
  }

  console.log('[NewsBot] Запуск...');
  let published = 0;
  const maxThisRun = Math.min(2, 4 - dailyCount);

  // Каждый 4-й запуск публикуем оригинальный пост вместо RSS
  const hour = new Date().getUTCHours();
  if (hour === 8 || hour === 17) { // 11:00 и 20:00 МСК
    const post = await generateOriginalPost();
    if (post) {
      const ok = await sendForApproval(post, 'AI генерация');
      if (ok) { dailyCount++; published++; console.log('[NewsBot] ✅ Оригинальный пост → ожидает одобрения'); }
    }
  }

  // Собираем статьи из RSS
  const allItems = [];
  for (const feed of RSS_FEEDS) {
    try {
      const res   = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
      const xml   = await res.text();
      const items = parseRss(xml);
      allItems.push(...items);
    } catch (e) {
      console.error(`[NewsBot] RSS ошибка ${feed.url}: ${e.message}`);
    }
  }

  // Собираем статьи через скрапинг (если RSS не хватило)
  if (allItems.length < 5) {
    for (const src of SCRAPE_SOURCES) {
      const items = await scrapeWebsite(src.url);
      allItems.push(...items);
    }
  }

  // Перемешиваем чтобы не публиковать всегда один и тот же источник
  allItems.sort(() => Math.random() - 0.5);

  for (const item of allItems) {
    if (published >= maxThisRun) break;
    if (publishedUrls.has(item.link)) continue;

    const relevant = await isRelevant(item.title, item.desc);
    if (!relevant) continue;

    const post = await generatePost(item.title, item.link, item.desc);
    if (!post) continue;

    const ok = await sendForApproval(post, item.link);
    if (ok) {
      publishedUrls.add(item.link);
      dailyCount++;
      published++;
      console.log(`[NewsBot] 📨 ${item.title.substring(0, 60)} → ожидает одобрения`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`[NewsBot] Готово. Опубликовано: ${published} / сегодня: ${dailyCount}`);
}

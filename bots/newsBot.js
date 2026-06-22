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

const {
  ANTHROPIC_API_KEY,
  ADMIN_BOT_TOKEN,
  NEWS_CHANNEL_ID,   // @LegalAuto24
} = process.env;

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ── RSS источники (импорт авто, таможня, авторынок РФ) ───────────────────
const RSS_FEEDS = [
  { url: 'https://www.autonews.ru/rss.xml',      topic: 'авторынок импорт Россия' },
  { url: 'https://auto.ru/mag/rss/',              topic: 'автомобили цены' },
  { url: 'https://www.zr.ru/rss.xml',             topic: 'запчасти авто' },
  { url: 'https://www.rbc.ru/v10/rss/auto.rss',   topic: 'авторынок RBC' },
  { url: 'https://car.ru/rss/',                   topic: 'авто новости' },
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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role:    'user',
        content: `Ты фильтр новостей для Telegram-канала LegalAuto (@LegalAuto24).
Аудитория: импортёры авто, перекупщики, владельцы иномарок из Китая/Европы.
Темы канала: ввоз авто в Россию, параллельный импорт, СБКТС/ЭПТС, таможенные пошлины, цены на авто, BMW/Geely/Li Auto/Chery.

Новость: "${title}"
Описание: "${(desc||'').substring(0,150)}"

Ответь ТОЛЬКО одним словом: ДА или НЕТ.`
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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role:    'user',
        content: `Ты ведёшь Telegram-канал @LegalAuto24 для импортёров автомобилей в Россию.
Стиль: экспертный, живой, полезный. Эмодзи — 2-3 штуки. Без воды.
Длина: 4-6 строк. В конце — ссылка на источник.

Напиши пост на основе этой новости:
Заголовок: ${title}
Описание: ${(desc||'').substring(0,400)}
Ссылка: ${link}

Обязательно добавь вывод/совет для импортёров авто.`
      }]
    });
    return msg.content[0].text.trim();
  } catch { return null; }
}

// ── Оригинальный пост (без RSS) — полезный контент ─────────────────────────
async function generateOriginalPost() {
  if (!anthropic) return null;
  const topics = [
    'Как правильно оформить СБКТС на авто из Китая в 2024-2025 году — пошаговый гайд',
    'Параллельный импорт BMW: что изменилось и как это работает сейчас',
    'Топ-5 ошибок при растаможке авто из Китая',
    'Geely vs Li Auto vs Chery: что выгоднее везти в Россию в 2025?',
    'Таможенные пошлины на авто в 2025: актуальные ставки и расчёт',
    'ЭПТС для параллельного импорта: полный гайд',
    'Как сэкономить на ввозе авто: легальные способы',
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role:    'user',
        content: `Ты ведёшь Telegram-канал @LegalAuto24 для импортёров автомобилей.
Напиши экспертный пост на тему: "${topic}"
Стиль: практичный, конкретный, с цифрами где уместно. Эмодзи 2-3 штуки.
Длина: 5-8 строк. В конце призыв написать в @LegalAutoAssist_bot для консультации.`
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
export async function publishNewsToChannel(text) {
  if (!ADMIN_BOT_TOKEN || !NEWS_CHANNEL_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:                  NEWS_CHANNEL_ID,
        text,
        parse_mode:               'Markdown',
        disable_web_page_preview: false,
      })
    });
    const data = await res.json();
    return data.ok;
  } catch { return false; }
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

  // RSS новости
  for (const feed of RSS_FEEDS) {
    if (published >= maxThisRun) break;
    try {
      const res   = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
      const xml   = await res.text();
      const items = parseRss(xml);

      for (const item of items) {
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
    } catch (e) {
      console.error(`[NewsBot] RSS ошибка ${feed.url}: ${e.message}`);
    }
  }

  console.log(`[NewsBot] Готово. Опубликовано: ${published} / сегодня: ${dailyCount}`);
}

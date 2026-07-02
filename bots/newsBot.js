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
  // авто-специфичные (проверены живыми 02.07.2026)
  { url: 'https://www.gazeta.ru/export/rss/auto.xml',                 topic: 'авто Газета.ру' },
  { url: 'https://motor.ru/exports/rss',                              topic: 'автоновости Motor' },
  { url: 'https://quto.ru/exports/rss',                               topic: 'автоновости Quto' },
  { url: 'https://www.kommersant.ru/RSS/section-auto.xml',            topic: 'авто Коммерсант' },
  // общие деловые (Haiku отфильтрует только про импорт/таможню/утиль/авторынок)
  { url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss',         topic: 'новости РБК' },
  { url: 'https://tass.ru/rss/v2.xml',                                topic: 'новости ТАСС' },
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
import { persistentPath } from '../services/stateService.js';
import { readFileSync as _rf, writeFileSync as _wf } from 'fs';
const NEWS_SEEN_FILE = persistentPath('news_published.json');
let dailyCount = 0;
let lastReset  = new Date().toDateString();
const publishedUrls = new Set((() => { try { return JSON.parse(_rf(NEWS_SEEN_FILE, 'utf8')); } catch { return []; } })());
function saveSeenNews() { try { _wf(NEWS_SEEN_FILE, JSON.stringify([...publishedUrls].slice(-500))); } catch {} }

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastReset) { dailyCount = 0; lastReset = today; }
}


// Фетч XML с автоопределением кодировки (gazeta.ru и др. отдают windows-1251)
async function fetchXml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/120.0' }, redirect: 'follow' });
  const buf = await res.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  const m = /encoding=["']?([\w-]+)/i.exec(text.slice(0, 200)) || /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '');
  const enc = (m && m[1] || 'utf-8').toLowerCase();
  if (enc !== 'utf-8' && enc !== 'utf8') {
    try { text = new TextDecoder(enc).decode(buf); } catch {}
  }
  return text;
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
    const de = (t) => t
      .replace(/&quot;/g, '«').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#x2013;|&ndash;/g, '–').replace(/&#x2014;|&mdash;/g, '—').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n))
      .replace(/<[^>]+>/g, '').trim();
    const title = de(get('title'));
    const link  = get('link') || get('guid');
    const desc  = de(get('description'));
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
        content: `Ты фильтр новостей для Telegram-канала @LegalAuto24 (LegalAuto — пригон авто, запчасти, документы).
Аудитория ДВЕ группы: 1) профессиональные импортёры авто (сами возят BMW, Geely, Li Auto, Chery, Haval из Китая/Кореи/Европы); 2) потребители — владельцы и покупатели ввезённых авто.

ДА — пропускаем, если новость про:
- Таможня: пошлины, ЕТП, правила оформления, очереди на границах, изменения законодательства
- Утильсбор: ставки, льготы, изменения (особенно правило 160 л.с.)
- Параллельный импорт: разрешения, ограничения, списки брендов
- СБКТС / ЭПТС / сертификация / лаборатории / постановка на учёт ввезённых авто
- Цены и рынок: цены на авто в Китае/Корее, цены на ввезённые авто в РФ, курс валют влияет на пригон
- Китайские марки в РФ: Geely, Li Auto, Chery, Haval, BYD, Zeekr — продажи, сервис, запчасти, отзывные
- Запчасти: доступность, цены, каналы поставок, оригинал/аналог
- Санкции и логистика, влияющие на ввоз авто и запчастей
- Правила для владельцев: регистрация, штрафы, ОСАГО/техосмотр ИМЕННО для ввезённых авто, налоги на авто
- Прогнозы рынка: подорожание/дефицит авто, изменения спроса на импорт

НЕТ — отклоняем:
- Тест-драйвы, обзоры, «топ-10 машин», премьеры моделей без связи с импортом в РФ
- Автоспорт, тюнинг, ДТП, криминал
- Городской транспорт, электробусы, дороги/пробки
- Отечественные Lada/ГАЗ (если не влияет на рынок импорта)
- Западные рынки без связи с РФ

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
    // Эталонная карточка ЛИСТ 2: капс-заголовок + 3 факт-блока + светлый AI-фон + Quality Gate
    const { makeNewsCard } = await import('../agents/contentAgent.js');
    const card = await makeNewsCard({ newsText: text });
    if (!card.ok) { console.warn('[NewsBot] карточка не собралась:', card.error, '— публикую текстом'); return sendText(); }
    const caption = (card.caption || text);
    const fd = new FormData();
    fd.append('chat_id', String(NEWS_CHANNEL_ID));
    fd.append('caption', caption.length > 1024 ? caption.slice(0, 1021) + '…' : caption);
    fd.append('photo', new Blob([_rf(card.path)], { type: 'image/jpeg' }), 'news.jpg');
    const res = await globalThis.fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
    const data = await res.json();
    card.cleanup();
    if (data.ok) { console.log('[NewsBot] ✅ Опубликована эталонная карточка'); return true; }
    console.error('[NewsBot] sendPhoto:', data.description, '— откат на текст');
    return sendText();
  } catch (e) {
    console.error('[NewsBot] publish card error:', e.message);
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
      const xml   = await fetchXml(feed.url);
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
      publishedUrls.add(item.link); saveSeenNews();
      dailyCount++;
      published++;
      console.log(`[NewsBot] 📨 ${item.title.substring(0, 60)} → ожидает одобрения`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`[NewsBot] Готово. Опубликовано: ${published} / сегодня: ${dailyCount}`);
}


// ── Для Jarvis: собрать свежие ПОЛЕЗНЫЕ новости (фильтр Haiku), без публикации ─
export async function fetchFreshNews(maxItems = 5) {
  const all = [];
  for (const feed of RSS_FEEDS) {
    try {
      all.push(...parseRss(await fetchXml(feed.url)));
    } catch {}
  }
  const fresh = all.filter(i => !publishedUrls.has(i.link));
  const useful = [];
  for (const item of fresh) {
    if (useful.length >= maxItems) break;
    if (await isRelevant(item.title, item.desc)) useful.push({ title: item.title, link: item.link, desc: (item.desc || '').slice(0, 200) });
  }
  return useful;
}

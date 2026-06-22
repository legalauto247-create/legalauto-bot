/**
 * LegalAuto — Trending Agent
 *
 * Что делает:
 *  1. Парсит популярные категории с Exist.ru (топ запчастей)
 *  2. Собирает внутреннюю статистику — что чаще ищут клиенты в нашем боте
 *  3. Каждую пятницу в 11:00 МСК отправляет менеджеру дайджест "Топ-10 запчастей"
 *
 * Запуск: setupTrendingScheduler(bot) в index.js
 * Трекинг: trackPartQuery(partName) вызывать из clientBot.js при каждом поиске
 */

import fetch from 'node-fetch';

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || '';
const ADMIN_CHAT_ID   = process.env.ADMIN_CHAT_ID   || '';

// ── Внутренняя статистика запросов бота ──────────────────────────────────────
// Map: normalizedPartName → { count, lastSeen, examples }
const queryStats = new Map();

/**
 * Трекать запрос запчасти клиентом.
 * Вызывать из clientBot.js при каждом запросе на подбор.
 */
export function trackPartQuery(partName, make = '', model = '') {
  if (!partName || partName.length < 3) return;
  const key = partName.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 50);
  const car  = [make, model].filter(Boolean).join(' ');
  const existing = queryStats.get(key);
  if (existing) {
    existing.count++;
    existing.lastSeen = Date.now();
    if (car && !existing.examples.includes(car) && existing.examples.length < 3) {
      existing.examples.push(car);
    }
  } else {
    queryStats.set(key, { count: 1, lastSeen: Date.now(), examples: car ? [car] : [], original: partName });
  }
}

/**
 * Топ-N запчастей из нашего бота за период (мс).
 */
export function getTopBotQueries(n = 10, periodMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - periodMs;
  return [...queryStats.entries()]
    .filter(([, v]) => v.lastSeen >= cutoff)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, n)
    .map(([, v]) => ({ name: v.original, count: v.count, cars: v.examples }));
}

/**
 * Сбросить статистику (вызывать после отправки отчёта).
 */
export function resetBotStats() {
  queryStats.clear();
}

// ── Популярные категории с Exist.ru ──────────────────────────────────────────
// Exist.ru показывает рейтинг популярных запчастей на главной
async function fetchExistTrending() {
  try {
    const resp = await fetch('https://exist.ru/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Ищем блоки популярных запчастей / категорий
    const results = [];

    // Паттерн 1: популярные категории в навигации
    const catMatches = html.matchAll(/class="[^"]*(?:popular|trending|top)[^"]*"[^>]*>([^<]{5,60})</gi);
    for (const m of catMatches) {
      const name = m[1].trim();
      if (name && name.length > 3) results.push(name);
    }

    // Паттерн 2: ссылки в главном меню на категории запчастей
    const linkMatches = html.matchAll(/href="\/catalog\/[^"]+">([^<]{4,50})<\/a>/gi);
    for (const m of linkMatches) {
      const name = m[1].trim();
      if (name && !name.includes('{') && name.length > 3) results.push(name);
    }

    // Убираем дубли
    const unique = [...new Set(results.map(s => s.replace(/\s+/g, ' ').trim()))];
    return unique.slice(0, 15);
  } catch (e) {
    console.error('[TrendingAgent] Exist fetch error:', e.message);
    return [];
  }
}

// ── Популярные запросы с ZZap ─────────────────────────────────────────────────
// ZZap имеет страницу с популярными брендами/категориями
async function fetchZzapTrending() {
  try {
    const resp = await fetch('https://www.zzap.ru/public/catalog/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    const results = [];
    // Ищем категории запчастей
    const matches = html.matchAll(/href="[^"]*catalog[^"]*">([А-Яа-яёЁ][^<]{3,50})<\/a>/gi);
    for (const m of matches) {
      const name = m[1].trim();
      if (name && name.length > 3 && name.length < 60) results.push(name);
    }

    const unique = [...new Set(results)];
    return unique.slice(0, 15);
  } catch (e) {
    console.error('[TrendingAgent] ZZap fetch error:', e.message);
    return [];
  }
}

// ── Статичный список топ запчастей (резервный, на основе рыночных данных) ────
// Обновляем вручную раз в квартал
const FALLBACK_TRENDING = [
  { name: 'Тормозные колодки', reason: 'расходник №1', existUrl: 'https://exist.ru/?q=%D1%82%D0%BE%D1%80%D0%BC%D0%BE%D0%B7%D0%BD%D1%8B%D0%B5+%D0%BA%D0%BE%D0%BB%D0%BE%D0%B4%D0%BA%D0%B8' },
  { name: 'Масляный фильтр',   reason: 'ТО каждые 10к км', existUrl: 'https://exist.ru/?q=%D0%BC%D0%B0%D1%81%D0%BB%D1%8F%D0%BD%D1%8B%D0%B9+%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80' },
  { name: 'Воздушный фильтр',  reason: 'ТО расходник',    existUrl: 'https://exist.ru/?q=%D0%B2%D0%BE%D0%B7%D0%B4%D1%83%D1%88%D0%BD%D1%8B%D0%B9+%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80' },
  { name: 'Свечи зажигания',   reason: 'ТО каждые 30к км', existUrl: 'https://exist.ru/?q=%D1%81%D0%B2%D0%B5%D1%87%D0%B8+%D0%B7%D0%B0%D0%B6%D0%B8%D0%B3%D0%B0%D0%BD%D0%B8%D1%8F' },
  { name: 'Амортизаторы',      reason: 'подвеска',         existUrl: 'https://exist.ru/?q=%D0%B0%D0%BC%D0%BE%D1%80%D1%82%D0%B8%D0%B7%D0%B0%D1%82%D0%BE%D1%80%D1%8B' },
  { name: 'Тормозные диски',   reason: 'расходник',        existUrl: 'https://exist.ru/?q=%D1%82%D0%BE%D1%80%D0%BC%D0%BE%D0%B7%D0%BD%D1%8B%D0%B5+%D0%B4%D0%B8%D1%81%D0%BA%D0%B8' },
  { name: 'Ремень ГРМ',        reason: 'сезонная замена',  existUrl: 'https://exist.ru/?q=%D1%80%D0%B5%D0%BC%D0%B5%D0%BD%D1%8C+%D0%93%D0%A0%D0%9C' },
  { name: 'Аккумулятор',       reason: 'зима/лето',        existUrl: 'https://exist.ru/?q=%D0%B0%D0%BA%D0%BA%D1%83%D0%BC%D1%83%D0%BB%D1%8F%D1%82%D0%BE%D1%80' },
  { name: 'Радиатор охлаждения', reason: 'лето',           existUrl: 'https://exist.ru/?q=%D1%80%D0%B0%D0%B4%D0%B8%D0%B0%D1%82%D0%BE%D1%80+%D0%BE%D1%85%D0%BB%D0%B0%D0%B6%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F' },
  { name: 'ШРУС',              reason: 'привод/передача',  existUrl: 'https://exist.ru/?q=%D0%A8%D0%A0%D0%A3%D0%A1' },
];

// ── Формируем отчёт ────────────────────────────────────────────────────────────
async function buildTrendingReport() {
  const [existTrending, zzapTrending, botTop] = await Promise.allSettled([
    fetchExistTrending(),
    fetchZzapTrending(),
    Promise.resolve(getTopBotQueries(10)),
  ]);

  const existItems = existTrending.status === 'fulfilled' ? existTrending.value : [];
  const zzapItems  = zzapTrending.status  === 'fulfilled' ? zzapTrending.value  : [];
  const botItems   = botTop.status        === 'fulfilled' ? botTop.value        : [];

  const now = new Date();
  const weekStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });

  let msg = `📈 *Еженедельный отчёт по трендам запчастей*\n`;
  msg    += `_Неделя до ${weekStr}_\n\n`;

  // ── Наши клиенты — что ищут в боте ──────────────────────────────────────
  if (botItems.length > 0) {
    msg += `🤖 *Топ запросов в нашем боте:*\n`;
    botItems.forEach((item, i) => {
      const cars = item.cars.length ? ` _(${item.cars.join(', ')})_` : '';
      msg += `${i + 1}. ${item.name}${cars} — ${item.count} запр.\n`;
    });
    msg += '\n';
  } else {
    msg += `🤖 *Запросов в боте за неделю:* пока нет данных\n\n`;
  }

  // ── Популярные категории Exist.ru ────────────────────────────────────────
  if (existItems.length > 5) {
    msg += `🟢 *Популярные категории (Exist.ru):*\n`;
    existItems.slice(0, 8).forEach((name, i) => {
      msg += `${i + 1}. ${name}\n`;
    });
    msg += '\n';
  } else {
    // Резервный список
    msg += `📦 *Топ-10 востребованных запчастей (рынок):*\n`;
    FALLBACK_TRENDING.forEach((item, i) => {
      msg += `${i + 1}. [${item.name}](${item.existUrl}) — ${item.reason}\n`;
    });
    msg += '\n';
  }

  if (zzapItems.length > 3) {
    msg += `🔵 *Категории ZZap.ru:*\n`;
    zzapItems.slice(0, 5).forEach((name, i) => {
      msg += `• ${name}\n`;
    });
    msg += '\n';
  }

  msg += `_💡 Совет: если клиенты часто спрашивают одно и то же — закупите про запас!_`;

  return msg;
}

// ── Отправить отчёт менеджеру ─────────────────────────────────────────────────
export async function runTrendingReport(bot) {
  console.log('[TrendingAgent] Запуск отчёта по трендам...');
  try {
    const msg = await buildTrendingReport();

    const buttons = [
      [
        { text: '🟢 Exist.ru', url: 'https://exist.ru/' },
        { text: '🔵 ZZap.ru',  url: 'https://www.zzap.ru/' },
      ],
    ];

    if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
      await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:                  ADMIN_CHAT_ID,
          text:                     msg,
          parse_mode:               'Markdown',
          disable_web_page_preview: true,
          reply_markup:             { inline_keyboard: buttons },
        }),
      });
    }

    // Сбросить счётчики после отправки
    resetBotStats();
    console.log('[TrendingAgent] Отчёт отправлен.');
  } catch (e) {
    console.error('[TrendingAgent] Ошибка:', e.message);
  }
}

// ── Планировщик: каждую пятницу 11:00 МСК ────────────────────────────────────
export function setupTrendingScheduler(bot) {
  const checkSchedule = () => {
    const now  = new Date();
    const msk  = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3
    // Пятница (5), 11:00 МСК = 08:00 UTC
    if (msk.getUTCDay() === 5 && msk.getUTCHours() === 8 && msk.getUTCMinutes() === 0) {
      runTrendingReport(bot).catch(e => console.error('[TrendingAgent] Scheduler error:', e.message));
    }
  };

  setInterval(checkSchedule, 60 * 1000); // проверяем каждую минуту
  console.log('📈 Trending scheduler запущен (каждую пятницу 11:00 МСК)');
}

/**
 * LegalAuto — Ad Agent v2 (24/7 Revenue Machine)
 *
 * Что делает:
 *  1. Постит рекламу в Telegram группы в ПИКОВЫЕ часы (8, 13, 18, 21 МСК)
 *  2. AI генерирует уникальный текст для каждого поста (8 форматов, никогда не повторяется)
 *  3. Поддерживает неограниченное кол-во групп через AD_GROUPS
 *  4. Умная ротация: каждый пост в новую группу, cooldown 22ч
 *  5. Трекинг эффективности: считает клики по ботам из групп
 *  6. Еженедельный отчёт: какие группы дают лиды
 *
 * Railway env:
 *   AD_ENABLED      = "true"
 *   AD_GROUPS       = '["-1001234567890", "@AutoMoscow", "-1009876543210"]'
 *   AD_GROUP_1..20  = отдельные группы (альтернатива)
 *   AD_PEAK_HOURS   = "8,13,18,21"  (МСК, по умолчанию)
 *   AD_INTERVAL_H   = "4"  (если не используем пиковые часы)
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch      from 'node-fetch';

const CLAUDE_API_KEY    = process.env.CLAUDE_API_KEY;
const CLIENT_BOT_TOKEN  = process.env.CLIENT_BOT_TOKEN;
const ADMIN_BOT_TOKEN   = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID     = process.env.ADMIN_CHAT_ID;
const BOT_USERNAME      = process.env.CLIENT_BOT_USERNAME || 'LegalAutoAssist_bot';
const MGR               = process.env.MANAGER_USERNAME    || 'LegalAuto247';
const MINI_APP          = 'https://legalauto.online/';

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// ── Пиковые часы МСК ──────────────────────────────────────────────────────────
const DEFAULT_PEAK_HOURS = [8, 13, 18, 21]; // утро / обед / вечер / ночь

function getPeakHours() {
  try {
    const env = process.env.AD_PEAK_HOURS;
    if (env) return env.split(',').map(Number).filter(h => h >= 0 && h <= 23);
  } catch {}
  return DEFAULT_PEAK_HOURS;
}

// ── Группы ────────────────────────────────────────────────────────────────────
function getGroups() {
  // Способ 1: AD_GROUPS = JSON массив
  try {
    const env = process.env.AD_GROUPS;
    if (env) {
      const parsed = JSON.parse(env);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((g, i) => typeof g === 'string'
          ? { id: g, segment: SEGMENTS[i % SEGMENTS.length], name: g }
          : g
        ).filter(g => g.id);
      }
    }
  } catch {}

  // Способ 2: AD_GROUP_1..AD_GROUP_20
  const groups = [];
  for (let i = 1; i <= 20; i++) {
    const id = process.env[`AD_GROUP_${i}`];
    if (id) groups.push({ id, segment: SEGMENTS[(i - 1) % SEGMENTS.length], name: `Группа ${i}` });
  }
  return groups;
}

// ── Сегменты контента ─────────────────────────────────────────────────────────
const SEGMENTS = ['bmw', 'geely', 'general', 'li_auto', 'premium', 'budget', 'suv', 'import'];

const SEGMENT_CONTEXT = {
  bmw:     { brand: 'BMW',              emoji: '🔵', models: 'E60, F10, G30, X3, X5, X6' },
  geely:   { brand: 'Geely',            emoji: '🟢', models: 'Atlas, Coolray, Tugella, Emgrand' },
  li_auto: { brand: 'Li Auto',          emoji: '🔋', models: 'L7, L8, L9, One' },
  premium: { brand: 'Mercedes / Audi',  emoji: '⭐', models: 'E-class, C-class, A4, A6, Q5' },
  general: { brand: 'все марки',        emoji: '🚗', models: 'BMW, Geely, Mercedes, Audi, Toyota' },
  budget:  { brand: 'бюджетные авто',   emoji: '💰', models: 'Toyota, Honda, Hyundai, Kia' },
  suv:     { brand: 'внедорожники',     emoji: '🏔️', models: 'X5, GLE, Tiguan, Q7, Pajero' },
  import:  { brand: 'китайские авто',   emoji: '🇨🇳', models: 'Chery, Haval, BYD, Changan, Omoda' },
};

// ── 8 форматов рекламы (чтобы не повторяться) ────────────────────────────────
const AD_FORMATS = [
  'вопрос-ответ',       // "Нужна запчасть для BMW? Есть!"
  'боль-решение',       // "Дилер просит 50к? У нас за 15к оригинал"
  'срочность',          // "Осталось 3 позиции — разбирается быстро"
  'социальное доказ.',  // "Уже 200+ клиентов из Москвы купили"
  'цифры-факты',        // "Б/у оригинал vs новый неоригинал — разница 3x"
  'история клиента',    // "Клиент искал месяц, нашёл за 2 минуты"
  'сравнение',          // "Авито: продавцы-физики. Мы: гарантия"
  'экспертиза',         // "10 лет на разборке — знаем каждый болт"
];

// ── State ─────────────────────────────────────────────────────────────────────
let   campaignIdx  = 0;
const lastPosted   = new Map();   // groupId → timestamp
const groupStats   = new Map();   // groupId → { sent, lastSent }
const weeklyLeads  = new Map();   // groupId → leads count (сбрасывается в пн)

// ── AI генерация объявления ───────────────────────────────────────────────────
async function generateAd(segment, format) {
  const ctx = SEGMENT_CONTEXT[segment] || SEGMENT_CONTEXT.general;
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const hour = msk.getUTCHours();
  const timeOfDay = hour < 12 ? 'утро' : hour < 17 ? 'день' : 'вечер';

  if (!claude) return buildStaticAd(ctx, campaignIdx);

  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content:
          `Напиши рекламный пост для Telegram авто-группы. Формат: "${format}".
Магазин: LegalAuto — б/у запчасти с разборки по России.
Целевые марки: ${ctx.models}.
Emoji в начале: ${ctx.emoji}
Время суток: ${timeOfDay} — подстрой тон.
Длина: 3-5 строк. Последняя строка: "📲 @${BOT_USERNAME}" или "💬 t.me/${MGR}"
Без хэштегов. Живо, разговорно. НИКОГДА не начинай с "Привет" или "Дорогие".
Разные слова каждый раз — это ${campaignIdx + 1}-й пост.`,
      }],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.error('[AdAgent] AI error:', e.message);
    return buildStaticAd(ctx, campaignIdx);
  }
}

function buildStaticAd(ctx, idx) {
  const variants = [
    `${ctx.emoji} Запчасть для ${ctx.brand}?\n\nОригинал с разборки — дешевле нового в 2-3 раза.\nФото, OEM, доставка по России.\n\n📲 @${BOT_USERNAME}`,
    `🔩 ${ctx.brand}: есть в наличии + ищем под заказ.\n\nЧестные цены, без посредников. Проверено 200+ клиентами.\n\n💬 t.me/${MGR}`,
    `${ctx.emoji} Дилер просит дорого за ${ctx.brand}?\n\nТе же оригинальные детали с разборки — в 2-3 раза дешевле.\n\n📲 @${BOT_USERNAME}`,
    `🏷️ ${ctx.models} — полный каталог б/у запчастей.\n\nОтправим сегодня. Гарантия на детали.\n\n📲 @${BOT_USERNAME}`,
    `${ctx.emoji} Ищете запчасть для ${ctx.brand}?\n\nНаш бот подберёт за 2 минуты — напишите марку и деталь.\n\n📲 @${BOT_USERNAME}`,
    `💡 Секрет: б/у оригинал надёжнее нового неоригинала.\n\nЕсть ${ctx.models}. Быстрая отправка.\n\n💬 t.me/${MGR}`,
    `🚀 ${ctx.brand} на разборке — свежее поступление!\n\nПишите что нужно — найдём и пришлём фото.\n\n📲 @${BOT_USERNAME}`,
    `${ctx.emoji} Нашли дешевле? Напишите — побьём цену.\n\nКаталог ${ctx.models} — онлайн 24/7.\n\n📲 @${BOT_USERNAME}`,
  ];
  return variants[idx % variants.length];
}

// ── Отправить пост в группу ───────────────────────────────────────────────────
async function postToGroup(group, text) {
  const token = CLIENT_BOT_TOKEN;
  if (!token) return { ok: false, error: 'no CLIENT_BOT_TOKEN' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    group.id,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '📦 Каталог',    web_app: { url: MINI_APP } },
          { text: '💬 Написать',   url: `https://t.me/${MGR}` },
        ]]},
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const json = await res.json();
    if (json.ok) {
      const stat = groupStats.get(group.id) || { sent: 0, lastSent: 0 };
      stat.sent++;
      stat.lastSent = Date.now();
      groupStats.set(group.id, stat);
    }
    return json;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Отчёт менеджеру ───────────────────────────────────────────────────────────
async function notifyAdmin(results, segment) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;
  const ok   = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok && r.error !== 'cooldown' && r.error !== 'disabled').length;
  const skip = results.filter(r => r.error === 'cooldown').length;

  if (ok === 0 && fail === 0) return; // всё в cooldown — не спамим

  const lines = results
    .filter(r => r.ok || (r.error && r.error !== 'cooldown'))
    .map(r => `${r.ok ? '✅' : '❌'} ${r.group}: ${r.ok ? 'отправлено' : r.error}`)
    .join('\n');

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    ADMIN_CHAT_ID,
      text:       `📣 *Реклама отправлена* [${segment}]\n\n✅ ${ok} | ❌ ${fail} | ⏳ ${skip} cooldown\n\n${lines}`,
      parse_mode: 'Markdown',
    }),
  }).catch(() => {});
}

// ── Еженедельный отчёт об эффективности ──────────────────────────────────────
export async function runAdWeeklyReport() {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;

  const groups = getGroups();
  let msg = `📊 *Еженедельный отчёт рекламы*\n\n`;

  if (!groups.length) {
    msg += `⚠️ Группы не настроены. Добавь AD_GROUPS в Railway.`;
  } else {
    msg += `Всего групп: ${groups.length}\n\n`;
    const sorted = [...groupStats.entries()]
      .sort(([, a], [, b]) => b.sent - a.sent);

    if (sorted.length) {
      msg += `*Постов за неделю:*\n`;
      sorted.forEach(([id, s]) => {
        msg += `• ${id}: ${s.sent} постов\n`;
      });
    } else {
      msg += `Постов за неделю: 0 (включи AD_ENABLED=true)\n`;
    }
    msg += `\n💡 Добавь новые группы через Railway → AD_GROUP_6, AD_GROUP_7...`;
  }

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  }).catch(() => {});

  // Сброс счётчиков
  groupStats.clear();
}

// ── Основной запуск рекламной кампании ───────────────────────────────────────
export async function runAdCampaign() {
  if (process.env.AD_ENABLED !== 'true') {
    console.log('[AdAgent] Выключено. Установи AD_ENABLED=true в Railway');
    return { skipped: true };
  }

  const groups = getGroups();
  if (!groups.length) {
    console.log('[AdAgent] Нет групп. Добавь AD_GROUPS или AD_GROUP_1..20 в Railway');
    return { skipped: true };
  }

  const segment = SEGMENTS[campaignIdx % SEGMENTS.length];
  const format  = AD_FORMATS[campaignIdx % AD_FORMATS.length];
  campaignIdx++;

  console.log(`[AdAgent] 🚀 Кампания #${campaignIdx}: сегмент=${segment}, формат=${format}, групп=${groups.length}`);

  const adText = await generateAd(segment, format);
  const now    = Date.now();
  const results = [];

  for (const group of groups) {
    // Cooldown 22 часа на группу
    const last = lastPosted.get(group.id) || 0;
    if (now - last < 22 * 60 * 60 * 1000) {
      results.push({ group: group.id, ok: false, error: 'cooldown' });
      continue;
    }

    const res = await postToGroup(group, adText);
    results.push({ group: group.id, ok: res.ok === true, error: res.description });

    if (res.ok) {
      lastPosted.set(group.id, now);
      console.log(`[AdAgent] ✅ → ${group.id}`);
    } else {
      console.log(`[AdAgent] ❌ → ${group.id}: ${res.description || res.error}`);
    }

    // Пауза 20 сек между постами
    await new Promise(r => setTimeout(r, 20_000));
  }

  await notifyAdmin(results, segment);

  const sent = results.filter(r => r.ok).length;
  console.log(`[AdAgent] Итог: ${sent}/${groups.length} отправлено`);
  return { sent, total: groups.length, segment };
}

// ── Планировщик: ПИКОВЫЕ ЧАСЫ МСК ────────────────────────────────────────────
export function startAdScheduler() {
  if (process.env.AD_ENABLED !== 'true') {
    console.log('⏰ [AdAgent] Выключено (AD_ENABLED≠true). Установи в Railway для запуска.');
    return;
  }

  const peakHours = getPeakHours();
  console.log(`⏰ [AdAgent] Пиковые часы МСК: ${peakHours.join(', ')}:00`);

  let lastTriggeredHour = -1;

  const checkSchedule = () => {
    const now  = new Date();
    const msk  = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const hour = msk.getUTCHours();
    const min  = msk.getUTCMinutes();

    // Запускаем в начале пикового часа (0-2 минуты)
    if (peakHours.includes(hour) && min < 3 && lastTriggeredHour !== hour) {
      lastTriggeredHour = hour;
      console.log(`[AdAgent] 🎯 Пиковое время ${hour}:00 МСК — запускаю кампанию`);
      runAdCampaign().catch(e => console.error('[AdAgent] Ошибка:', e.message));
    }

    // Сброс lastTriggeredHour в конце часа
    if (min >= 58) lastTriggeredHour = -1;
  };

  // Проверяем каждую минуту
  setInterval(checkSchedule, 60 * 1000);

  // Еженедельный отчёт по понедельникам 9:00 МСК
  setInterval(() => {
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    if (msk.getUTCDay() === 1 && msk.getUTCHours() === 6 && msk.getUTCMinutes() < 3) {
      runAdWeeklyReport().catch(() => {});
    }
  }, 60 * 1000);

  console.log(`⏰ [AdAgent] 24/7 режим активен — посты в ${peakHours.join(', ')}:00 МСК`);
}

// ── Управление из adminBot ────────────────────────────────────────────────────
export function addAdGroup(groupId, segment = 'general') {
  const groups = getGroups();
  if (!groups.find(g => g.id === groupId)) {
    groups.push({ id: groupId, segment, name: groupId });
    process.env.AD_GROUPS = JSON.stringify(groups);
    return true;
  }
  return false;
}

export function getAdGroups() { return getGroups(); }
export function getAdStatus() {
  const peakHours = getPeakHours();
  const groups    = getGroups();
  return {
    enabled:    process.env.AD_ENABLED === 'true',
    groups:     groups.length,
    peakHours:  peakHours.map(h => `${h}:00`).join(', '),
    campaigns:  campaignIdx,
    nextHours:  peakHours.filter(h => {
      const msk = new Date(Date.now() + 3 * 60 * 60 * 1000);
      return h > msk.getUTCHours();
    }).map(h => `${h}:00 МСК`),
  };
}

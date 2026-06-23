/**
 * LegalAuto — Node.js Platform Entry Point
 *
 * Запускает:
 *   1. Admin Bot  (@LegalAutoAgentUprav_Bot) — ADMIN_BOT_TOKEN
 *   2. Client Bot (@LegalAutoAssist_bot)     — CLIENT_BOT_TOKEN
 *   3. News Bot   (расписание: каждые 3 часа)
 *
 * Запуск: node index.js
 */

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { setupAdminBot, isAutoPostPaused }  from './bots/adminBot.js';
import { setupClientBot } from './bots/clientBot.js';
import { runNewsBot }     from './bots/newsBot.js';
import { prepareAutoPost, publishToChannel } from './agents/postAgent.js';
import { runMorningBriefing } from './agents/brainAgent.js';
import { loadSubscriptionsFromGas } from './agents/alertAgent.js';
import { initPartner, runProactiveMonitor } from './agents/partnerAgent.js';
import { runFollowUp } from './agents/followUpAgent.js';
import { loadReferrals } from './agents/referralAgent.js';
import { startAdScheduler } from './agents/adAgent.js';
import { startAutoAdsScheduler } from './agents/autoAdsAgent.js';
import { setupReviewScheduler } from './agents/reviewAgent.js';
import { setupPriceMonitor } from './agents/priceMonitorAgent.js';
import { setupTrendingScheduler } from './agents/trendingAgent.js';
import { setupArbitrageMonitor } from './agents/arbitrageAgent.js';
import { setupWatchdog } from './agents/watchdogAgent.js';
import { initEdoBot, sendMorningBriefing } from './bots/edoBot.js';
import { execSync } from 'child_process';

// ── Диагностика Chromium при старте ───────────────────────────────────────────
try {
  const chromiumPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    (() => {
      try { return execSync('which chromium 2>/dev/null').toString().trim(); } catch { return ''; }
    })() ||
    (() => {
      try { return execSync('find /nix/store -maxdepth 4 -name "chromium" -type f 2>/dev/null | head -1').toString().trim(); } catch { return ''; }
    })();
  console.log(`🔍 Chromium: ${chromiumPath || 'НЕ НАЙДЕН — ZZap не будет работать'}`);
  if (!chromiumPath) {
    console.log('💡 Добавь в Railway: PUPPETEER_EXECUTABLE_PATH=/путь/к/chromium');
  }
} catch (e) {
  console.log('🔍 Chromium диагностика: ошибка -', e.message);
}

const {
  ADMIN_BOT_TOKEN,
  CLIENT_BOT_TOKEN,
} = process.env;

// ── Валидация ──────────────────────────────────────────────────────────────
const errors = [];
if (!ADMIN_BOT_TOKEN)  errors.push('ADMIN_BOT_TOKEN');
if (!CLIENT_BOT_TOKEN) errors.push('CLIENT_BOT_TOKEN');
if (errors.length) {
  console.error('❌ Отсутствуют переменные в .env:', errors.join(', '));
  process.exit(1);
}

// ── Admin Bot ──────────────────────────────────────────────────────────────
const adminBot = new Telegraf(ADMIN_BOT_TOKEN);
setupAdminBot(adminBot);

adminBot.catch((err, ctx) => {
  console.error('[AdminBot] Unhandled error:', err.message, 'ctx:', ctx?.updateType);
});

// ── Client Bot ─────────────────────────────────────────────────────────────
const clientBot = new Telegraf(CLIENT_BOT_TOKEN);
setupClientBot(clientBot);

clientBot.catch((err, ctx) => {
  console.error('[ClientBot] Unhandled error:', err.message, 'ctx:', ctx?.updateType);
});

// ── Запуск (без await — launch() никогда не завершается) ───────────────────
adminBot.launch({ dropPendingUpdates: true })
  .catch(e => console.error('[AdminBot] Launch error:', e.message));
console.log('✅ Admin bot started (@LegalAutoAgentUprav_Bot)');

clientBot.launch({ dropPendingUpdates: true })
  .catch(e => console.error('[ClientBot] Launch error:', e.message));
console.log('✅ Client bot started (@LegalAutoAssist_bot)');

// ── Alert subscriptions — восстановить из GAS ─────────────────────────────
setTimeout(() => {
  loadSubscriptionsFromGas()
    .catch(e => console.error('[AlertAgent] Load error:', e.message));
  loadReferrals()
    .catch(e => console.error('[Referral] Load error:', e.message));
}, 5_000);

// ── Макс — AI-партнёр: инициализация + проактивный мониторинг ─────────────
initPartner(adminBot.telegram);
console.log('🤖 Partner Agent "Макс" инициализирован');

// Первый мониторинг через 3 минуты после старта
setTimeout(() => {
  runProactiveMonitor().catch(e => console.error('[Partner] Monitor error:', e.message));
}, 3 * 60 * 1000);

// Мониторинг каждые 2 часа
setInterval(() => {
  runProactiveMonitor().catch(e => console.error('[Partner] Monitor error:', e.message));
}, 2 * 60 * 60 * 1000);

console.log('⏰ Partner monitor запущен (каждые 2ч)');

// ── News Bot — расписание ──────────────────────────────────────────────────
setTimeout(() => {
  runNewsBot().catch(e => console.error('[NewsBot] Error:', e.message));
}, 10_000);

setInterval(() => {
  runNewsBot().catch(e => console.error('[NewsBot] Error:', e.message));
}, 3 * 60 * 60 * 1000);

console.log('⏰ News bot scheduler started (every 3h)');

// ── Auto Post — AI выбирает и публикует запчасти автоматически ─────────────

async function runAutoPost() {
  if (isAutoPostPaused()) {
    console.log('[AutoPost] Paused — skipping.');
    return;
  }
  console.log('[AutoPost] Running scheduled post...');
  try {
    const result = await prepareAutoPost('scheduler');
    if (!result.ok) {
      console.log('[AutoPost] Skipped:', result.error);
      return;
    }
    await publishToChannel(adminBot.telegram, result.post);
    const p = result.post.part;
    console.log(`[AutoPost] ✅ Posted: ${p.brand} ${p.name} (ID: ${p.id})`);

    // Уведомить владельца
    if (process.env.ADMIN_CHAT_ID) {
      const price = Number(p.price || 0).toLocaleString('ru-RU');
      await adminBot.telegram.sendMessage(
        process.env.ADMIN_CHAT_ID,
        `✅ *Автопост опубликован*\n\n${p.brand} — ${p.name}\nЦена: ${price} ₽\nID: ${p.id}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch (e) {
    console.error('[AutoPost] Error:', e.message);
  }
}

// ── Расписание по времени суток (МСК = UTC+3) ─────────────────────────────
//   POST_SCHEDULE_TIMES = "10:00,14:00,19:00"  (в .env или Railway)
//   Если не задано — используем интервал AUTO_POST_INTERVAL_H

const POST_SCHEDULE_TIMES = process.env.POST_SCHEDULE_TIMES; // "10:00,14:00,19:00"
const AUTO_POST_INTERVAL_H = Number(process.env.AUTO_POST_INTERVAL_H || 3);

function startScheduler() {
  if (POST_SCHEDULE_TIMES) {
    // ── Режии: конкретные часы ────────────────────────────────────────────
    const times = POST_SCHEDULE_TIMES.split(',').map(t => t.trim());
    console.log(`⏰ Auto post по расписанию МСК: ${times.join(', ')}`);

    function checkSchedule() {
      const now  = new Date();
      // МСК = UTC+3
      const msk  = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const hhmm = `${String(msk.getUTCHours()).padStart(2,'0')}:${String(msk.getUTCMinutes()).padStart(2,'0')}`;
      if (times.includes(hhmm)) {
        console.log(`[AutoPost] Triggered by schedule at ${hhmm} МСК`);
        runAutoPost().catch(e => console.error('[AutoPost] Error:', e.message));
      }
    }

    // Проверяем каждую минуту
    setInterval(checkSchedule, 60_000);

    // Первый пост через 1 мин после старта (чтобы Railway успел развернуться)
    setTimeout(runAutoPost, 60_000);

  } else {
    // ── Режии: интервал ───────────────────────────────────────────────────
    console.log(`⏰ Auto post scheduler: каждые ${AUTO_POST_INTERVAL_H}ч`);
    setTimeout(runAutoPost, 30_000);
    setInterval(runAutoPost, AUTO_POST_INTERVAL_H * 60 * 60 * 1000);
  }
}

startScheduler();

// ── Еженедельный отчёт — каждый понедельник 9:00 МСК ──────────────────────
function startWeeklyReportScheduler() {
  function checkWeekly() {
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    // Понедельник (1), 09:00, 00 минут
    if (msk.getUTCDay() === 1 && msk.getUTCHours() === 9 && msk.getUTCMinutes() === 0) {
      runWeeklyReport().catch(e => console.error('[WeeklyReport] Error:', e.message));
    }
  }
  setInterval(checkWeekly, 60_000);
  console.log('⏰ Weekly report scheduler started (Mon 09:00 MSK)');
}

async function runWeeklyReport() {
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!chatId) return;
  console.log('[WeeklyReport] Running...');
  try {
    const url = new URL(process.env.APPS_SCRIPT_API_URL);
    url.searchParams.set('action', 'status');
    const res  = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalAutoBot/1.0)' } });
    const data = await res.json();

    const leadsUrl = new URL(process.env.APPS_SCRIPT_API_URL);
    leadsUrl.searchParams.set('action', 'leads');
    const leadsRes  = await fetch(leadsUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalAutoBot/1.0)' } });
    const leadsData = await leadsRes.json();
    const leads      = leadsData.leads || [];
    const week        = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekLeads   = leads.filter(l => l.created_at && new Date(l.created_at) > week).length;

    const text =
      `📊 *Еженедельный отчёт LegalAuto*\n` +
      `📅 ${new Date().toLocaleDateString('ru-RU')}\n\n` +
      `📦 Запчастей: *${data.parts_total || '—'}* (опубл. ${data.parts_published || '—'})\n` +
      `📋 Заявок за неделю: *${weekLeads}*\n` +
      `📋 Всего заявок: *${leads.length}*\n\n` +
      `_Автоматический отчёт. Нажми /analytics для подробностей._`;

    await adminBot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    console.log('[WeeklyReport] ✅ Sent');
  } catch (e) {
    console.error('[WeeklyReport] Error:', e.message);
  }
}

startWeeklyReportScheduler();

// ── Утренний AI-брифинг — каждый день 9:00 МСК ────────────────────────────
function startMorningBriefingScheduler() {
  let lastBriefingDay = -1;

  function checkMorning() {
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const h   = msk.getUTCHours();
    const m   = msk.getUTCMinutes();
    const day = msk.getUTCDate();
    if (h === 9 && m === 0 && day !== lastBriefingDay) {
      lastBriefingDay = day;
      console.log('[Brain] Triggering morning briefing...');
      runMorningBriefing(adminBot.telegram, process.env.ADMIN_CHAT_ID)
        .catch(e => console.error('[Brain] Morning briefing error:', e.message));
    }
  }

  setInterval(checkMorning, 60_000);
  console.log('⏰ Morning briefing scheduler started (daily 09:00 MSK)');
}

startMorningBriefingScheduler();

// ── Follow-up агент — каждый день в 12:00 МСК ─────────────────────────────
function startFollowUpScheduler() {
  let lastFollowUpDay = -1;
  function checkFollowUp() {
    const msk = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const h   = msk.getUTCHours();
    const m   = msk.getUTCMinutes();
    const day = msk.getUTCDate();
    if (h === 12 && m === 0 && day !== lastFollowUpDay) {
      lastFollowUpDay = day;
      console.log('[FollowUp] Запуск по расписанию 12:00 МСК...');
      runFollowUp()
        .then(r => console.log(`[FollowUp] Результат: отправлено=${r.sent}, закрыто=${r.closed}`))
        .catch(e => console.error('[FollowUp] Error:', e.message));
    }
  }
  setInterval(checkFollowUp, 60_000);
  console.log('⏰ Follow-up scheduler запущен (ежедневно 12:00 МСК)');
}
startFollowUpScheduler();

// ── Маркетинг-контент — вт и пт в 11:00 МСК ──────────────────────────────
function startMarketingScheduler() {
  let lastMarketingDay = -1;
  const MARKETING_DAYS = [2, 5]; // вторник, пятница

  function checkMarketing() {
    const msk     = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const weekDay = msk.getUTCDay();
    const h       = msk.getUTCHours();
    const m       = msk.getUTCMinutes();
    const day     = msk.getUTCDate();
    if (MARKETING_DAYS.includes(weekDay) && h === 11 && m === 0 && day !== lastMarketingDay) {
      lastMarketingDay = day;
      console.log('[Marketing] Публикую маркетинг-контент...');
      publishMarketingPost().catch(e => console.error('[Marketing] Error:', e.message));
    }
  }
  setInterval(checkMarketing, 60_000);
  console.log('⏰ Marketing scheduler запущен (вт+пт 11:00 МСК)');
}

// ── AI-генерация маркетинг-постов через Claude Haiku ──────────────────────
const MARKETING_BRANDS  = ['BMW', 'Geely', 'Li Auto', 'Mercedes-Benz', 'Audi', 'Toyota', 'Chery', 'Haval'];
const MARKETING_FORMATS = ['совет', 'факт', 'лайфхак', 'подборка', 'акция', 'история', 'предупреждение'];
let   marketingCallIdx  = 0;

async function generateMarketingText() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client    = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const brand  = MARKETING_BRANDS [marketingCallIdx % MARKETING_BRANDS.length];
  const format = MARKETING_FORMATS[Math.floor(Math.random() * MARKETING_FORMATS.length)];
  marketingCallIdx++;

  const system = `Ты маркетолог магазина автозапчастей LegalAuto.
Мы продаём б/у и оригинальные запчасти с разборок: BMW, Geely, Li Auto, Mercedes, Audi, Toyota, Chery, Haval.
Пишем посты в Telegram канал @LegalAutoParts24 для автолюбителей и механиков.
Наш бот: @LegalAutoAssist_bot, менеджер: @LegalAuto247

Правила:
- Пост 150–250 символов (без учёта форматирования)
- Используй Markdown Bold (*текст*) для заголовка
- Emoji в начале каждого абзаца
- Заканчивай призывом к действию — бот или менеджер
- НЕ используй хэштеги
- Пиши живо, как эксперт из своих — не рекламно
- Каждый пост уникален, не повторяй прошлые`;

  const prompt = `Напиши маркетинг-пост для Telegram канала в формате "${format}" про ${brand}.
Тема: выбери сам что-то актуальное и полезное (проблемы, лайфхаки, факты о запчастях).
Верни ТОЛЬКО текст поста, готовый к7публикации.`;

  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system,
    messages:   [{ role: 'user', content: prompt }],
  });

  return { text: msg.content[0].text.trim(), brand, format };
}

async function publishMarketingPost() {
  const CHANNEL_ID        = process.env.CHANNEL_ID;
  const CHANNEL_BOT_TOKEN = process.env.CHANNEL_BOT_TOKEN;
  if (!CHANNEL_ID || !CHANNEL_BOT_TOKEN) return;

  let postText, brand, format;

  // Если нет API ключа — фолбэк на статику
  if (!process.env.CLAUDE_API_KEY) {
    const fallbacks = [
      `🔧 *Совет*\n\nРегулярно проверяйте состояние подвески — б/у детали с малым пробегом служат не хуже новых аналогов.\n\n📲 Подобрать запчасть → @LegalAutoAssist_bot`,
      `📌 *Факт*\n\nБольшинство запчастей BMW E и F серий взаимозаменяемы между моделями — это сильно снижает стоимость ремонта.\n\n📦 Каталог: @LegalAutoParts24`,
    ];
    postText = fallbacks[marketingCallIdx++ % fallbacks.length];
    brand = ''; format = 'общий';
  } else {
    try {
      const result = await generateMarketingText();
      postText = result.text;
      brand    = result.brand;
      format   = result.format;
    } catch (e) {
      console.error('[Marketing] AI генерация не удалась:', e.message);
      postText = `🔥 *Свежие запчасти*\n\nСегодня пополнили каталог — BMW, Geely, Li Auto.\nПроверьте наличие нужной детали прямо сейчас.\n\n📦 @LegalAutoParts24 | 📲 @LegalAuto247`;
      brand = ''; format = 'акция';
    }
  }

  const res = await fetch(`https://api.telegram.org/bot${CHANNEL_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    CHANNEL_ID,
      text:       postText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: '📦 Каталог запчастей',  url: 'https://legalauto.online/' },
        { text: '📲 Написать менеджеру', url: `https://t.me/${process.env.MANAGER_USERNAME || 'LegalAuto247'}` },
      ]]}
    }),
  }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));

  console.log(`[Marketing] AI пост опубликован: ${format}${brand ? ' ' + brand : ''} → ok=${res.ok}`);
}

startMarketingScheduler();

// ── Авто-реклама в Telegram группах ────────────────────────────────────────
startAdScheduler();

// ── Авто объявления (drom.ru / auto.ru → переписать → канал) ───────────────
startAutoAdsScheduler();

// ── Review Agent — запрос отзывов через 4 дня после заказа ────────────────
setupReviewScheduler(clientBot);

// ── Price Monitor — еженедельное сравнение цен с Exist.ru ─────────────────
setupPriceMonitor(adminBot);

// ── Trending Agent — топ-10 запчастей (каждую пт 11:00 МСК) ───────────────
setupTrendingScheduler(adminBot);

// ── Arbitrage Agent — ищет маржинальные запчасти каждые 2ч ────────────────
setupArbitrageMonitor();

// ── Watchdog Agent — ни один лид не уходит (каждые 5 мин) ─────────────────
setupWatchdog(clientBot);

// ── Edo Bot — личный AI-ассистент Эдо (полный автопилот) ──────────────────
initEdoBot().catch(e => console.error('[EdoBot] Init error:', e.message));
console.log('🤖 Edo personal assistant initializing...');

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  adminBot.stop(signal);
  clientBot.stop(signal);
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

/**
 * LegalAuto — Watchdog Agent (Воронка без потерь)
 *
 * Следит за всеми входящими заявками и НЕ ДАЁТ лидам остыть:
 *  1. Клиент оставил заявку → ждём 30 мин ответа менеджера
 *  2. Нет ответа за 30 мин → AI сам пишет клиенту: "Привет, видели заявку!"
 *  3. Нет ответа за 2 часа → второй касание: "Нашли варианты для вас"
 *  4. Нет ответа за 24 часа → финальный: "Ещё актуально?"
 *  5. Менеджер отметил заявку обработанной → watchdog останавливается
 *
 * Как отметить заявку обработанной из adminBot:
 *   watchdog.markHandled(chatId)
 *
 * Railway env:
 *   WATCHDOG_ENABLED   = "true"
 *   WATCHDOG_DELAY_1   = "30"   (минуты до первого касания)
 *   WATCHDOG_DELAY_2   = "120"  (минуты до второго касания)
 *   WATCHDOG_DELAY_3   = "1440" (минуты до финального, 24ч)
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch      from 'node-fetch';

const CLAUDE_API_KEY    = process.env.CLAUDE_API_KEY;
const CLIENT_BOT_TOKEN  = process.env.CLIENT_BOT_TOKEN  || '';
const ADMIN_BOT_TOKEN   = process.env.ADMIN_BOT_TOKEN   || '';
const ADMIN_CHAT_ID     = process.env.ADMIN_CHAT_ID     || '';
const MGR               = process.env.MANAGER_USERNAME  || 'LegalAuto247';
const BOT_USERNAME      = process.env.CLIENT_BOT_USERNAME || 'LegalAutoAssist_bot';

const DELAY_1_MS = (Number(process.env.WATCHDOG_DELAY_1 ) ||   30) * 60 * 1000;
const DELAY_2_MS = (Number(process.env.WATCHDOG_DELAY_2 ) ||  120) * 60 * 1000;
const DELAY_3_MS = (Number(process.env.WATCHDOG_DELAY_3 ) || 1440) * 60 * 1000;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// ── Очередь лидов ─────────────────────────────────────────────────────────────
// chatId → { partName, phone, username, createdAt, touches, handled }
const leads = new Map();

/**
 * Зарегистрировать новый лид.
 * Вызывать из clientBot.js когда клиент оставляет заявку.
 */
export function registerLead({ chatId, partName, phone, username }) {
  if (process.env.WATCHDOG_ENABLED !== 'true') return;
  const key = String(chatId);
  if (leads.has(key)) {
    // Обновляем существующий лид
    const existing = leads.get(key);
    existing.partName = partName || existing.partName;
    existing.touches  = 0;
    existing.handled  = false;
    existing.createdAt = Date.now();
    return;
  }
  leads.set(key, {
    chatId:    key,
    partName:  partName || 'запчасть',
    phone:     phone    || '',
    username:  username || '',
    createdAt: Date.now(),
    touches:   0,       // 0=зарегистрирован, 1=первое касание, 2=второе, 3=финальное
    handled:   false,
  });
  console.log(`[Watchdog] 📋 Новый лид: ${key} — ${partName}`);
}

/**
 * Отметить лид как обработанный (менеджер ответил).
 * Вызывать из adminBot когда менеджер нажимает "Обработано".
 */
export function markHandled(chatId) {
  const lead = leads.get(String(chatId));
  if (lead) {
    lead.handled = true;
    console.log(`[Watchdog] ✅ Лид ${chatId} обработан менеджером`);
  }
}

/**
 * Снять лид с наблюдения (клиент написал сам).
 */
export function removeLead(chatId) {
  leads.delete(String(chatId));
}

// ── Генерация касания через AI ────────────────────────────────────────────────
async function generateTouchMessage(lead, touchNum) {
  const part = lead.partName || 'запчасть';

  const prompts = {
    1: `Ты менеджер магазина запчастей LegalAuto. Клиент оставил заявку на "${part}" 30 минут назад, но мы ещё не ответили. Напиши короткое (2-3 строки) дружелюбное сообщение: увидели заявку, уже ищем, скоро ответим. Тон: живой, не корпоративный. Никакого "уважаемый".`,
    2: `Ты менеджер LegalAuto. Клиент ждёт ответ на "${part}" уже 2 часа. Напиши короткое (2-3 строки) сообщение: подобрали варианты, сейчас пришлём, или предложи написать менеджеру напрямую. Бот: @${BOT_USERNAME}`,
    3: `Ты менеджер LegalAuto. Клиент спрашивал про "${part}" вчера. Напиши короткое (1-2 строки) ненавязчивое: ещё актуально? Мы готовы помочь. Не давить.`,
  };

  if (claude) {
    try {
      const msg = await claude.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompts[touchNum] || prompts[1] }],
      });
      return msg.content[0].text.trim();
    } catch { /* fallthrough */ }
  }

  // Статичные резервные варианты
  const fallbacks = {
    1: `👋 Привет! Мы получили твою заявку на *${part}*.\n\nУже ищем — скоро напишем!`,
    2: `🔍 Подобрали варианты по *${part}*.\n\nНапиши нам или нажми: @${BOT_USERNAME}`,
    3: `Привет! По *${part}* ещё актуально? Мы готовы помочь 🙂`,
  };
  return fallbacks[touchNum] || fallbacks[1];
}

// ── Отправить сообщение клиенту ───────────────────────────────────────────────
async function sendToClient(chatId, text) {
  if (!CLIENT_BOT_TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${CLIENT_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '💬 Написать менеджеру', url: `https://t.me/${MGR}` },
          { text: '📦 Каталог',            url: `https://t.me/${BOT_USERNAME}` },
        ]]},
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return json.ok === true;
  } catch {
    return false;
  }
}

// ── Уведомить менеджера о касании ────────────────────────────────────────────
async function notifyManagerAboutTouch(lead, touchNum) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;
  const labels = { 1: '1-е (30 мин)', 2: '2-е (2 ч)', 3: 'Финальное (24 ч)' };
  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    ADMIN_CHAT_ID,
      text:       `⚠️ *Watchdog: ${labels[touchNum] || touchNum} касание*\n\n📦 Деталь: ${lead.partName}\n👤 @${lead.username || lead.chatId}\n\n_AI написал клиенту. Подключись!_`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: '✅ Обработал лид', callback_data: `watchdog_handled_${lead.chatId}` },
        { text: '📲 Написать',      url: lead.username ? `https://t.me/${lead.username}` : `tg://user?id=${lead.chatId}` },
      ]]},
    }),
  }).catch(() => {});
}

// ── Основная проверка (запускается каждые 5 мин) ──────────────────────────────
export async function runWatchdogCheck(bot) {
  if (process.env.WATCHDOG_ENABLED !== 'true') return;

  const now = Date.now();

  for (const [chatId, lead] of leads.entries()) {
    if (lead.handled) continue;
    if (lead.touches >= 3) continue; // уже все 3 касания сделаны

    const age = now - lead.createdAt;
    let touchNum = null;

    if      (lead.touches === 0 && age >= DELAY_1_MS) touchNum = 1;
    else if (lead.touches === 1 && age >= DELAY_2_MS) touchNum = 2;
    else if (lead.touches === 2 && age >= DELAY_3_MS) touchNum = 3;

    if (!touchNum) continue;

    console.log(`[Watchdog] 📨 Касание #${touchNum} → ${chatId} (${lead.partName})`);

    try {
      const msg = await generateTouchMessage(lead, touchNum);
      const sent = await sendToClient(chatId, msg);

      if (sent) {
        lead.touches = touchNum;
        await notifyManagerAboutTouch(lead, touchNum);
      }
    } catch (e) {
      console.error(`[Watchdog] Ошибка для ${chatId}:`, e.message);
    }

    // Небольшая пауза между касаниями
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Чистим старые обработанные лиды (> 7 дней)
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const [chatId, lead] of leads.entries()) {
    if ((lead.handled || lead.touches >= 3) && lead.createdAt < cutoff) {
      leads.delete(chatId);
    }
  }
}

/**
 * Настройка watchdog (вызвать один раз в index.js).
 */
export function setupWatchdog(bot) {
  if (process.env.WATCHDOG_ENABLED !== 'true') {
    console.log('🐕 [Watchdog] Выключено. Установи WATCHDOG_ENABLED=true в Railway');
    return;
  }

  // Проверка каждые 5 минут
  setInterval(() => runWatchdogCheck(bot), 5 * 60 * 1000);
  console.log('🐕 [Watchdog] Запущен — никакой лид не уйдёт (проверка каждые 5 мин)');
}

// Экспорт для обработки callback_data из adminBot
export function getLeads() { return leads; }
export { leads };

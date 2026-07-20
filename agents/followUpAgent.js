/**
 * LegalAuto — Follow-Up Agent
 *
 * Автоматически дожимает клиентов которые оставили заявку но не купили.
 *
 * Логика:
 *  +1 день  → «Запчасть всё ещё есть — вам актуально?»
 *  +3 дня   → «Нашли что искали? Могу помочь подобрать»
 *  +7 дней  → «Последний раз — осталось несколько штук»
 *  +14 дней → помечаем лид холодным, закрываем
 *
 * Запускается раз в день в 12:00 МСК.
 */

import fetch from 'node-fetch';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;
const CLIENT_BOT_TOKEN    = process.env.CLIENT_BOT_TOKEN;
const MGR                 = process.env.MANAGER_USERNAME || 'LegalAuto247';
const MINI_APP_URL        = 'https://legalauto.online/';

// Отслеживаем кому уже отправляли follow-up — ХРАНИМ в Platform State (Volume),
// чтобы редеплой не приводил к повторной рассылке тем же клиентам.
import { getSection, setSection } from '../services/stateService.js';
const followUpLog = {
  get(chatId) { return ((getSection('followup') || {}).log || {})[chatId]; },
  set(chatId, v) {
    const cur = getSection('followup') || {};
    const log = cur.log || {};
    log[chatId] = v;
    setSection('followup', { ...cur, log });
  },
};

// ── GAS helper ────────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return {};
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal:   AbortSignal.timeout(15000),
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    return JSON.parse(await res.text());
  } catch { return {}; }
}

// ── Отправить сообщение клиенту через client bot ──────────────────────────────
async function sendToClient(chatId, text, keyboard = null) {
  if (!CLIENT_BOT_TOKEN || !chatId) return false;
  try {
    const body = {
      chat_id:    String(chatId),
      text,
      parse_mode: 'Markdown',
    };
    if (keyboard) body.reply_markup = keyboard;

    const res = await fetch(`https://api.telegram.org/bot${CLIENT_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (e) {
    console.error(`[FollowUp] sendToClient error (${chatId}):`, e.message);
    return false;
  }
}

// ── Обновить статус лида в GAS ────────────────────────────────────────────────
async function updateLeadStatus(chatId, status) {
  await gasGet('update_lead', { chat_id: chatId, status });
}

// ── Сформировать сообщение follow-up в зависимости от дня ────────────────────
function buildFollowUpMessage(lead, daysSince) {
  const part = lead.car ? `запчасти для ${lead.car}` : 'запчасти';
  const what = lead.data?.split('\n')[0] || part;

  if (daysSince <= 1) {
    return {
      text:
        `👋 Привет! Вы интересовались:\n*${what}*\n\n` +
        `Запчасть ещё в наличии — хотите оформить?\n\n` +
        `Если нужна помощь с подбором — просто напишите.`,
      keyboard: { inline_keyboard: [[
        { text: '✅ Да, оформить',        callback_data: 'sales_lead'                    },
        { text: '📦 Смотреть каталог',    web_app: { url: MINI_APP_URL }                },
      ], [
        { text: '📲 Написать менеджеру',  url: `https://t.me/${MGR}` },
      ]]},
    };
  }

  if (daysSince <= 3) {
    return {
      text:
        `🔔 Привет! Нашли что искали?\n\n` +
        `Я проверил — *${what}* ещё есть в наличии.\n\n` +
        `Если хотите — могу помочь подобрать или ответить на вопросы.`,
      keyboard: { inline_keyboard: [[
        { text: '🛒 Купить',              callback_data: 'sales_lead'    },
        { text: '📲 Написать менеджеру',  url: `https://t.me/${MGR}`    },
      ]]},
    };
  }

  // 7 дней — последнее напоминание
  return {
    text:
      `⏰ Последний раз пишу по поводу:\n*${what}*\n\n` +
      `Осталось немного — если актуально, лучше не откладывать.\n\n` +
      `Если нашли в другом месте или вопрос закрыт — всё ок, удачи! 🤝`,
    keyboard: { inline_keyboard: [[
      { text: '✅ Беру!',              callback_data: 'sales_lead'    },
      { text: '📲 Написать',          url: `https://t.me/${MGR}`    },
    ]]},
  };
}

// ── Главная функция — запускается раз в день ──────────────────────────────────
export async function runFollowUp() {
  console.log('[FollowUp] Запуск follow-up агента...');

  const data = await gasGet('leads');
  const leads = (data.leads || []).filter(l => {
    const status = (l.status || '').toLowerCase();
    // Только активные незакрытые заявки
    return status === 'new' || status === '' || status === 'work';
  });

  if (!leads.length) {
    console.log('[FollowUp] Нет активных заявок для follow-up');
    return { processed: 0 };
  }

  const now  = Date.now();
  let sent   = 0;
  let closed = 0;

  for (const lead of leads) {
    const chatId = String(lead.chat_id || '');
    if (!chatId || chatId === 'undefined') continue;

    const createdAt = lead.created_at ? new Date(lead.created_at).getTime() : 0;
    if (!createdAt) continue;

    const daysSince = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    const log       = followUpLog.get(chatId) || {};

    // +14 дней — закрываем лид автоматически
    if (daysSince >= 14) {
      if (!log.closed) {
        await updateLeadStatus(chatId, 'cold');
        followUpLog.set(chatId, { ...log, closed: true });
        closed++;
        console.log(`[FollowUp] Закрыт холодный лид chatId=${chatId} (${daysSince}д)`);
      }
      continue;
    }

    // +7 дней — последнее сообщение
    if (daysSince >= 7 && !log.sent_7d) {
      const msg = buildFollowUpMessage(lead, 7);
      const ok  = await sendToClient(chatId, msg.text, msg.keyboard);
      if (ok) {
        followUpLog.set(chatId, { ...log, sent_7d: true });
        sent++;
        console.log(`[FollowUp] +7д → chatId=${chatId}`);
      }
      await pause(500);
      continue;
    }

    // +3 дня
    if (daysSince >= 3 && !log.sent_3d) {
      const msg = buildFollowUpMessage(lead, 3);
      const ok  = await sendToClient(chatId, msg.text, msg.keyboard);
      if (ok) {
        followUpLog.set(chatId, { ...log, sent_3d: true });
        sent++;
        console.log(`[FollowUp] +3д → chatId=${chatId}`);
      }
      await pause(500);
      continue;
    }

    // +1 день
    if (daysSince >= 1 && !log.sent_1d) {
      const msg = buildFollowUpMessage(lead, 1);
      const ok  = await sendToClient(chatId, msg.text, msg.keyboard);
      if (ok) {
        followUpLog.set(chatId, { ...log, sent_1d: true });
        sent++;
        console.log(`[FollowUp] +1д → chatId=${chatId}`);
      }
      await pause(500);
    }
  }

  console.log(`[FollowUp] Готово — отправлено: ${sent}, закрыто: ${closed}`);

  // Сводка Эдо: кого дожать ЛИЧНО (2+ дня в работе без движения) — бот напомнил,
  // но живой звонок закрывает сделки лучше
  try {
    const hot = leads.filter(l => {
      const created = l.created_at ? new Date(l.created_at).getTime() : 0;
      const days = created ? (now - created) / 864e5 : 0;
      return days >= 2 && days < 14;
    }).slice(0, 8);
    const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN, ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
    if (hot.length && ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
      const lines = hot.map(l => {
        const days = Math.floor((now - new Date(l.created_at).getTime()) / 864e5);
        const what = (l.data || l.car || '').split('\n')[0].slice(0, 50);
        return `• ${l.username ? '@' + l.username : 'клиент ' + l.chat_id} — ${what || 'заявка'} (${days} дн., источник: ${l.source || '—'})`;
      });
      await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: `🔥 Лиды, которые стоит дожать лично (бот уже напомнил им):\n\n${lines.join('\n')}` }),
      }).catch(() => {});
    }
  } catch {}

  return { sent, closed, total: leads.length };
}

function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

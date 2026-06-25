/**
 * LegalAuto — Admin Bot v5
 * Личный AI-ассистент владельца (Эдо)
 * + Planning Agent: описываешь задачу → AI строит план выполнения
 * + Lead Notifications: мгновенный алерт при новой заявке с кнопками
 * + CRM Dashboard: воронка, статусы, детальный просмотр
 * + Analytics: еженедельный отчёт, контент-план, воронка
 * + Avito: генерация фида через /avito
 *
 * Полное меню кнопками на русском.
 * Поддержка BMW / Geely / Li Auto / Mercedes / Audi / Toyota и др.
 */

import https from 'https';
import http from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { decodeVin, formatVinResult } from '../agents/vinDecoder.js';
import { handleCrmText, looksCrmCommand } from '../agents/crmAgent.js';
import {
  prepareAutoPost, preparePostById,
  getPendingPost, setPendingPost, clearPendingPost,
  publishToChannel, generatePostText
} from '../agents/postAgent.js';
import { qualifyLead, formatLeadQualification, askBrain } from '../agents/brainAgent.js';
import { getPendingNewsPost, clearPendingNewsPost, publishNewsToChannel } from './newsBot.js';
import { getPendingAd, clearPendingAd, publishAd } from '../agents/autoAdsAgent.js';
import { getStats, formatReport } from '../agents/analyticsAgent.js';
import { askPartner, initPartner } from '../agents/partnerAgent.js';

const {
  ADMIN_BOT_TOKEN, ADMIN_CHAT_ID,
  GEMINI_API_KEY, CLAUDE_API_KEY,
  APPS_SCRIPT_API_URL, PARTS_CHANNEL,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;
const genAI  = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ── Диалоговая память ──────────────────────────────────────────────────────
const dialogHistory = new Map();
const MAX_HISTORY   = 20;

function getHistory(id)            { return dialogHistory.get(String(id)) || []; }
function addHistory(id, role, txt) {
  const h = getHistory(id);
  h.push({ role, content: txt });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  dialogHistory.set(String(id), h);
}
function clearHistory(id) { dialogHistory.delete(String(id)); }

// ── Состояния ожидания ввода ───────────────────────────────────────────────
// Когда пользователь должен что-то ввести в ответ на запрос бота
const waitingInput = new Map(); // chatId → { type: 'edit_post'|'post_by_id'|'set_interval'|'set_channel' }

function setWaiting(id, state) { waitingInput.set(String(id), state); }
function getWaiting(id)        { return waitingInput.get(String(id)) || null; }
function clearWaiting(id)      { waitingInput.delete(String(id)); }

// ── Автопостинг пауза ─────────────────────────────────────────────────────
let autoPostPaused = false;
export function isAutoPostPaused() { return autoPostPaused; }

// ── Lead Notification — вызывается из clientBot ────────────────────────────
let _adminBotRef = null; // ссылка на объект bot, сохраняется в setupAdminBot

export async function notifyNewLead({ chatId, username, service, car, client, phone, summary }) {
  if (!_adminBotRef || !ADMIN_CHAT_ID) return;
  try {
    // AI квалификация лида (не ждём — отправляем сразу, потом AI-оценка отдельным сообщением)
    const leadData = { chatId, username, service, car, client, phone, summary };

    const text =
      `🔥 *НОВАЯ ЗАЯВКА!*\n\n` +
      `📋 Услуга: ${service || '—'}\n` +
      `🚗 Авто: ${car || '—'}\n` +
      `👤 Клиент: ${client || username || '—'}\n` +
      `📞 Контакт: ${phone || '@' + (username || '—')}\n` +
      `💬 ${summary ? summary.slice(0, 200) : ''}`;

    await _adminBotRef.telegram.sendMessage(ADMIN_CHAT_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📩 Написать клиенту',  callback_data: `reply_client_${chatId}` },
           { text: '📲 Открыть в TG',      url: username ? `https://t.me/${username}` : `tg://user?id=${chatId}` }],
          [{ text: '✅ Принято',            callback_data: `lead_ok_${chatId}`   },
           { text: '❌ Отклонить',          callback_data: `lead_skip_${chatId}` }],
          [{ text: '📋 Все заявки',        callback_data: 'crm_leads' }],
        ]
      }
    });

    // AI-квалификация асинхронно — отдельным сообщением
    qualifyLead(leadData).then(async (q) => {
      try {
        await _adminBotRef.telegram.sendMessage(
          ADMIN_CHAT_ID,
          formatLeadQualification(q),
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
    }).catch(() => {});

  } catch (e) {
    console.error('[AdminBot] notifyNewLead error:', e.message);
  }
}

// ── Авто-ответ клиенту через CLIENT_BOT_TOKEN ─────────────────────────────
async function replyToClient(chatId, text) {
  const token = process.env.CLIENT_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('[AdminBot] replyToClient error:', e.message);
  }
}

// ── GAS API (через Cloudflare Worker прокси — Railway IP блокируется Google) ──
function httpsGetText(urlStr) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(e); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(new Error('GAS timeout')); });
  });
}

async function gasApi(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) throw new Error('APPS_SCRIPT_API_URL не задан');
  const url = new URL(APPS_SCRIPT_API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  // node-fetch следует 302-редиректам (GAS всегда делает redirect)
  const res  = await fetch(url.toString(), {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('GAS: ' + text.slice(0, 150)); }
}

// ── AI с памятью ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Ты личный AI-ассистент владельца компании LegalAuto (Эдо).

LegalAuto продаёт премиальные б/у запчасти: BMW, Geely, Li Auto, Mercedes, Audi, Toyota, Hyundai, Kia и другие марки.
Также оформляет СБКТС, ЭПТС, утильсбор, таможня.
Telegram-платформа: боты + Mini App каталог + канал @LegalAutoParts24.

Помогаешь с: бизнес-вопросы, контент, аналитика, задачи, CRM, посты.
Отвечай кратко и конкретно. Язык: тот же что пишет пользователь (RU/EN).`;

async function askAI(chatId, userText) {
  addHistory(chatId, 'user', userText);
  const history = getHistory(chatId);

  if (claude) {
    try {
      const msg = await claude.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1024,
        system: SYSTEM_PROMPT, messages: history,
      });
      const reply = msg.content[0].text.trim();
      addHistory(chatId, 'assistant', reply);
      return reply;
    } catch (e) { console.error('[AdminBot] Claude:', e.message); }
  }

  if (genAI) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const ctx   = history.slice(-6).map(m =>
      `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`
    ).join('\n');
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + ctx }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 }
    });
    const reply = result.response.text().trim();
    addHistory(chatId, 'assistant', reply);
    return reply;
  }

  throw new Error('Нет AI-провайдера');
}

// ══════════════════════════════════════════════════════════════════════════
//  М Е Н Ю
// ══════════════════════════════════════════════════════════════════════════

const MENUS = {

  main: () => ({
    text:
      '🎛 *LegalAuto Admin*\n\n' +
      'Привет, Эдо! Выбери раздел или просто напиши — я отвечу.',
    keyboard: [
      [{ text: '📢 Публикации',   callback_data: 'menu_posts'    },
       { text: '📦 Каталог',      callback_data: 'menu_catalog'  }],
      [{ text: '📋 Заявки / CRM', callback_data: 'menu_crm'      },
       { text: '📊 Аналитика',    callback_data: 'menu_analytics'}],
      [{ text: '⚙️ Настройки',    callback_data: 'menu_settings' },
       { text: '🤖 AI Ассистент', callback_data: 'menu_ai'       }],
    ],
  }),

  posts: (paused) => ({
    text:
      '📢 *Публикации*\n\n' +
      `Канал: ${PARTS_CHANNEL || '@LegalAutoParts24'}\n` +
      `Интервал: каждые ${process.env.AUTO_POST_INTERVAL_H || 3}ч\n` +
      `Автопостинг: ${paused ? '⏸ На паузе' : '▶️ Активен'}`,
    keyboard: [
      [{ text: '🤖 AI выбирает и постит',  callback_data: 'post_auto'    }],
      [{ text: '👁 Предпросмотр следующего', callback_data: 'post_preview' }],
      [{ text: '🔢 Пост по ID запчасти',    callback_data: 'post_by_id'  }],
      [{ text: '✅ Опубликовать (одобрить)', callback_data: 'post_approve'}],
      [{ text: '✏️ Редактировать текст',    callback_data: 'post_edit'   },
       { text: '🖼 Редактировать фото',     callback_data: 'post_photo'  }],
      [{ text: '⏭ Пропустить запчасть',    callback_data: 'post_skip'   }],
      [paused
        ? { text: '▶️ Возобновить автопостинг', callback_data: 'post_resume' }
        : { text: '⏸ Пауза автопостинга',       callback_data: 'post_pause'  }],
      [{ text: '⏰ Изменить интервал',      callback_data: 'post_interval'}],
      [{ text: '◀️ Назад',                 callback_data: 'menu_main'   }],
    ],
  }),

  catalog: () => ({
    text: '📦 *Каталог запчастей*\nBMW · Geely · Li Auto · Mercedes · Audi · Toyota · и другие',
    keyboard: [
      [{ text: '📊 Статистика каталога',    callback_data: 'cat_stats'    }],
      [{ text: '🔍 Не опубликованные',      callback_data: 'cat_unpub'    }],
      [{ text: '📷 Без фото',               callback_data: 'cat_nophoto' }],
      [{ text: '💰 Без цены',               callback_data: 'cat_noprice' }],
      [{ text: '🏆 Топ по марже',           callback_data: 'cat_topmargin'}],
      [{ text: '◀️ Назад',                 callback_data: 'menu_main'   }],
    ],
  }),

  crm: () => ({
    text: '📋 *CRM и Заявки*\n\nУправляй заявками, смотри воронку, меняй статусы.',
    keyboard: [
      [{ text: '📥 Последние заявки',       callback_data: 'crm_leads'   }],
      [{ text: '🔀 Воронка продаж',         callback_data: 'crm_funnel'  }],
      [{ text: '🚗 CRM автомобили',         callback_data: 'crm_cars'    }],
      [{ text: '✅ Принятые',               callback_data: 'crm_done'    },
       { text: '🆕 Новые',                  callback_data: 'crm_new'     }],
      [{ text: '◀️ Назад',                 callback_data: 'menu_main'   }],
    ],
  }),

  analytics: () => ({
    text: '📊 *Аналитика LegalAuto*',
    keyboard: [
      [{ text: '📈 Еженедельный отчёт',  callback_data: 'an_weekly'   }],
      [{ text: '📦 Каталог',    callback_data: 'an_catalog'  },
       { text: '📥 Заявки',    callback_data: 'an_leads'    }],
      [{ text: '📢 Посты',     callback_data: 'an_posts'    },
       { text: '🔄 Статус',   callback_data: 'an_status'   }],
      [{ text: '🎯 Идеи продаж (AI)',    callback_data: 'ai_promo'    }],
      [{ text: '◀️ Назад',    callback_data: 'menu_main'   }],
    ],
  }),

  settings: () => {
    const sched = process.env.POST_SCHEDULE_TIMES;
    const schedText = sched ? `📅 Расписание: ${sched} МСК` : `⏰ Интервал: ${process.env.AUTO_POST_INTERVAL_H || 3}ч`;
    return {
      text:
        '⚙️ *Настройки*\n\n' +
        `Канал: ${process.env.PARTS_CHANNEL || '@LegalAutoParts24'}\n` +
        schedText + '\n' +
        `Автопостинг: ${autoPostPaused ? '⏸ Пауза' : '▶️ Активен'}`,
      keyboard: [
        [{ text: '⏰ Интервал (часы)',       callback_data: 'set_interval'  }],
        [{ text: '📅 Расписание по времени', callback_data: 'set_schedule'  }],
        [{ text: '📢 Изменить канал',        callback_data: 'set_channel'   }],
        [{ text: '🧹 Сбросить память AI',    callback_data: 'set_clearmem'  }],
        [{ text: '🔄 Статус платформы',      callback_data: 'an_status'     }],
        [{ text: '◀️ Назад',               callback_data: 'menu_main'     }],
      ],
    };
  },

  ai: () => ({
    text:
      '🤖 *AI Ассистент*\n\n' +
      'Просто напиши что нужно — спрошу, напишу пост, проанализирую, придумаю акцию.\n\n' +
      '🧠 *Planning Agent* — напиши задачу, AI строит план выполнения!\n\n' +
      'Например:\n' +
      '• _Напиши пост про BMW X5 подвеску_\n' +
      '• _Как запустить рекламу на Geely запчасти?_\n' +
      '• _Сделай план захвата рынка СБКТС_',
    keyboard: [
      [{ text: '🧠 Planning Agent',       callback_data: 'ai_task_plan'}],
      [{ text: '📝 Написать пост',        callback_data: 'ai_post'     },
       { text: '📅 Контент-план',         callback_data: 'ai_plan'     }],
      [{ text: '🎁 Идеи акций',           callback_data: 'ai_promo'    },
       { text: '📊 Еженедельный отчёт',   callback_data: 'ai_report'   }],
      [{ text: '🧹 Сбросить память',      callback_data: 'set_clearmem'}],
      [{ text: '◀️ Назад',               callback_data: 'menu_main'   }],
    ],
  }),
};

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

async function showMenu(ctx, menuKey, extra = {}) {
  const m = menuKey === 'posts'
    ? MENUS.posts(autoPostPaused)
    : menuKey === 'settings'
    ? MENUS.settings()
    : MENUS[menuKey]?.();
  if (!m) return;
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: m.keyboard }, ...extra };
  try {
    await ctx.editMessageText(m.text, opts);
  } catch {
    await ctx.reply(m.text, opts);
  }
}

// ── Форматирование превью поста ───────────────────────────────────────────
function postPreviewText(post) {
  const p     = post.part;
  const price = Number(p.price || 0).toLocaleString('ru-RU');
  const photos = [p.photo_cover, p.photo_1, p.photo_2, p.photo_3, p.photo_4, p.photo_5]
    .filter(u => u && String(u).startsWith('http')).length;
  return (
    `📋 *ПРЕВЬЮ ПОСТА*\n` +
    `🚗 ${p.display_car || p.brand}  |  💰 ${price} ₽  |  📷 ${photos} фото\n` +
    `──────────────\n` +
    post.text +
    `\n──────────────`
  );
}

function postActionKb() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Опубликовать',     callback_data: 'post_approve'    },
         { text: '⏭ Пропустить',       callback_data: 'post_skip'       }],
        [{ text: '✏️ Текст',           callback_data: 'post_edit'       },
         { text: '🖼 Фото',            callback_data: 'post_photo'      }],
        [{ text: '🚗 Авто/марка',      callback_data: 'post_edit_brand' },
         { text: '💰 Цена',            callback_data: 'post_edit_price' }],
        [{ text: '🔄 Другая запчасть', callback_data: 'post_auto'       }],
        [{ text: '◀️ В меню',          callback_data: 'menu_posts'      }],
      ]
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  Р Е Г И С Т Р А Ц И Я   Б О Т А
// ══════════════════════════════════════════════════════════════════════════

export function setupAdminBot(bot) {
  _adminBotRef = bot; // сохраняем для notifyNewLead

  function isAdmin(ctx) {
    return String(ctx.chat?.id || ctx.from?.id) === String(ADMIN_CHAT_ID);
  }

  function isManager(ctx) {
    const id = String(ctx.chat?.id || ctx.from?.id);
    if (id === String(ADMIN_CHAT_ID)) return true;
    const extra = (process.env.MANAGER_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    return extra.includes(id);
  }

  async function guard(ctx) {
    if (!isAdmin(ctx)) { await ctx.reply('🔒 Только для владельца.'); return false; }
    return true;
  }

  async function guardManager(ctx) {
    if (!isManager(ctx)) { await ctx.reply('🔒 Доступ запрещён.'); return false; }
    return true;
  }

  // ── /start ────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    if (isAdmin(ctx)) {
      const m = MENUS.main();
      await ctx.reply(m.text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: m.keyboard } });
    } else if (isManager(ctx)) {
      await ctx.reply(
        `👋 *Привет, менеджер!*\n\n` +
        `Ты подключён к системе *LegalAuto*.\n` +
        `Новые заявки клиентов будут приходить прямо сюда — с деталями авто, запчастью и ссылками на ZZap.\n\n` +
        `Ожидай уведомлений 🔔`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('🔒 Доступ запрещён.');
    }
  });

  // ── /menu ─────────────────────────────────────────────────────────────
  bot.command('menu', async (ctx) => {
    if (!(await guard(ctx))) return;
    const m = MENUS.main();
    await ctx.reply(m.text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: m.keyboard } });
  });

  // ── /plan — Planning Agent ───────────────────────────────────────────
  bot.command('plan', async (ctx) => {
    if (!(await guard(ctx))) return;
    const task = ctx.message.text.replace('/plan', '').trim();
    if (!task) {
      setWaiting(ctx.chat.id, { type: 'plan_task' });
      return ctx.reply(
        '🧠 *Planning Agent*\n\nОпиши задачу или цель — я разобью её на конкретные шаги с приоритетами, сроками и исполнителями.\n\nПример: _Как запустить продажи запчастей Geely через Авито?_',
        { parse_mode: 'Markdown', ...kb([[{ text: '❌ Отмена', callback_data: 'menu_ai' }]]) }
      );
    }
    await buildPlan(ctx, task);
  });

  async function buildPlan(ctx, task) {
    await ctx.reply('🧠 Анализирую задачу и строю план...');
    const planPrompt = `Ты Planning Agent компании LegalAuto (продажа запчастей BMW/Geely/Li Auto/Mercedes + оформление СБКТС/ЭПТС/утильсбор).

ЗАДАЧА от владельца: "${task}"

Построй ДЕТАЛЬНЫЙ план выполнения:
1. Оцени задачу (1-2 предложения)
2. Разбей на 5-8 конкретных шагов (нумерованный список)
   - Каждый шаг: что именно делать + кто/что нужно
   - Приоритет: 🔥 срочно / ⚡ важно / 📌 позже
3. Ожидаемый результат
4. Риски (если есть)
5. Следующий шаг прямо сейчас

Отвечай по-русски, конкретно, без воды.`;

    try {
      const plan = await askAI(ctx.chat.id, planPrompt);
      await ctx.reply(
        `🧠 *План выполнения:*\n\n${plan}`,
        {
          parse_mode: 'Markdown',
          ...kb([
            [{ text: '🔄 Уточнить план', callback_data: 'ai_task_plan' },
             { text: '📝 Написать пост', callback_data: 'ai_post'      }],
            [{ text: '🏠 Главное меню',  callback_data: 'menu_main'    }],
          ])
        }
      );
    } catch (e) {
      await ctx.reply('❌ Ошибка Planning Agent: ' + e.message);
    }
  }

  // ── /analytics ───────────────────────────────────────────────────────
  bot.command('analytics', async (ctx) => {
    if (!(await guard(ctx))) return;
    await sendAnalytics(ctx, 'week');
  });

  // ── /avito ────────────────────────────────────────────────────────────
  bot.command('avito', async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.reply(
      '⏸ *Авито временно приостановлено*\n\nИнтеграция с Авито отложена. Фокус сейчас на Telegram-канале @LegalAutoParts24.',
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Меню', callback_data: 'menu_main' }]]) }
    );
  });

  // ── /ai — разговор с Максом ────────────────────────────────────────────
  // Хранит историю разговора с партнёром по chatId
  const partnerHistory = new Map();

  bot.command('ai', async (ctx) => {
    if (!(await guard(ctx))) return;
    const question = ctx.message.text.replace('/ai', '').trim();

    if (!question) {
      return ctx.reply(
        `🤖 *Макс — твой AI-партнёр*\n\n` +
        `Я слежу за платформой, анализирую данные и помогаю принимать решения.\n\n` +
        `*Примеры:*\n` +
        `• \`/ai как дела с продажами?\`\n` +
        `• \`/ai опубликуй пост прямо сейчас\`\n` +
        `• \`/ai что мне делать сегодня?\`\n` +
        `• \`/ai придумай маркетинговый пост про BMW\`\n` +
        `• \`/ai почему мало заявок?\``,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '💬 Что делать сегодня?', callback_data: 'partner_today' },
          { text: '📊 Состояние платформы', callback_data: 'partner_status' },
        ]]}}
      );
    }

    const thinking = await ctx.reply('🤔 Макс думает...');
    try {
      const history = partnerHistory.get(String(ctx.chat.id)) || [];
      const result  = await askPartner(question, history);
      partnerHistory.set(String(ctx.chat.id), result.history || []);

      await ctx.telegram.editMessageText(
        ctx.chat.id, thinking.message_id, null,
        `🤖 *Макс:*\n\n${result.text}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '💬 Ответить',          callback_data: 'partner_chat'   },
          { text: '🔄 Новый разговор',    callback_data: 'partner_reset'  },
          { text: '📊 Аналитика',         callback_data: 'an_week'        },
        ]]}}
      ).catch(() => ctx.reply(`🤖 *Макс:*\n\n${result.text}`, { parse_mode: 'Markdown' }));
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null, '❌ ' + e.message).catch(() => {});
    }
  });

  // ── Кнопки партнёра ────────────────────────────────────────────────────
  bot.action('partner_today', async (ctx) => {
    await ctx.answerCbQuery('🤔');
    const thinking = await ctx.reply('🤔 Макс анализирует...');
    try {
      const history = partnerHistory.get(String(ctx.chat.id)) || [];
      const result  = await askPartner('Посмотри на состояние платформы и скажи что мне нужно сделать сегодня. Конкретно, по приоритету.', history);
      partnerHistory.set(String(ctx.chat.id), result.history || []);
      await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null,
        `🤖 *Макс — план на сегодня:*\n\n${result.text}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '💬 Обсудить', callback_data: 'partner_chat' },
          { text: '📊 Аналитика', callback_data: 'an_week' },
        ]]}}
      ).catch(() => {});
    } catch (e) { await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {}); }
  });

  bot.action('partner_status', async (ctx) => {
    await ctx.answerCbQuery('🤔');
    const thinking = await ctx.reply('🤔 Макс проверяет...');
    try {
      const history = partnerHistory.get(String(ctx.chat.id)) || [];
      const result  = await askPartner('Проверь состояние платформы полностью и дай мне сводку — что хорошо, что плохо, на что обратить внимание.', history);
      partnerHistory.set(String(ctx.chat.id), result.history || []);
      await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null,
        `🤖 *Макс — состояние платформы:*\n\n${result.text}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '💬 Обсудить', callback_data: 'partner_chat' },
        ]]}}
      ).catch(() => {});
    } catch (e) { await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {}); }
  });

  bot.action('partner_reset', async (ctx) => {
    await ctx.answerCbQuery('✅ Начинаем новый разговор');
    partnerHistory.delete(String(ctx.chat.id));
    await ctx.reply('🤖 *Макс:* Начинаем с чистого листа. Что обсуждаем?', { parse_mode: 'Markdown' });
  });

  bot.action('partner_chat', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'partner_message' });
    await ctx.reply('💬 Напиши Максу:', { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'back_main' }]] }});
  });

  // ── /ads — управление авторекламой ──────────────────────────────────────
  bot.command('ads', async (ctx) => {
    if (!(await guard(ctx))) return;
    const { getAdStatus, getAdGroups, addAdGroup, runAdCampaign } = await import('../agents/adAgent.js');
    const status = getAdStatus();
    const groups = getAdGroups();

    const args = ctx.message.text.replace('/ads', '').trim();

    // /ads add @groupname — добавить группу
    if (args.startsWith('add ')) {
      const groupId = args.slice(4).trim();
      const added = addAdGroup(groupId);
      return ctx.reply(added ? `✅ Группа добавлена: ${groupId}` : `⚠️ Группа уже в списке: ${groupId}`);
    }

    // /ads now — запустить сейчас
    if (args === 'now') {
      await ctx.reply('📣 Запускаю рекламную кампанию...');
      const result = await runAdCampaign();
      return ctx.reply(result.skipped
        ? '⚠️ Реклама отключена или нет групп'
        : `✅ Отправлено: ${result.sent}/${result.total} групп`
      );
    }

    // /ads on / off — включить/выключить
    if (args === 'on')  { process.env.AD_ENABLED = 'true';  return ctx.reply('✅ Реклама включена'); }
    if (args === 'off') { process.env.AD_ENABLED = 'false'; return ctx.reply('⏸ Реклама выключена'); }

    // Статус по умолчанию
    const groupsList = groups.length
      ? groups.map(g => `  • ${g.id} (${g.segment})`).join('\n')
      : '  _Не добавлено_';
    await ctx.reply(
      `📣 *Авто-реклама*\n\n` +
      `Статус: ${status.enabled ? '✅ Включена' : '⏸ Выключена'}\n` +
      `Интервал: каждые ${status.intervalH}ч\n` +
      `Групп: ${status.groups}\n\n` +
      `*Список групп:*\n${groupsList}\n\n` +
      `*Команды:*\n` +
      `\`/ads on\` — включить\n` +
      `\`/ads off\` — выключить\n` +
      `\`/ads now\` — запустить сейчас\n` +
      `\`/ads add @groupname\` — добавить группу\n\n` +
      `*Env vars для Railway:*\n` +
      `\`AD_ENABLED=true\`\n` +
      `\`AD_GROUPS=["@group1","@group2"]\`\n` +
      `\`AD_INTERVAL_H=4\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /do — ОРКЕСТРАТОР (главная команда) ──────────────────────────────
  bot.command('do', async (ctx) => {
    if (!(await guard(ctx))) return;
    const task = ctx.message.text.replace('/do', '').trim();
    if (!task) {
      return ctx.reply(
        `🧠 *Оркестратор LegalAuto*\n\n` +
        `Напиши задачу после команды, например:\n\n` +
        `\`/do сделай пост про импорт Geely для @LegalAuto24\`\n` +
        `\`/do опубликуй пост с картинкой про СБКТС\`\n` +
        `\`/do рассылка во все каналы: скидка 15% на BMW запчасти\`\n` +
        `\`/do дай статистику за неделю\`\n\n` +
        `Я сам решу что делать и сообщу результат 🚀`,
        { parse_mode: 'Markdown' }
      );
    }
    const thinking = await ctx.reply(`⚙️ Принял задачу: _${task}_`, { parse_mode: 'Markdown' });

    const { orchestrate } = await import('../agents/orchestratorAgent.js');
    await orchestrate(task, async (msg) => {
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });
  });

  // ── /ping — health check ──────────────────────────────────────────────
  bot.command('ping', async (ctx) => {
    if (!(await guard(ctx))) return;
    const thinking = await ctx.reply('🔍 Проверяю статус платформы...');
    const uptimeSec = Math.floor(process.uptime());
    const uptimeStr = uptimeSec < 60
      ? `${uptimeSec}с`
      : uptimeSec < 3600
        ? `${Math.floor(uptimeSec/60)}м ${uptimeSec%60}с`
        : `${Math.floor(uptimeSec/3600)}ч ${Math.floor((uptimeSec%3600)/60)}м`;
    const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

    // Проверяем GAS
    let gasStatus = '❓';
    let gasDetail = '';
    try {
      const t0 = Date.now();
      const gasData = await gasApi('status');
      const ms = Date.now() - t0;
      if (gasData && typeof gasData.parts_total !== 'undefined') {
        gasStatus = '✅';
        gasDetail = ` (${ms}ms · ${gasData.parts_total} зап.)`;
      } else {
        gasStatus = '⚠️';
        gasDetail = ' (нет данных)';
      }
    } catch (e) {
      gasStatus = '❌';
      gasDetail = ` (${e.message.slice(0, 40)})`;
    }

    const text =
      `🏓 *LegalAuto Platform Status*\n\n` +
      `🤖 Admin Bot: ✅ онлайн\n` +
      `⏱ Uptime: ${uptimeStr}\n` +
      `💾 RAM: ${memMb} MB\n` +
      `📡 GAS API: ${gasStatus}${gasDetail}\n\n` +
      `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`;

    await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null, text, {
      parse_mode: 'Markdown',
    }).catch(() => ctx.reply(text, { parse_mode: 'Markdown' }));
  });

  // ── /gastest — диагностика: что реально возвращает GAS ──────────────
  bot.command('gastest', async (ctx) => {
    if (!(await guard(ctx))) return;
    const action = ctx.message.text.replace('/gastest', '').trim() || 'status';
    await ctx.reply(`🔍 Тестирую GAS action=${action}...`);
    try {
      const data = await gasApi(action);
      const preview = JSON.stringify(data).slice(0, 400);
      await ctx.reply(`✅ GAS ответил:\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(`❌ Ошибка: ${e.message}`);
    }
  });

  // ── /postcheck — диагностика постов ─────────────────────────────────
  bot.command('postcheck', async (ctx) => {
    if (!(await guard(ctx))) return;
    const msg = await ctx.reply('🔍 Проверяю автопостинг...');
    try {
      const channel = process.env.PARTS_CHANNEL || '@LegalAutoParts24';
      const data = await gasApi('unpublished');
      const count = (data.parts || []).length;
      const paused = autoPostPaused;
      const sched  = process.env.POST_SCHEDULE_TIMES || `каждые ${process.env.AUTO_POST_INTERVAL_H || 3}ч`;

      const text =
        `📢 *Статус автопостинга*\n\n` +
        `📌 Канал/группа: \`${channel}\`\n` +
        `📦 Неопубликованных в таблице: *${count}*\n` +
        `⏰ Расписание: ${sched}\n` +
        `${paused ? '⏸ Автопостинг на паузе' : '▶️ Автопостинг активен'}\n\n` +
        (count === 0
          ? '⚠️ *Нечего публиковать!*\nВсе запчасти уже опубликованы, или цена/количество = 0.\n\nЧтобы добавить новые — заполни таблицу с published=FALSE, price>0, qty>0.'
          : `✅ Готово к публикации: ${count} позиций\n\n/testpost — опубликовать прямо сейчас`);

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text, {
        parse_mode: 'Markdown',
      }).catch(() => ctx.reply(text, { parse_mode: 'Markdown' }));
    } catch (e) {
      await ctx.reply(`❌ Ошибка проверки: ${e.message}`);
    }
  });

  // ── /testpost — тест: опубликовать одну запчасть сейчас ──────────────
  bot.command('testpost', async (ctx) => {
    if (!(await guard(ctx))) return;
    const msg = await ctx.reply('⏳ Ищу запчасть для публикации...');
    try {
      const result = await prepareAutoPost(ctx.chat.id);
      if (!result.ok) {
        return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
          `❌ Не удалось: ${result.error}`, {}).catch(() => {});
      }
      const p = result.post.part;
      const price = Number(p.price || 0).toLocaleString('ru-RU');
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        `✅ Нашёл: *${p.brand || ''} ${p.name || ''}* — ${price} ₽\n\n⏳ Публикую в канал...`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      const msgId = await publishToChannel(bot.telegram, result.post);
      const channel = process.env.PARTS_CHANNEL || '@LegalAutoParts24';
      const link = msgId ? `https://t.me/${String(channel).replace('@', '')}/${msgId}` : '';
      await ctx.reply(
        `✅ *Опубликовано!*\n\n${p.brand || ''} — ${p.name || ''}\nЦена: ${price} ₽\n${link ? `Ссылка: ${link}` : ''}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await ctx.reply(`❌ Ошибка публикации: ${e.message}`);
    }
  });

  // ── /clear ────────────────────────────────────────────────────────────
  bot.command('clear', async (ctx) => {
    if (!(await guard(ctx))) return;
    clearHistory(ctx.chat.id);
    await ctx.reply('🧹 Память сброшена.');
  });

  // ── /brain — прямой запрос к AI Orchestrator ─────────────────────────
  bot.command('brain', async (ctx) => {
    if (!(await guard(ctx))) return;
    const question = ctx.message.text.replace('/brain', '').trim();
    if (!question) {
      return ctx.reply('🧠 Использование: /brain <вопрос>\nПример: /brain какие лиды сегодня горячие?');
    }
    const thinking = await ctx.reply('🧠 Думаю...');
    try {
      const answer = await askBrain(question);
      await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null, answer, { parse_mode: 'Markdown' })
        .catch(() => ctx.reply(answer, { parse_mode: 'Markdown' }));
    } catch (e) {
      await ctx.reply('⚠️ Ошибка мозга: ' + e.message);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  CALLBACK — НАВИГАЦИЯ ПО МЕНЮ
  // ══════════════════════════════════════════════════════════════════════

  bot.action('menu_main',      async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'main');      });
  bot.action('menu_posts',     async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'posts');     });
  bot.action('menu_catalog',   async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'catalog');   });
  bot.action('menu_crm',       async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'crm');       });
  bot.action('menu_analytics', async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'analytics'); });
  bot.action('menu_settings',  async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'settings');  });
  bot.action('menu_ai',        async (ctx) => { await ctx.answerCbQuery(); await showMenu(ctx, 'ai');        });

  // ══════════════════════════════════════════════════════════════════════
  //  ПУБЛИКАЦИИ
  // ══════════════════════════════════════════════════════════════════════

  // 🤖 AI выбирает запчасть и показывает превью
  bot.action('post_auto', async (ctx) => {
    await ctx.answerCbQuery('⏳ Выбираю...');
    await ctx.reply('🤖 Выбираю лучшую запчасть из таблицы...');
    try {
      const result = await prepareAutoPost(ctx.chat.id);
      if (!result.ok) return ctx.reply('❌ ' + result.error, kb([[{ text: '◀️ Назад', callback_data: 'menu_posts' }]]));
      await ctx.reply(postPreviewText(result.post), { parse_mode: 'Markdown', ...postActionKb() });
    } catch (e) {
      await ctx.reply('❌ ' + e.message);
    }
  });

  // 👁 Предпросмотр без генерации нового
  bot.action('post_preview', async (ctx) => {
    await ctx.answerCbQuery('⏳ Смотрю...');
    const pending = getPendingPost(ctx.chat.id);
    if (pending) {
      return ctx.reply(postPreviewText(pending), { parse_mode: 'Markdown', ...postActionKb() });
    }
    await ctx.reply('⏳ Загружаю следующую запчасть...');
    try {
      const result = await prepareAutoPost(ctx.chat.id);
      if (!result.ok) return ctx.reply('❌ ' + result.error);
      await ctx.reply(postPreviewText(result.post), { parse_mode: 'Markdown', ...postActionKb() });
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  // 🔢 Пост по ID
  bot.action('post_by_id', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'post_by_id' });
    await ctx.reply('Введи ID запчасти из таблицы:', kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]));
  });

  // ✅ Опубликовать
  bot.action('post_approve', async (ctx) => {
    await ctx.answerCbQuery('⏳ Публикую...');
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Нет поста для публикации. Нажми "AI выбирает".', kb([[{ text: '◀️ Назад', callback_data: 'menu_posts' }]]));
    try {
      await ctx.reply('⏳ Публикую...');
      const msgId = await publishToChannel(bot.telegram, post);
      clearPendingPost(ctx.chat.id);
      const channel = PARTS_CHANNEL || '@LegalAutoParts24';
      const link = msgId ? `https://t.me/${String(channel).replace('@', '')}/${msgId}` : '';
      await ctx.reply(
        `✅ *Опубликовано!*\n${post.part.brand} — ${post.part.name}\n${link ? `[Открыть пост](${link})` : ''}`,
        { parse_mode: 'Markdown', ...kb([[{ text: '📢 Ещё пост', callback_data: 'post_auto' }, { text: '◀️ Меню', callback_data: 'menu_posts' }]]) }
      );
    } catch (e) { await ctx.reply('❌ Ошибка: ' + e.message); }
  });

  // ✏️ Редактировать текст поста
  bot.action('post_edit', async (ctx) => {
    await ctx.answerCbQuery();
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Сначала выбери запчасть через "AI выбирает".');
    setWaiting(ctx.chat.id, { type: 'edit_post_text' });
    await ctx.reply(
      '✏️ *Редактирование текста поста*\n\nТекущий текст:\n──────\n' + post.text + '\n──────\n\nОтправь новый текст (или часть для замены):',
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]) }
    );
  });

  // 🖼 Изменить фото поста
  bot.action('post_photo', async (ctx) => {
    await ctx.answerCbQuery();
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Сначала выбери запчасть.');
    setWaiting(ctx.chat.id, { type: 'edit_post_photo' });
    await ctx.reply(
      '🖼 Отправь новую ссылку на фото (URL) или пришли фото напрямую:',
      kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]])
    );
  });

  // ⏭ Пропустить
  bot.action('post_skip', async (ctx) => {
    await ctx.answerCbQuery('Пропущено');
    clearPendingPost(ctx.chat.id);
    await ctx.reply('⏭ Пропущено.', kb([[{ text: '🔄 Следующая запчасть', callback_data: 'post_auto' }, { text: '◀️ Меню', callback_data: 'menu_posts' }]]));
  });

  // ⏸ Пауза
  bot.action('post_pause', async (ctx) => {
    await ctx.answerCbQuery('⏸ Пауза');
    autoPostPaused = true;
    await showMenu(ctx, 'posts');
  });

  // ▶️ Возобновить
  bot.action('post_resume', async (ctx) => {
    await ctx.answerCbQuery('▶️ Возобновлён');
    autoPostPaused = false;
    await showMenu(ctx, 'posts');
  });

  // ⏰ Изменить интервал
  bot.action('post_interval', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'set_interval' });
    await ctx.reply(
      `⏰ Текущий интервал: *${process.env.AUTO_POST_INTERVAL_H || 3} часа*\n\nВведи новый интервал (в часах, от 1 до 48):`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]) }
    );
  });

  // 🔄 Перегенерировать текст поста (после редактирования марки)
  bot.action('post_regen', async (ctx) => {
    await ctx.answerCbQuery('⏳ Генерирую...');
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Пост не найден.');
    await ctx.reply('⏳ Перегенерирую текст...');
    try {
      post.text = await generatePostText(post.part);
      setPendingPost(ctx.chat.id, post);
      await ctx.reply(postPreviewText(post), { parse_mode: 'Markdown', ...postActionKb() });
    } catch (e) {
      await ctx.reply('❌ ' + e.message);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  КАТАЛОГ
  // ══════════════════════════════════════════════════════════════════════

  bot.action('cat_stats', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const [st, unpub] = await Promise.all([
        gasApi('status'),
        gasApi('unpublished'),
      ]);
      const total     = st.parts_total || 0;
      const published = st.parts_published || 0;
      const parts     = unpub.parts || [];
      const withPhoto = parts.filter(p => p.photo_cover || p.photo_1 || p.photo).length;
      const noPrice   = parts.filter(p => !Number(p.price)).length;
      const brands    = [...new Set(parts.map(p => p.brand).filter(Boolean))];
      await ctx.reply(
        `📊 *Каталог LegalAuto*\n\n` +
        `📦 Всего запчастей: *${total}*\n` +
        `✅ Опубликовано: *${published}*\n` +
        `⏳ Не опубликовано: *${total - published}*\n` +
        `📷 С фото (из очереди): *${withPhoto}*\n` +
        `💰 Без цены (из очереди): *${noPrice}*\n\n` +
        `🚗 Марки: ${brands.slice(0, 8).join(', ') || '—'}\n\n` +
        `⏰ Автопостинг: каждые ${process.env.AUTO_POST_INTERVAL_H || 3}ч`,
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_catalog' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('cat_unpub', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('unpublished');
      const parts = d.parts || [];
      if (!parts.length) return ctx.reply('✅ Все запчасти опубликованы!');
      const lines = parts.slice(0, 15).map((p, i) =>
        `${i+1}. [${p.id}] ${p.brand} — ${p.name} | ${Number(p.price||0).toLocaleString('ru-RU')} ₽`
      );
      await ctx.reply(
        `⏳ *Не опубликовано: ${parts.length}*\n\n${lines.join('\n')}\n\n_/postpart <ID> — запостить конкретную_`,
        { parse_mode: 'Markdown', ...kb([[{ text: '🤖 AI выбирает', callback_data: 'post_auto' }, { text: '◀️ Назад', callback_data: 'menu_catalog' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('cat_nophoto', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('unpublished');
      const noPhoto = (d.parts || []).filter(p => !p.photo_cover && !p.photo_1 && !p.photo);
      await ctx.reply(
        `📷 *Без фото (очередь): ${noPhoto.length}*\n\n` +
        noPhoto.slice(0, 15).map((p, i) => `${i+1}. [${p.id}] ${p.brand} — ${p.name}`).join('\n'),
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_catalog' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('cat_noprice', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('unpublished');
      const noPrice = (d.parts || []).filter(p => !Number(p.price));
      await ctx.reply(
        `💰 *Без цены (очередь): ${noPrice.length}*\n\n` +
        noPrice.slice(0, 15).map((p, i) => `${i+1}. [${p.id}] ${p.brand} — ${p.name || p.oem}`).join('\n'),
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_catalog' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('cat_topmargin', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('unpublished');
      const top = (d.parts || [])
        .filter(p => Number(p.price) > 0)
        .sort((a, b) => Number(b.price) - Number(a.price))
        .slice(0, 10);
      if (!top.length) return ctx.reply('Нет данных.', kb([[{ text: '◀️ Назад', callback_data: 'menu_catalog' }]]));
      await ctx.reply(
        `🏆 *Топ по цене (очередь):*\n\n` +
        top.map((p, i) =>
          `${i+1}. ${p.brand} — ${p.name}\n   💰 ${Number(p.price).toLocaleString('ru-RU')} ₽`
        ).join('\n\n'),
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_catalog' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  CRM
  // ══════════════════════════════════════════════════════════════════════

  // ── Вспомогательные функции CRM ───────────────────────────────────────
  function fmtLead(l, i) {
    const dt  = l.created_at ? new Date(l.created_at).toLocaleDateString('ru-RU') : '—';
    const who = l.client || (l.username ? '@' + l.username : l.chat_id || '—');
    const svc = l.source || l.stage || '—';
    const car = l.car || '—';
    const st  = { new: '🆕', work: '🔧', done: '✅', closed: '✅', skip: '❌' }[l.status] || '🆕';
    return `${st} *${i + 1}. ${svc}*\n👤 ${who} | 🚗 ${car}\n📅 ${dt}`;
  }

  function leadStatusKb(leadIdx) {
    return [
      [{ text: '🔧 В работе',  callback_data: `ls_work_${leadIdx}` },
       { text: '✅ Закрыть',   callback_data: `ls_done_${leadIdx}` }],
      [{ text: '❌ Отклонить', callback_data: `ls_skip_${leadIdx}` },
       { text: '◀️ Заявки',   callback_data: 'crm_leads'           }],
    ];
  }

  // хранилище последнего списка лидов (для смены статуса)
  const lastLeads = new Map();

  bot.action('crm_leads', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d    = await gasApi('leads');
      const leads = d.leads || [];
      if (!leads.length) return ctx.reply('📋 Заявок пока нет.', kb([[{ text: '◀️ Назад', callback_data: 'menu_crm' }]]));
      lastLeads.set(String(ctx.chat.id), leads);
      const lines = leads.slice(0, 10).map(fmtLead);
      const newCnt  = leads.filter(l => !l.status || l.status === 'new').length;
      const workCnt = leads.filter(l => l.status === 'work').length;
      await ctx.reply(
        `📋 *Последние заявки* (${leads.length} всего)\n🆕 Новых: ${newCnt} | 🔧 В работе: ${workCnt}\n\n` +
        lines.join('\n\n'),
        {
          parse_mode: 'Markdown',
          ...kb([
            [{ text: '🔀 Воронка',       callback_data: 'crm_funnel' },
             { text: '📊 По услугам',    callback_data: 'crm_by_svc' }],
            [{ text: '🆕 Смотреть новые', callback_data: 'crm_new'  }],
            [{ text: '◀️ Назад',         callback_data: 'menu_crm'  }],
          ])
        }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('crm_new', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d     = await gasApi('leads');
      const leads  = (d.leads || []).filter(l => !l.status || l.status === 'new');
      if (!leads.length) return ctx.reply('✅ Новых заявок нет!', kb([[{ text: '◀️ CRM', callback_data: 'menu_crm' }]]));
      lastLeads.set(String(ctx.chat.id), leads);
      for (let i = 0; i < Math.min(leads.length, 5); i++) {
        await ctx.reply(
          fmtLead(leads[i], i) + '\n\n' + (leads[i].data || '').slice(0, 300),
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: leadStatusKb(i) } }
        );
      }
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('crm_done', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d    = await gasApi('leads');
      const done = (d.leads || []).filter(l => l.status === 'done' || l.status === 'closed');
      if (!done.length) return ctx.reply('Завершённых заявок пока нет.', kb([[{ text: '◀️ CRM', callback_data: 'menu_crm' }]]));
      const lines = done.slice(0, 10).map(fmtLead).join('\n\n');
      await ctx.reply(`✅ *Завершённые заявки (${done.length})*\n\n${lines}`, {
        parse_mode: 'Markdown', ...kb([[{ text: '◀️ CRM', callback_data: 'menu_crm' }]])
      });
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('crm_funnel', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d     = await gasApi('leads');
      const leads  = d.leads || [];
      const total  = leads.length;
      const byStage = {
        '🆕 Новые':      leads.filter(l => !l.status || l.status === 'new').length,
        '🔧 В работе':   leads.filter(l => l.status === 'work').length,
        '✅ Закрыты':    leads.filter(l => l.status === 'done' || l.status === 'closed').length,
        '❌ Отклонены':  leads.filter(l => l.status === 'skip').length,
      };
      const bySvc = {};
      leads.forEach(l => {
        const s = l.source || 'Другое';
        bySvc[s] = (bySvc[s] || 0) + 1;
      });
      const svcLines = Object.entries(bySvc)
        .sort((a,b) => b[1] - a[1])
        .map(([s,n]) => `  ${s}: *${n}*`)
        .join('\n');
      const funnelLines = Object.entries(byStage)
        .map(([s,n]) => {
          const pct = total ? Math.round(n/total*100) : 0;
          const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10 - Math.round(pct/10));
          return `${s}: *${n}* (${pct}%)\n${bar}`;
        }).join('\n\n');
      await ctx.reply(
        `🔀 *Воронка продаж LegalAuto*\n📋 Всего заявок: *${total}*\n\n` +
        funnelLines +
        `\n\n📊 *По услугам:*\n${svcLines || '—'}`,
        { parse_mode: 'Markdown', ...kb([[{ text: '📥 Все заявки', callback_data: 'crm_leads' }, { text: '◀️ CRM', callback_data: 'menu_crm' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('crm_by_svc', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d    = await gasApi('leads');
      const leads = d.leads || [];
      const bySvc = {};
      leads.forEach(l => {
        const s = l.source || 'Другое';
        bySvc[s] = (bySvc[s] || 0) + 1;
      });
      const lines = Object.entries(bySvc)
        .sort((a,b) => b[1]-a[1])
        .map(([s,n]) => `• ${s}: *${n}*`)
        .join('\n');
      await ctx.reply(
        `📊 *Заявки по услугам:*\n\n${lines || 'Нет данных'}`,
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ CRM', callback_data: 'menu_crm' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  // Смена статуса лида + авто-ответ клиенту
  const CLIENT_REPLIES = {
    work: '✅ *Ваша заявка принята в работу!*\n\nМенеджер LegalAuto свяжется с вами в течение 30 минут.\n\nЕсли срочно — пишите @LegalAuto247',
    done: '🎉 *Ваша заявка выполнена!*\n\nСпасибо, что выбрали LegalAuto. Будем рады видеть вас снова!\n\n🔩 Каталог запчастей: /catalog',
    skip: '❕ *По вашей заявке уточняется информация.*\n\nМенеджер свяжется с вами дополнительно. Или пишите напрямую: @LegalAuto247',
  };

  for (const [action, status, label] of [
    ['work', 'work', '🔧 В работе'],
    ['done', 'done', '✅ Закрыта'],
    ['skip', 'skip', '❌ Отклонена'],
  ]) {
    bot.action(new RegExp(`^ls_${action}_(\\d+)$`), async (ctx) => {
      await ctx.answerCbQuery(label);
      const idx  = Number(ctx.match[1]);
      const leads = lastLeads.get(String(ctx.chat.id)) || [];
      const lead  = leads[idx];
      if (!lead) return ctx.reply('Заявка не найдена — обнови список.');
      try {
        // Обновить статус в GAS
        await gasApi('update_lead', { chat_id: lead.chat_id, status }).catch(() => {});
        // Обновить сообщение у админа
        await ctx.editMessageText(
          ctx.callbackQuery.message.text + `\n\n${label}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
        // Авто-ответ клиенту
        if (lead.chat_id && CLIENT_REPLIES[status]) {
          await replyToClient(lead.chat_id, CLIENT_REPLIES[status]);
          await ctx.reply(`📨 Клиент ${lead.username ? '@'+lead.username : lead.chat_id} уведомлён.`);
        }
      } catch (e) {
        await ctx.reply('❌ ' + e.message);
      }
    });
  }

  // Кнопки lead_ok / lead_skip из уведомления о новой заявке
  bot.action(/^lead_ok_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('✅ Принято');
    const clientId = ctx.match[1];
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *Принято в работу*',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    await replyToClient(clientId, CLIENT_REPLIES.work);
  });

  bot.action(/^lead_skip_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Пропущено');
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ *Пропущено*',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });

  // ── Написать клиенту прямо из adminBot ────────────────────────────────────
  bot.action(/^reply_client_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const clientId = ctx.match[1];
    setWaiting(ctx.chat.id, { type: 'reply_to_client', clientId });
    await ctx.reply(
      `📩 *Написать клиенту (id: ${clientId})*\n\nВведи сообщение — оно придёт в клиентский бот:`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '❌ Отмена', callback_data: 'back_main' },
      ]]}}
    );
  });

  // ── /broadcast — рассылка по всем клиентам ───────────────────────────────
  bot.command('broadcast', async (ctx) => {
    if (!(await guard(ctx))) return;
    const msgText = ctx.message.text.replace('/broadcast', '').trim();
    if (!msgText) {
      return ctx.reply(
        `📣 *Рассылка клиентам*\n\n` +
        `Используй: \`/broadcast Ваше сообщение\`\n\n` +
        `*Пример:*\n` +
        `\`/broadcast 🔥 Новое поступление BMW! Свежие запчасти — смотри каталог\`\n\n` +
        `Сообщение получат все клиенты которые писали в бот.`,
        { parse_mode: 'Markdown' }
      );
    }
    setWaiting(ctx.chat.id, { type: 'confirm_broadcast', broadcastText: msgText });
    const preview = msgText.length > 200 ? msgText.slice(0, 200) + '...' : msgText;
    await ctx.reply(
      `📣 *Подтвердить рассылку?*\n\n${preview}\n\n⚠️ Сообщение получат ВСЕ клиенты из CRM.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '✅ Отправить',  callback_data: 'broadcast_confirm' },
        { text: '❌ Отмена',     callback_data: 'back_main'         },
      ]]}}
    );
  });

  bot.action('broadcast_confirm', async (ctx) => {
    await ctx.answerCbQuery('📣 Рассылка запущена...');
    const waiting = getWaiting(ctx.chat.id);
    if (!waiting?.broadcastText) return ctx.reply('❌ Нет текста для рассылки.');
    clearWaiting(ctx.chat.id);

    const broadcastText = waiting.broadcastText;
    const clientToken   = process.env.CLIENT_BOT_TOKEN;
    if (!clientToken) return ctx.reply('❌ CLIENT_BOT_TOKEN не настроен');

    await ctx.reply('📣 Начинаю рассылку...');

    // Получаем всех клиентов из CRM
    const data   = await gasApi('leads').catch(() => ({ leads: [] }));
    const leads  = data.leads || [];
    const unique = [...new Set(leads.map(l => String(l.chat_id || '')).filter(Boolean))];

    let sent = 0, failed = 0;
    for (const chatId of unique) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${clientToken}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            chat_id:    chatId,
            text:       broadcastText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
              { text: '📦 Каталог', web_app: { url: 'https://legalauto.online/' } },
              { text: '📲 Менеджер', url: `https://t.me/${process.env.MANAGER_USERNAME || 'LegalAuto247'}` },
            ]]}
          }),
        });
        const d = await res.json();
        if (d.ok) sent++; else failed++;
      } catch { failed++; }
      // Пауза между сообщениями — Telegram ограничивает 30 msg/сек
      await new Promise(r => setTimeout(r, 50));
    }

    await ctx.reply(
      `✅ *Рассылка завершена*\n\n` +
      `📨 Отправлено: *${sent}*\n` +
      `❌ Не доставлено: *${failed}*\n` +
      `👥 Всего клиентов: *${unique.length}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /target — сегментная рассылка по марке ──────────────────────────────
  bot.command('target', async (ctx) => {
    if (!(await guard(ctx))) return;
    const args = ctx.message.text.replace('/target', '').trim();
    // Формат: /target BMW Текст сообщения
    const parts = args.split(' ');
    const brand = parts[0]?.toUpperCase();
    const msg   = parts.slice(1).join(' ');

    const BRANDS = ['BMW','GEELY','MERCEDES','AUDI','TOYOTA','LI','CHERY','HAVAL','LIXIANG'];
    if (!brand || !BRANDS.some(b => brand.startsWith(b))) {
      return ctx.reply(
        `🎯 *Сегментная рассылка по марке*\n\n` +
        `Формат: \`/target МАРКА Ваше сообщение\`\n\n` +
        `*Пример:*\n` +
        `\`/target BMW 🔥 Свежие запчасти BMW E60 — смотрите каталог!\`\n\n` +
        `Доступные марки: BMW, Geely, Mercedes, Audi, Toyota, Li Auto, Chery, Haval\n\n` +
        `Сообщение получат только клиенты которые интересовались этой маркой.`,
        { parse_mode: 'Markdown' }
      );
    }
    if (!msg) return ctx.reply('❌ Укажи текст сообщения после марки.');

    setWaiting(ctx.chat.id, { type: 'confirm_broadcast', broadcastText: msg, brand });
    await ctx.reply(
      `🎯 *Сегментная рассылка: ${brand}*\n\n${msg.slice(0, 200)}\n\n` +
      `⚠️ Получат только клиенты интересовавшиеся ${brand}.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '✅ Отправить', callback_data: `target_confirm_${brand}` },
        { text: '❌ Отмена',    callback_data: 'back_main'               },
      ]]}}
    );
  });

  // Обработка сегментной рассылки
  for (const brand of ['BMW','GEELY','MERCEDES','AUDI','TOYOTA','LI','CHERY','HAVAL']) {
    bot.action(`target_confirm_${brand}`, async (ctx) => {
      await ctx.answerCbQuery('🎯 Запускаю сегментную рассылку...');
      const waiting = getWaiting(ctx.chat.id);
      if (!waiting?.broadcastText) return ctx.reply('❌ Нет текста.');
      clearWaiting(ctx.chat.id);

      const clientToken = process.env.CLIENT_BOT_TOKEN;
      if (!clientToken) return ctx.reply('❌ CLIENT_BOT_TOKEN не настроен');

      const data  = await gasApi('leads').catch(() => ({ leads: [] }));
      const leads = data.leads || [];

      // Фильтруем по марке — ищем в поле car или data
      const brandLow  = brand.toLowerCase();
      const aliasMap  = { LI: ['li auto', 'li', 'lixiang', 'лиавто'], MERCEDES: ['mercedes', 'мерс', 'mb'] };
      const aliases   = aliasMap[brand] || [brandLow];

      const matched = leads.filter(l => {
        const haystack = `${l.car || ''} ${l.data || ''}`.toLowerCase();
        return aliases.some(a => haystack.includes(a)) || haystack.includes(brandLow);
      });
      const unique = [...new Set(matched.map(l => String(l.chat_id || '')).filter(Boolean))];

      if (!unique.length) {
        return ctx.reply(`❌ Нет клиентов интересовавшихся ${brand} в CRM.`);
      }

      await ctx.reply(`🎯 Рассылаю по ${unique.length} клиентам (${brand})...`);
      let sent = 0, failed = 0;
      for (const chatId of unique) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${clientToken}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id:    chatId,
              text:       waiting.broadcastText,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[
                { text: `📦 Запчасти ${brand}`, web_app: { url: 'https://legalauto.online/' } },
                { text: '📲 Написать',          url: `https://t.me/${process.env.MANAGER_USERNAME || 'LegalAuto247'}` },
              ]]}
            }),
          });
          const d = await res.json();
          if (d.ok) sent++; else failed++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 60));
      }
      await ctx.reply(
        `✅ *Сегментная рассылка завершена*\n\n` +
        `🎯 Марка: *${brand}*\n` +
        `📨 Отправлено: *${sent}*\n` +
        `❌ Не доставлено: *${failed}*\n` +
        `👥 Сегмент: *${unique.length}* клиентов`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  bot.action('crm_cars', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('cars').catch(() => null);
      const cars = d?.cars || [];
      if (!cars.length) return ctx.reply('🚗 CRM автомобили пусты.', kb([[{ text: '◀️ CRM', callback_data: 'menu_crm' }]]));
      const lines = cars.slice(0, 15).map((c, i) =>
        `${i+1}. 🚗 *${c.car || '—'}*\n👤 ${c.client || '—'} | 📞 ${c.phone || '—'}\n📌 ${c.stage || 'новый'}`
      ).join('\n\n');
      await ctx.reply(`🚗 *CRM Автомобили (${cars.length})*\n\n${lines}`, {
        parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_crm' }]])
      });
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  bot.action('crm_tasks', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const d = await gasApi('tasks').catch(() => null);
      await ctx.reply(d?.text || '📝 Задач пока нет.', kb([[{ text: '◀️ Назад', callback_data: 'menu_crm' }]]));
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  АНАЛИТИКА
  // ══════════════════════════════════════════════════════════════════════

  // ── Универсальный обработчик аналитики по периоду ─────────────────────────
  async function sendAnalytics(ctx, period) {
    const wait = await ctx.reply('⏳ Собираю статистику...');
    try {
      const stats = await getStats(period);
      const text  = formatReport(stats, period);
      const periodKb = kb([[
        { text: period === 'today' ? '✅ Сегодня' : 'Сегодня',   callback_data: 'an_today' },
        { text: period === 'week'  ? '✅ Неделя'  : 'Неделя',    callback_data: 'an_week'  },
        { text: period === 'month' ? '✅ Месяц'   : 'Месяц',     callback_data: 'an_month' },
        { text: period === 'all'   ? '✅ Всё время': 'Всё время', callback_data: 'an_all'   },
      ], [
        { text: '📋 Заявки (CRM)', callback_data: 'crm_leads'    },
        { text: '◀️ Меню',         callback_data: 'menu_analytics'},
      ]]);
      await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, null, text, {
        parse_mode: 'Markdown',
        ...periodKb,
      }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', ...periodKb }));
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, null, '❌ Ошибка: ' + e.message)
        .catch(() => {});
    }
  }

  bot.action('an_today', async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'today'); });
  bot.action('an_week',  async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'week');  });
  bot.action('an_month', async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'month'); });
  bot.action('an_all',   async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'all');   });

  // Старые кнопки — редирект
  bot.action('an_weekly',  async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'week'); });
  bot.action('an_status',  async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'today'); });
  bot.action('an_catalog', async (ctx) => { await ctx.answerCbQuery(); await sendAnalytics(ctx, 'all'); });
  bot.action('an_leads',   async (ctx) => { await ctx.answerCbQuery(); bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'crm_leads' } }); });

  bot.action('an_posts', async (ctx) => {
    await ctx.answerCbQuery('⏳');
    try {
      const st = await gasApi('status');
      const total     = st.parts_total || 0;
      const published = st.parts_published || 0;
      const schedule  = process.env.POST_SCHEDULE_TIMES || `каждые ${process.env.AUTO_POST_INTERVAL_H || 3}ч`;
      await ctx.reply(
        `📢 *Автопостинг*\n\n` +
        `✅ Опубликовано: *${published}*\n` +
        `⏳ В очереди: *${total - published}*\n` +
        `📦 Всего в каталоге: *${total}*\n` +
        `⏰ Расписание: ${schedule} МСК\n` +
        `${autoPostPaused ? '⏸ *На паузе*' : '▶️ *Автопостинг активен*'}`,
        { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Назад', callback_data: 'menu_analytics' }]]) }
      );
    } catch (e) { await ctx.reply('❌ ' + e.message); }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  НАСТРОЙКИ
  // ══════════════════════════════════════════════════════════════════════

  bot.action('set_interval', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'set_interval' });
    await ctx.reply(
      `⏰ Текущий интервал: *${process.env.AUTO_POST_INTERVAL_H || 3} ч*\n\nВведи новый (1–48):`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_settings' }]]) }
    );
  });

  bot.action('set_channel', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'set_channel' });
    await ctx.reply(
      `📢 Текущий канал: *${PARTS_CHANNEL || '@LegalAutoParts24'}*\n\nВведи новый (@username или -100xxx):`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_settings' }]]) }
    );
  });

  // 📅 Расписание по времени суток
  bot.action('set_schedule', async (ctx) => {
    await ctx.answerCbQuery();
    const cur = process.env.POST_SCHEDULE_TIMES || 'не задано (работает по интервалу)';
    setWaiting(ctx.chat.id, { type: 'set_schedule' });
    await ctx.reply(
      `📅 *Расписание постов по МСК*\n\nТекущее: *${cur}*\n\n` +
      `Введи время через запятую (формат ЧЧ:ММ):\n` +
      `Пример: \`10:00,14:00,19:00\`\n\n` +
      `Или напиши \`off\` чтобы вернуться к интервалу (${process.env.AUTO_POST_INTERVAL_H || 3}ч).`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_settings' }]]) }
    );
  });

  bot.action('set_clearmem', async (ctx) => {
    await ctx.answerCbQuery('Память сброшена');
    clearHistory(ctx.chat.id);
    await ctx.reply('🧹 Память AI сброшена.', kb([[{ text: '◀️ Назад', callback_data: 'menu_main' }]]));
  });

  // ── Редактирование марки/модели/цены поста ────────────────────────────
  bot.action('post_edit_brand', async (ctx) => {
    await ctx.answerCbQuery();
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Сначала выбери запчасть.');
    setWaiting(ctx.chat.id, { type: 'edit_brand' });
    await ctx.reply(
      `🚗 Текущее авто: *${post.part.display_car || post.part.brand}*\n\nВведи новое (например: BMW X5 E70 2010):`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]) }
    );
  });

  bot.action('post_edit_price', async (ctx) => {
    await ctx.answerCbQuery();
    const post = getPendingPost(ctx.chat.id);
    if (!post) return ctx.reply('Сначала выбери запчасть.');
    const cur = Number(post.part.price || 0).toLocaleString('ru-RU');
    setWaiting(ctx.chat.id, { type: 'edit_price' });
    await ctx.reply(
      `💰 Текущая цена: *${cur} ₽*\n\nВведи новую цену (только число):`,
      { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]) }
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  AI БЫСТРЫЕ КНОПКИ
  // ══════════════════════════════════════════════════════════════════════

  // ── Planning Agent action ────────────────────────────────────────────
  bot.action('ai_task_plan', async (ctx) => {
    await ctx.answerCbQuery();
    setWaiting(ctx.chat.id, { type: 'plan_task' });
    await ctx.reply(
      '🧠 *Planning Agent*\n\nОпиши задачу, цель или проблему — я разобью на конкретные шаги.\n\nПримеры:\n• _Как запустить Авито для запчастей BMW?_\n• _Нужно 10 новых клиентов на СБКТС за месяц_\n• _Сделай план контент-маркетинга на 30 дней_',
      { parse_mode: 'Markdown', ...kb([[{ text: '❌ Отмена', callback_data: 'menu_ai' }]]) }
    );
  });

  const AI_PROMPTS = {
    ai_post:   'Сгенерируй продающий пост для Telegram-канала @LegalAutoParts24. Марка на выбор: BMW, Geely или Li Auto. Используй эмодзи, цену и OEM.',
    ai_plan:   'Составь контент-план для @LegalAutoParts24 на 7 дней. Темы: запчасти BMW/Geely/Li Auto, СБКТС/ЭПТС, советы, акции.',
    ai_promo:  'Предложи 5 идей акций для LegalAuto (запчасти + оформление документов). Для BMW, Geely, Li Auto и других марок.',
    ai_report: 'Сделай краткий еженедельный отчёт для LegalAuto: запчасти, заявки на СБКТС/ЭПТС, что улучшить.',
  };

  for (const [action, prompt] of Object.entries(AI_PROMPTS)) {
    bot.action(action, async (ctx) => {
      await ctx.answerCbQuery('⏳ AI думает...');
      await ctx.reply('⏳ Генерирую...');
      try {
        const reply = await askAI(ctx.chat.id, prompt);
        await ctx.reply(reply, kb([[{ text: '🔄 Ещё', callback_data: action }, { text: '◀️ Назад', callback_data: 'menu_ai' }]]));
      } catch (e) { await ctx.reply('❌ ' + e.message); }
    });
  }

  // ── /addmanager <telegram_id> — выдать доступ менеджеру ─────────────────
  bot.command('addmanager', async (ctx) => {
    if (!(await guard(ctx))) return;
    const arg = ctx.message.text.replace('/addmanager', '').trim();
    if (!arg || !/^\d+$/.test(arg)) {
      return ctx.reply(
        `Использование: \`/addmanager 123456789\`\n\nUкажите числовой Telegram ID менеджера.`,
        { parse_mode: 'Markdown' }
      );
    }
    const current = (process.env.MANAGER_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (current.includes(arg)) {
      return ctx.reply(`⚠️ Менеджер \`${arg}\` уже добавлен.`, { parse_mode: 'Markdown' });
    }
    current.push(arg);
    process.env.MANAGER_CHAT_IDS = current.join(',');
    console.log(`[AdminBot] /addmanager — добавлен менеджер ${arg}. Текущий список: ${process.env.MANAGER_CHAT_IDS}`);
    await ctx.reply(
      `✅ *Менеджер добавлен!*\n\n` +
      `ID: \`${arg}\`\n` +
      `Теперь у него есть доступ к просмотру заявок и обновлению статусов.\n\n` +
      `⚠️ Важно: это изменение сбросится при перезапуске Railway. Добавьте \`${arg}\` в переменную окружения \`MANAGER_CHAT_IDS\` в Railway → Variables для постоянного сохранения.`,
      { parse_mode: 'Markdown' }
    );
    // Уведомить нового менеджера
    const clientToken = process.env.CLIENT_BOT_TOKEN || process.env.ADMIN_BOT_TOKEN;
    if (clientToken) {
      await fetch(`https://api.telegram.org/bot${clientToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: arg,
          text: `👋 Вас добавили как менеджера платформы *LegalAuto*.\n\nНовые заявки от клиентов будут приходить сюда.\n\nНапишите /start в боте @LegalAutoAgentUprav_Bot для начала работы.`,
          parse_mode: 'Markdown',
        }),
      }).catch(() => {});
    }
  });

  // ── /managers — список текущих менеджеров ────────────────────────────────
  bot.command('managers', async (ctx) => {
    if (!(await guard(ctx))) return;
    const ids = (process.env.MANAGER_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) {
      return ctx.reply(
        `📋 *Менеджеры не добавлены.*\n\nДобавить: \`/addmanager <telegram_id>\``,
        { parse_mode: 'Markdown' }
      );
    }
    const lines = ids.map((id, i) => `${i + 1}. \`${id}\``).join('\n');
    await ctx.reply(
      `👥 *Текущие менеджеры (${ids.length}):*\n\n${lines}\n\n` +
      `Добавить: \`/addmanager <id>\`\n` +
      `Удалить: \`/removemanager <id>\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /removemanager <telegram_id> — снять доступ менеджера ────────────────
  bot.command('removemanager', async (ctx) => {
    if (!(await guard(ctx))) return;
    const arg = ctx.message.text.replace('/removemanager', '').trim();
    if (!arg || !/^\d+$/.test(arg)) {
      return ctx.reply('Использование: `/removemanager 123456789`', { parse_mode: 'Markdown' });
    }
    const current = (process.env.MANAGER_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const filtered = current.filter(id => id !== arg);
    if (filtered.length === current.length) {
      return ctx.reply(`⚠️ Менеджер \`${arg}\` не найден в списке.`, { parse_mode: 'Markdown' });
    }
    process.env.MANAGER_CHAT_IDS = filtered.join(',');
    console.log(`[AdminBot] /removemanager — удалён менеджер ${arg}`);
    await ctx.reply(
      `✅ Менеджер \`${arg}\` удалён.\n\nОстались: ${filtered.length > 0 ? filtered.join(', ') : 'нет'}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  ТЕКСТОВЫЕ СООБЩЕНИЯ — обработка ожидающего ввода + свободный диалог
  // ══════════════════════════════════════════════════════════════════════

  bot.on('text', async (ctx) => {
    if (!(await guard(ctx))) return;
    const text    = ctx.message.text;
    if (text.startsWith('/')) return;

    const waiting = getWaiting(ctx.chat.id);

    // ── Ожидаем ввод ──────────────────────────────────────────────────
    if (waiting) {
      clearWaiting(ctx.chat.id);

      if (waiting.type === 'news_edit_text') {
        const { newsId } = waiting;
        const pending = getPendingNewsPost(newsId);
        if (!pending) return ctx.reply('❌ Пост не найден.');
        pending.text = text;
        const ok = await publishNewsToChannel(text);
        clearPendingNewsPost(newsId);
        if (ok) {
          await ctx.reply('✅ Отредактированный пост опубликован в @LegalAuto24!');
        } else {
          await ctx.reply('❌ Ошибка публикации.');
        }
        return;
      }

      if (waiting.type === 'edit_post_text') {
        const post = getPendingPost(ctx.chat.id);
        if (!post) return ctx.reply('Пост не найден. Начни заново через меню.');
        post.text = text;
        setPendingPost(ctx.chat.id, post);
        await ctx.reply('✅ Текст обновлён!', postActionKb());
        return;
      }

      if (waiting.type === 'edit_post_photo') {
        const post = getPendingPost(ctx.chat.id);
        if (!post) return ctx.reply('Пост не найден.');
        if (text.startsWith('http')) {
          post.photo = text;
          post.part.photo_cover = text;
          setPendingPost(ctx.chat.id, post);
          await ctx.reply('✅ Фото обновлено!', postActionKb());
        } else {
          await ctx.reply('Отправь прямую ссылку на фото (https://...)');
        }
        return;
      }

      if (waiting.type === 'post_by_id') {
        await ctx.reply(`⏳ Генерирую пост для ID ${text}...`);
        try {
          const result = await preparePostById(ctx.chat.id, text.trim());
          if (!result.ok) return ctx.reply('❌ ' + result.error);
          await ctx.reply(postPreviewText(result.post), { parse_mode: 'Markdown', ...postActionKb() });
        } catch (e) { await ctx.reply('❌ ' + e.message); }
        return;
      }

      if (waiting.type === 'edit_brand') {
        const post = getPendingPost(ctx.chat.id);
        if (!post) return ctx.reply('Пост не найден.');
        post.part.display_car = text.trim();
        post.part.brand = text.trim().split(' ')[0];
        // Перегенерируем текст с новым авто
        setWaiting(ctx.chat.id, { type: 'regen_confirm', field: 'brand' });
        post._brandUpdated = text.trim();
        setPendingPost(ctx.chat.id, post);
        clearWaiting(ctx.chat.id);
        await ctx.reply(
          `✅ Авто обновлено: *${text.trim()}*\n\nХочешь перегенерировать текст поста с новыми данными?`,
          { parse_mode: 'Markdown', ...kb([
            [{ text: '🔄 Да, перегенерировать', callback_data: 'post_regen' },
             { text: '✅ Оставить текст', callback_data: 'menu_posts' }]
          ]) }
        );
        return;
      }

      if (waiting.type === 'edit_price') {
        const post = getPendingPost(ctx.chat.id);
        if (!post) return ctx.reply('Пост не найден.');
        const newPrice = Number(text.replace(/[^\d.]/g, ''));
        if (!newPrice || newPrice <= 0) return ctx.reply('❌ Введи корректную цену (только число).', kb([[{ text: '◀️ Отмена', callback_data: 'menu_posts' }]]));
        post.part.price = newPrice;
        // Заменяем цену в тексте поста
        const priceStr = newPrice.toLocaleString('ru-RU');
        post.text = post.text.replace(/\d[\d\s]*[\s]*₽/g, `${priceStr} ₽`);
        setPendingPost(ctx.chat.id, post);
        await ctx.reply(
          `✅ Цена обновлена: *${priceStr} ₽*`,
          { parse_mode: 'Markdown', ...postActionKb() }
        );
        return;
      }

      // ── Написать клиенту из adminBot ─────────────────────────────────
      if (waiting.type === 'reply_to_client') {
        const clientId    = waiting.clientId;
        const clientToken = process.env.CLIENT_BOT_TOKEN;
        if (!clientToken) return ctx.reply('❌ CLIENT_BOT_TOKEN не настроен');
        try {
          const res = await fetch(`https://api.telegram.org/bot${clientToken}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              chat_id:    String(clientId),
              text:       `💬 *Сообщение от LegalAuto:*\n\n${text}`,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[
                { text: '💬 Ответить',         callback_data: 'svc_buy'    },
                { text: '📲 Написать менеджеру', url: `https://t.me/${process.env.MANAGER_USERNAME || 'LegalAuto247'}` },
              ]]}
            }),
          });
          const d = await res.json();
          if (d.ok) {
            await ctx.reply(`✅ Сообщение отправлено клиенту (id: ${clientId})`);
          } else {
            await ctx.reply(`❌ Ошибка отправки: ${d.description}`);
          }
        } catch (e) {
          await ctx.reply(`❌ Ошибка: ${e.message}`);
        }
        return;
      }

      // ── Подтверждение рассылки (текстовый ввод) ──────────────────────
      if (waiting.type === 'confirm_broadcast') {
        // Пользователь напечатал что-то вместо нажатия кнопки — игнорируем
        await ctx.reply('Нажми *✅ Отправить* или *❌ Отмена* выше.', { parse_mode: 'Markdown' });
        setWaiting(ctx.chat.id, waiting); // восстановить
        return;
      }

      // ── Ответ Максу в режиме чата ─────────────────────────────────────
      if (waiting.type === 'partner_message') {
        clearWaiting(ctx.chat.id);
        const thinking = await ctx.reply('🤔 Макс думает...');
        try {
          const history = (partnerHistory || new Map()).get(String(ctx.chat.id)) || [];
          const result  = await askPartner(text, history);
          if (partnerHistory) partnerHistory.set(String(ctx.chat.id), result.history || []);
          await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null,
            `🤖 *Макс:*\n\n${result.text}`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
              { text: '💬 Ответить',       callback_data: 'partner_chat'  },
              { text: '🔄 Новый разговор', callback_data: 'partner_reset' },
            ]]}}
          ).catch(() => ctx.reply(`🤖 *Макс:*\n\n${result.text}`, { parse_mode: 'Markdown' }));
        } catch (e) {
          await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
          await ctx.reply('❌ Ошибка: ' + e.message);
        }
        return;
      }

      if (waiting.type === 'set_interval') {
        const h = Number(text);
        if (!h || h < 1 || h > 48) return ctx.reply('❌ Введи число от 1 до 48.', kb([[{ text: '◀️ Отмена', callback_data: 'menu_settings' }]]));
        process.env.AUTO_POST_INTERVAL_H = String(h);
        process.env.POST_SCHEDULE_TIMES  = '';  // отключаем расписание
        await ctx.reply(
          `✅ Интервал обновлён: каждые *${h}ч*\n\n_Чтобы сохранить навсегда — обнови AUTO_POST_INTERVAL_H в Railway._`,
          { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Настройки', callback_data: 'menu_settings' }]]) }
        );
        return;
      }

      if (waiting.type === 'set_schedule') {
        const val = text.trim().toLowerCase();
        if (val === 'off') {
          process.env.POST_SCHEDULE_TIMES = '';
          await ctx.reply(
            `✅ Расписание отключено. Работает интервал: ${process.env.AUTO_POST_INTERVAL_H || 3}ч`,
            kb([[{ text: '◀️ Настройки', callback_data: 'menu_settings' }]])
          );
        } else {
          // Валидация формата ЧЧ:ММ
          const times = text.split(',').map(t => t.trim());
          const valid = times.every(t => /^\d{1,2}:\d{2}$/.test(t));
          if (!valid) {
            setWaiting(ctx.chat.id, { type: 'set_schedule' });
            return ctx.reply('❌ Неверный формат. Пример: `10:00,14:00,19:00`', { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Отмена', callback_data: 'menu_settings' }]]) });
          }
          process.env.POST_SCHEDULE_TIMES = times.join(',');
          await ctx.reply(
            `✅ Расписание сохранено: *${times.join(', ')} МСК*\n\n_Сохрани POST_SCHEDULE_TIMES в Railway для постоянства._`,
            { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Настройки', callback_data: 'menu_settings' }]]) }
          );
        }
        return;
      }

      // 🧠 Planning Agent
      if (waiting.type === 'plan_task') {
        await buildPlan(ctx, text);
        return;
      }

      if (waiting.type === 'set_channel') {
        process.env.PARTS_CHANNEL = text.trim();
        await ctx.reply(
          `✅ Канал изменён: *${text.trim()}*`,
          { parse_mode: 'Markdown', ...kb([[{ text: '◀️ Настройки', callback_data: 'menu_settings' }]]) }
        );
        return;
      }
    }

    // ── VIN декодирование ────────────────────────────────────────────
    const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
    if (vinMatch) {
      await ctx.reply('🔍 Декодирую VIN...');
      try {
        const info = await decodeVin(vinMatch[0]);
        await ctx.reply(formatVinResult(info), { parse_mode: 'Markdown' });
      } catch (e) { /* продолжаем к AI */ }
      return;
    }

    // ── CRM роутинг ──────────────────────────────────────────────────
    if (looksCrmCommand(text)) {
      await ctx.reply('📋 Сохраняю в CRM...');
      try {
        const result = await handleCrmText(text, ctx.chat.id);
        if (result) {
          await ctx.reply(result, kb([[{ text: '📋 CRM', callback_data: 'menu_crm' }, { text: '🏠 Меню', callback_data: 'menu_main' }]]));
          return;
        }
      } catch (e) { /* fallthrough к AI */ }
    }

    // ── Свободный диалог с AI ────────────────────────────────────────
    await ctx.reply('⏳ Думаю...');
    try {
      const reply = await askAI(ctx.chat.id, text);
      await ctx.reply(reply, kb([[{ text: '🏠 Меню', callback_data: 'menu_main' }]]));
    } catch (e) {
      await ctx.reply('❌ Ошибка AI: ' + e.message);
    }
  });

  // ── Фото от пользователя — обновить фото поста ────────────────────
  bot.on('photo', async (ctx) => {
    if (!(await guard(ctx))) return;
    const waiting = getWaiting(ctx.chat.id);
    if (waiting?.type === 'edit_post_photo') {
      clearWaiting(ctx.chat.id);
      const post = getPendingPost(ctx.chat.id);
      if (!post) return ctx.reply('Пост не найден.');
      const fileId = ctx.message.photo.at(-1).file_id;
      post.photo = fileId;
      setPendingPost(ctx.chat.id, post);
      await ctx.reply('✅ Фото обновлено!', postActionKb());
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  СОГЛАСОВАНИЕ ПОСТОВ @LegalAuto24 (newsBot)
  // ══════════════════════════════════════════════════════════════════════

  // Динамический обработчик для кнопок вида news_approve_<id>, news_reject_<id>, news_edit_<id>
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data || '';

    if (data.startsWith('news_approve_')) {
      const id = data.replace('news_approve_', '');
      const pending = getPendingNewsPost(id);
      if (!pending) return ctx.answerCbQuery('❌ Пост не найден или уже обработан');

      await ctx.answerCbQuery('✅ Публикую...');
      const ok = await publishNewsToChannel(pending.text);
      clearPendingNewsPost(id);

      if (ok) {
        await ctx.editMessageText(`✅ Опубликовано в @LegalAuto24!\n\n${pending.text.substring(0, 200)}...`);
      } else {
        await ctx.editMessageText('❌ Ошибка публикации. Проверь NEWS_CHANNEL_ID и ADMIN_BOT_TOKEN.');
      }
      return;
    }

    if (data.startsWith('news_reject_')) {
      const id = data.replace('news_reject_', '');
      clearPendingNewsPost(id);
      await ctx.answerCbQuery('🗑 Отклонено');
      await ctx.editMessageText('❌ Пост отклонён и удалён.');
      return;
    }

    if (data.startsWith('news_edit_')) {
      const id = data.replace('news_edit_', '');
      const pending = getPendingNewsPost(id);
      if (!pending) return ctx.answerCbQuery('❌ Пост не найден');

      await ctx.answerCbQuery('✏️ Пришли новый текст');
      setWaiting(ctx.chat.id, { type: 'news_edit_text', newsId: id });
      await ctx.reply('✏️ Напиши новый текст поста для @LegalAuto24. Отправь текст сообщением:');
      return;
    }

    // ── Авто объявления: одобрение / отклонение ──────────────────────────────
    if (data.startsWith('autoads_approve_')) {
      const id      = data.replace('autoads_approve_', '');
      const pending = getPendingAd(id);
      if (!pending) return ctx.answerCbQuery('❌ Объявление не найдено');

      await ctx.answerCbQuery('✅ Публикую...');
      const ok = await publishAd(pending.text, pending.photos);
      clearPendingAd(id);

      await ctx.editMessageText(
        ok
          ? `✅ Объявление опубликовано!\n\n${pending.text.substring(0, 200)}...`
          : '❌ Ошибка публикации. Проверь AUTO_ADS_CHANNEL и ADMIN_BOT_TOKEN.'
      );
      return;
    }

    if (data.startsWith('autoads_reject_')) {
      const id = data.replace('autoads_reject_', '');
      clearPendingAd(id);
      await ctx.answerCbQuery('🗑 Пропущено');
      await ctx.editMessageText('❌ Объявление пропущено.');
      return;
    }

    if (data.startsWith('autoads_orig_')) {
      const id      = data.replace('autoads_orig_', '');
      const pending = getPendingAd(id);
      if (!pending) return ctx.answerCbQuery('❌ Не найдено');
      await ctx.answerCbQuery('📄 Оригинал');
      await ctx.reply(`📄 *Оригинал из "${pending.channelName}":*\n\n${pending.originalText?.substring(0, 800) || '—'}`, { parse_mode: 'Markdown' });
      return;
    }
  });

  // Обработка редактирования текста новостного поста (в блоке 'text')
  // Уже добавлено ниже в waiting.type === 'news_edit_text'

  console.log('✅ Admin bot v5 handlers registered — CRM+Analytics+Avito+NewsApproval');
}

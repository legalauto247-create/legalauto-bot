/**
 * LegalAuto — Client Bot v2
 * @LegalAutoAssist_bot
 *
 * Функции:
 *  - Подбор запчастей по марке/модели (BMW, Geely, Li Auto, Mercedes, Audi, Toyota + другие)
 *  - Оформление СБКТС / ЭПТС / Утильсбор / Таможня (AI диалог)
 *  - Калькулятор утильсбора (точные ставки 2024)
 *  - Сохранение заявок в Google Sheets
 *  - Уведомление менеджера о каждой заявке
 */

import https from 'https';
import http from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { notifyNewLead } from './adminBot.js';
import { autoReplyToClient } from '../agents/brainAgent.js';
import { decodeVin, formatVinResult } from '../agents/vinDecoder.js';
import { buildZzapUrls, searchZzap, formatManagerZzapMsg, applyMarkupAndFormat } from '../agents/zzapAgent.js';
import { addSubscription, removeSubscriptions, getSubscriptions } from '../agents/alertAgent.js';
import { handleSalesMessage, isSalesIntent, salesKeyboard, clearSalesMemory } from '../agents/salesAgent.js';
import { getOrCreateRefLink, handleRefStart, onFriendCreatedLead, getUserRefStats } from '../agents/referralAgent.js';
import { getResaleOffer, buildResaleKeyboard, formatClientResaleMsg } from '../agents/zzapAgent.js';
import { setupLeadMonitoring } from '../agents/leadGenAgent.js';
import { trackPartQuery } from '../agents/trendingAgent.js';
import { registerLead, removeLead, markHandled } from '../agents/watchdogAgent.js';
import { smartMatch, isPartsRequest } from '../agents/smartMatchAgent.js';
import { orchestrate } from '../agents/masterAgent.js';
import { classifyLead } from '../agents/dualBrainAgent.js';

const {
  CLAUDE_API_KEY,
  GEMINI_API_KEY,
  APPS_SCRIPT_API_URL,
  ADMIN_BOT_TOKEN,
  ADMIN_CHAT_ID,
  MANAGER_USERNAME,
  PARTS_CHANNEL,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;
const genAI  = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const MINI_APP_URL = 'https://legalauto.online/';
const MGR = MANAGER_USERNAME || 'LegalAuto247';

// ── Состояния диалогов ────────────────────────────────────────────────────────
const clientStates = new Map();
function getState(id)       { return clientStates.get(String(id)); }
function setState(id, s)    { clientStates.set(String(id), s); }
function clearState(id)     { clientStates.delete(String(id)); }

// ── Ставки утильсбора 2024 (руб) ─────────────────────────────────────────────
const UTIL_RATES = {
  physical: {
    // [до_см3]: ставка
    ranges: [
      { max: 1000, rate: 3_400 },
      { max: 2000, rate: 8_900 },
      { max: 3000, rate: 16_900 },
      { max: 3500, rate: 20_200 },
      { max: Infinity, rate: 26_100 },
    ],
    electric: 3_400,
  },
  legal: {
    ranges: [
      { max: 1000, rate: 84_000 },
      { max: 2000, rate: 126_000 },
      { max: 3000, rate: 252_000 },
      { max: 3500, rate: 378_000 },
      { max: Infinity, rate: 504_000 },
    ],
    electric: 84_000,
  }
};

function calcUtil(volumeCc, isLegal, isElectric) {
  const table = isLegal ? UTIL_RATES.legal : UTIL_RATES.physical;
  if (isElectric) return table.electric;
  const vol = Number(volumeCc || 0);
  for (const r of table.ranges) {
    if (vol <= r.max) return r.rate;
  }
  return table.ranges[table.ranges.length - 1].rate;
}

// ── AI ────────────────────────────────────────────────────────────────────────
async function askAI(systemPrompt, history, maxTokens = 600) {
  if (claude) {
    try {
      const msg = await claude.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   history,
      });
      return msg.content[0].text.trim();
    } catch (err) {
      console.error('[ClientBot] Claude error:', err.message);
    }
  }
  if (genAI) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const ctx = history.slice(-6).map(m =>
      `${m.role === 'user' ? 'Клиент' : 'Ассистент'}: ${m.content}`
    ).join('\n');
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + ctx }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens }
    });
    return result.response.text().trim();
  }
  throw new Error('AI недоступен');
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

async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return null;
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    // node-fetch следует 302-редиректам (GAS всегда делает redirect)
    const res  = await fetch(url.toString(), {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    console.error('[ClientBot] gasGet error:', e.message);
    return null;
  }
}

async function saveLead(chatId, service, data, username) {
  const p = parseLeadData(data);
  await gasGet('save_lead', {
    source: service, chat_id: chatId, username: username || '',
    car: p.car, client: p.client, phone: p.phone, stage: p.stage,
    data: data.substring(0, 800)
  });
  // Реферальный бонус — если клиент пришёл по чужой ссылке
  onFriendCreatedLead(chatId).catch(() => {});
}

function parseLeadData(text) {
  const get = (...keys) => {
    for (const key of keys) {
      const m = text.match(new RegExp(key + '[:\\s]+(.+)', 'i'));
      if (m) return m[1].trim().replace(/\*+/g, '');
    }
    return '';
  };
  return {
    car:    get('Марка.?модель', 'Авто', 'Марка'),
    client: get('Клиент', 'ФИО', 'Контакт'),
    phone:  get('Телефон', 'Тел'),
    stage:  get('Связь', 'Статус'),
  };
}

// ── Список менеджеров (ADMIN_CHAT_ID + MANAGER_CHAT_IDS через запятую) ────────
function getManagerChatIds() {
  const ids = [];
  if (ADMIN_CHAT_ID) ids.push(String(ADMIN_CHAT_ID).trim());
  const extra = process.env.MANAGER_CHAT_IDS || '';
  extra.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
    if (!ids.includes(id)) ids.push(id);
  });
  return ids;
}

async function sendToAllManagers(payload) {
  if (!ADMIN_BOT_TOKEN) return;
  const ids = getManagerChatIds();
  await Promise.all(ids.map(chat_id =>
    fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...payload, chat_id }),
    }).catch(() => {})
  ));
}

// ── VIN-поиск: уведомление менеджеров + ZZap ─────────────────────────────────
async function notifyManagerVinSearch({ chatId, username, vin, make, model, year,
                                        partName, partsFound, topParts, zzapResult: providedZzap }) {
  if (!ADMIN_BOT_TOKEN) return;

  // Используем готовый результат ZZap если он уже был получен, иначе ищем
  const zzapResult = providedZzap ?? await searchZzap({ make, model, year, partName })
    .catch(() => ({ ok: false, results: [] }));

  const { text: msg } = formatManagerZzapMsg({
    vin, make, model, year, partName,
    partsInStock:  partsFound,
    topStockParts: topParts,
    zzapResult,
    username, chatId,
  });

  const zzapUrls = buildZzapUrls({ make, model, year, partName, vin });
  const buttons  = [
    zzapUrls[0] && { text: '🔍 ZZap поиск',  url: zzapUrls[0].url },
    zzapUrls[1] && { text: '🚗 VIN на ZZap', url: zzapUrls[1]?.url || zzapUrls[0].url },
  ].filter(Boolean);

  await sendToAllManagers({
    text:                     msg,
    parse_mode:               'Markdown',
    disable_web_page_preview: false,
    reply_markup:             buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined,
  });
}

async function notifyManager(service, chatId, username, leadText) {
  if (!ADMIN_BOT_TOKEN) return;
  const who  = username ? `@${username}` : `chat_id: ${chatId}`;
  const text = `🔔 *Новая заявка — ${service}*\n\nКлиент: ${who}\n\n${leadText.substring(0, 1500)}`;
  await sendToAllManagers({ text, parse_mode: 'Markdown' });
}

// ── Промпты услуг ─────────────────────────────────────────────────────────────
const SERVICE_PROMPTS = {
  sbkts: `Ты консультант LegalAuto — оформление СБКТС (свидетельство безопасности конструкции ТС).
Собирай данные ПО ОДНОМУ вопросу:
1. Марка и модель автомобиля
2. Год выпуска
3. VIN-номер
4. Страна ввоза (Япония / Корея / Германия / Китай / другое)
5. ФИО или название компании
6. Контактный телефон
7. Удобный способ связи (WhatsApp / Telegram / звонок)

Когда все 7 пунктов собраны, напиши СТРОГО:
LEAD_READY
Марка/модель: ...
Год: ...
VIN: ...
Страна: ...
Клиент: ...
Телефон: ...
Связь: ...

Правила: один вопрос за раз, дружелюбно, по-русски.`,

  epts: `Ты консультант LegalAuto — оформление ЭПТС (электронный паспорт ТС).
Собирай по одному вопросу:
1. Марка и модель
2. Год выпуска
3. VIN-номер
4. Есть ли уже СБКТС? (да/нет; если да — номер)
5. ФИО или название организации
6. Телефон
7. Email (если есть)

Когда всё собрано:
LEAD_READY
Марка/модель: ...
Год: ...
VIN: ...
СБКТС: ...
Клиент: ...
Телефон: ...
Email: ...`,

  util: `Ты консультант LegalAuto — утилизационный сбор для ввозимых авто.
Собирай данные:
1. Марка и модель
2. Год выпуска
3. Объём двигателя в см³ (или "электромобиль")
4. Физическое или юридическое лицо?
5. Авто уже в России или ещё везут?
6. Имя и телефон для связи

Когда собрано:
LEAD_READY
Марка/модель: ...
Год: ...
Двигатель: ...
Тип: ...
Статус: ...
Контакт: ...`,

  customs: `Ты консультант LegalAuto — таможенное оформление автомобилей.
Собирай:
1. Откуда везут (страна)
2. Марка, модель, год
3. Примерная стоимость авто (в валюте)
4. Физическое или юридическое лицо?
5. Нужен ли предварительный расчёт пошлин?
6. Имя и телефон

Когда собрано:
LEAD_READY
Страна: ...
Авто: ...
Стоимость: ...
Тип: ...
Расчёт: ...
Контакт: ...`,

  parts: `Ты консультант LegalAuto — б/у запчасти (BMW, Geely, Li Auto, Mercedes, Audi, Toyota).
Помогай клиенту найти нужную запчасть. Собирай:
1. Марка автомобиля
2. Модель и год
3. Какая запчасть нужна
4. OEM артикул (если знает)
5. Состояние (оригинал б/у / новое)
6. Телефон или Telegram для связи

Когда данные собраны:
LEAD_READY
Марка/модель: ...
Запчасть: ...
OEM: ...
Состояние: ...
Контакт: ...

Если клиент просто смотрит — предложи открыть каталог или написать менеджеру.`,
};

const SVC_NAMES = {
  sbkts:   '📋 СБКТС',
  epts:    '📄 ЭПТС',
  util:    '♻️ Утильсбор',
  customs: '🛃 Таможня',
  parts:   '🔩 Запчасти',
};

// ── Клавиатуры ────────────────────────────────────────────────────────────────
const KB_MAIN = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🛒 Купить запчасть',          callback_data: 'svc_buy'     },
        { text: '📦 Весь каталог',             web_app: { url: MINI_APP_URL } },
      ],
      [
        { text: '🔍 Найти по VIN-номеру',      callback_data: 'svc_vin'     },
        { text: '🔔 Уведомить о поступлении',  callback_data: 'svc_alert'   },
      ],
      [
        { text: '📋 СБКТС / ЭПТС',            callback_data: 'svc_docs'    },
        { text: '🛃 Таможня / Утильсбор',     callback_data: 'svc_customs' },
      ],
      [
        { text: '🧮 Калькулятор утильсбора',  callback_data: 'calc_util'   },
        { text: '📲 Написать менеджеру',       callback_data: 'svc_manager' },
      ],
      [
        { text: '📋 Статус моей заявки',       callback_data: 'svc_status'  },
        { text: '🎁 Пригласить друга (+500₽)', callback_data: 'svc_ref'     },
      ],
    ]
  }
};

const KB_BRANDS = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🚗 BMW',      callback_data: 'brand_BMW'      },
        { text: '🚗 Geely',    callback_data: 'brand_Geely'    },
        { text: '🚗 Li Auto',  callback_data: 'brand_Li Auto'  },
      ],
      [
        { text: '🚗 Mercedes', callback_data: 'brand_Mercedes' },
        { text: '🚗 Audi',     callback_data: 'brand_Audi'     },
        { text: '🚗 Toyota',   callback_data: 'brand_Toyota'   },
      ],
      [
        { text: '🔍 Другая марка',  callback_data: 'brand_other' },
        { text: '← Главное меню',   callback_data: 'back_main'   },
      ],
    ]
  }
};

// Утильсбор — выбор типа лица
const KB_UTIL_TYPE = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '👤 Физическое лицо',   callback_data: 'util_phys'  },
        { text: '🏢 Юридическое лицо',  callback_data: 'util_legal' },
      ],
      [{ text: '← Главное меню', callback_data: 'back_main' }]
    ]
  }
};

// Кнопки документов
const KB_DOCS = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 СБКТС',  callback_data: 'svc_sbkts' },
        { text: '📄 ЭПТС',   callback_data: 'svc_epts'  },
      ],
      [{ text: '← Главное меню', callback_data: 'back_main' }]
    ]
  }
};

function welcomeText(name) {
  const n = name ? `, ${name}` : '';
  return (
    `👋 Привет${n}! Это *LegalAuto* — б/у запчасти с разборки и помощь с оформлением авто.\n\n` +
    `🔩 *Запчасти:* BMW · Geely · Li Auto · Mercedes · Audi · Toyota\n` +
    `📋 *Документы:* СБКТС · ЭПТС · Утильсбор · Таможня\n\n` +
    `Выберите что вам нужно 👇`
  );
}

// ── Регистрация хэндлеров ─────────────────────────────────────────────────────
export function setupClientBot(bot) {

  // /start (с поддержкой реф-ссылок: ?start=ref_XXXXX)
  bot.start(async (ctx) => {
    clearState(ctx.chat.id);
    const payload = ctx.startPayload || '';  // то что после ?start=

    // Обрабатываем реф-ссылку
    if (payload.startsWith('ref_')) {
      const bonusText = await handleRefStart(ctx.chat.id, payload)
        ? `\n\n🎁 *Вы пришли по реферальной ссылке!*\nОставьте заявку — и ваш друг получит бонус 🤝`
        : '';
      try {
        await ctx.reply(welcomeText(ctx.from?.first_name) + bonusText, { parse_mode: 'Markdown', ...KB_MAIN });
      } catch {
        await ctx.reply(welcomeText(ctx.from?.first_name), KB_MAIN);
      }
      return;
    }

    try {
      await ctx.reply(welcomeText(ctx.from?.first_name), { parse_mode: 'Markdown', ...KB_MAIN });
    } catch {
      await ctx.reply(welcomeText(ctx.from?.first_name), KB_MAIN);
    }
  });

  // /menu
  bot.command('menu', async (ctx) => {
    clearState(ctx.chat.id);
    await ctx.reply('Главное меню:', KB_MAIN);
  });

  // /catalog
  bot.command('catalog', async (ctx) => {
    await ctx.reply(
      '🛒 *Каталог запчастей LegalAuto*\n\nBMW · Geely · Li Auto · Mercedes · Audi · Toyota',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '🛒 Открыть каталог', web_app: { url: MINI_APP_URL } }
      ]]}}
    );
  });

  // /util — быстрый калькулятор утильсбора
  bot.command('util', async (ctx) => {
    await ctx.reply(
      '🧮 *Калькулятор утильсбора*\n\nВыберите тип:',
      { parse_mode: 'Markdown', ...KB_UTIL_TYPE }
    );
  });

  // /buy — быстрый старт «Хочу купить»
  bot.command('buy', async (ctx) => {
    clearState(ctx.chat.id);
    setState(ctx.chat.id, { step: 'buy_ask_part' });
    await ctx.reply(
      '🛒 *Хочу купить запчасть*\n\nНапишите, что именно ищете:\n_Например: «тормозные диски BMW X5», «фара правая Geely Atlas»_',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '📋 Смотреть каталог', web_app: { url: MINI_APP_URL } },
      ]]}}
    );
  });

  // /subscribe — подписка на появление запчасти
  bot.command('subscribe', async (ctx) => {
    clearState(ctx.chat.id);
    const query = ctx.message.text.replace('/subscribe', '').trim();
    if (query.length > 3) {
      return handleSubscribeQuery(ctx, query);
    }
    setState(ctx.chat.id, { step: 'subscribe_ask_query' });
    await ctx.reply(
      '🔔 *Подписка на запчасть*\n\nНапишите что ищете — я уведомлю вас как только это появится в наличии:\n_Например: «радиатор BMW X5», «фара Geely Atlas»_',
      { parse_mode: 'Markdown' }
    );
  });

  // /unsubscribe — отписаться от всех уведомлений
  bot.command('unsubscribe', async (ctx) => {
    const subs = getSubscriptions(ctx.chat.id);
    if (!subs.length) {
      return ctx.reply('У вас нет активных подписок.');
    }
    removeSubscriptions(ctx.chat.id);
    await ctx.reply(`✅ Отписались от ${subs.length} уведомлений.`);
  });

  // /mysubs — список активных подписок
  bot.command('mysubs', async (ctx) => {
    const subs = getSubscriptions(ctx.chat.id);
    if (!subs.length) {
      return ctx.reply('У вас нет активных подписок.\n\nНапишите /subscribe чтобы подписаться.', KB_MAIN);
    }
    const lines = subs.map((s, i) => `${i + 1}. 🔔 ${s.query}`).join('\n');
    await ctx.reply(
      `*Ваши подписки (${subs.length}):*\n\n${lines}\n\n_Напишите /unsubscribe чтобы отписаться от всех._`,
      { parse_mode: 'Markdown' }
    );
  });

  // /ref — реферальная программа
  bot.command('ref', async (ctx) => {
    const chatId = ctx.chat.id;
    const { link } = await getOrCreateRefLink(chatId);
    const stats = await getUserRefStats(chatId);
    await ctx.reply(
      `🔗 *Ваша реферальная ссылка:*\n\n\`${link}\`\n\n` +
      `*Как это работает:*\n` +
      `1. Поделитесь ссылкой с друзьями\n` +
      `2. Друг переходит и пишет боту\n` +
      `3. Как только он оставит заявку — вы получаете *скидку 500 ₽*\n\n` +
      `📊 *Ваша статистика:*\n` +
      `👥 Приглашено: *${stats.total}*\n` +
      `✅ Оставили заявку: *${stats.leads}*\n` +
      `🎁 Бонусов получено: *${stats.rewarded}*`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '📤 Поделиться ссылкой', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Рекомендую — нашёл здесь запчасти быстро и дёшево!')}` },
      ]]}}
    );
  });

  // /status — статус последней заявки клиента
  bot.command('status', async (ctx) => {
    const chatId = String(ctx.chat.id);
    await ctx.reply('🔍 Проверяю статус ваших заявок...');
    try {
      const data  = await gasGet('leads');
      const leads = (data?.leads || []).filter(l => String(l.chat_id) === chatId);
      if (!leads.length) {
        return ctx.reply(
          `📋 *Заявок не найдено*\n\nВы ещё не оформляли заявки через бот.\n\nЧтобы купить запчасть — нажмите кнопку ниже 👇`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
            { text: '🛒 Купить запчасть', callback_data: 'svc_buy' },
          ]]}}
        );
      }

      // Сортируем — последние сверху
      leads.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const last3 = leads.slice(0, 3);

      const STATUS_EMOJI = {
        new:    '🆕', work:   '⚙️', done:  '✅',
        closed: '✅', cold:   '❄️', skip:  '❌', '': '🆕',
      };

      const lines = last3.map((l, i) => {
        const status = (l.status || 'new').toLowerCase();
        const emoji  = STATUS_EMOJI[status] || '📋';
        const date   = l.created_at ? new Date(l.created_at).toLocaleDateString('ru-RU') : '';
        const what   = (l.data || '').split('\n')[0]?.slice(0, 60) || 'Запчасть';
        const statusLabel = {
          new: 'Новая', work: 'В работе', done: 'Выполнена',
          closed: 'Закрыта', cold: 'Нет ответа', skip: 'Отклонена',
        }[status] || status;
        return `${emoji} *${what}*\n   Статус: ${statusLabel}${date ? ` | ${date}` : ''}`;
      }).join('\n\n');

      const total = leads.length;
      await ctx.reply(
        `📋 *Ваши заявки${total > 3 ? ` (последние ${last3.length} из ${total})` : ''}:*\n\n${lines}\n\n` +
        `Если нужна помощь — напишите менеджеру.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '🛒 Новая заявка',      callback_data: 'svc_buy' },
          { text: '📲 Написать менеджеру', url: `https://t.me/${MGR}` },
        ]]}}
      );
    } catch (e) {
      console.error('[ClientBot] /status error:', e.message);
      await ctx.reply(
        `😔 Не удалось получить статус. Напишите менеджеру — он ответит.\n\n📲 @${MGR}`,
        { reply_markup: { inline_keyboard: [[
          { text: '📲 Написать менеджеру', url: `https://t.me/${MGR}` },
        ]]}}
      );
    }
  });

  // ── 🛒 Купить запчасть ────────────────────────────────────────────────────
  bot.action('svc_buy', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    setState(ctx.chat.id, { step: 'buy_ask_part' });
    await ctx.reply(
      '🛒 *Купить запчасть*\n\n' +
      'Напишите что именно нужно и марку авто.\n\n' +
      '_Например: «тормозные диски BMW X5» или «фара правая Geely Atlas»_',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '📦 Смотреть весь каталог', web_app: { url: MINI_APP_URL } }],
        [{ text: '← Главное меню', callback_data: 'back_main' }],
      ]}}
    );
  });

  // ── 🔍 Найти по VIN ───────────────────────────────────────────────────────
  bot.action('svc_vin', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    await ctx.reply(
      '🔍 *Поиск по VIN-номеру*\n\n' +
      'Введите VIN вашего автомобиля (17 символов) — я проверю наличие запчастей для вашего авто:\n\n' +
      '_Пример: `X4XYB20090D123456`_',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '← Главное меню', callback_data: 'back_main' }],
      ]}}
    );
  });

  // ── 🔔 Уведомить о поступлении ───────────────────────────────────────────
  bot.action('svc_alert', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    const subs = getSubscriptions(ctx.chat.id);
    let subsList = '';
    if (subs.length > 0) {
      subsList = `\n\n📋 *Ваши подписки (${subs.length}):*\n` +
        subs.map((s, i) => `${i + 1}. 🔔 ${s.query}`).join('\n');
    }
    setState(ctx.chat.id, { step: 'subscribe_ask_query' });
    await ctx.reply(
      '🔔 *Уведомление о поступлении*\n\n' +
      'Напишите что ищете — я сообщу вам как только это появится в наличии:\n\n' +
      '_Например: «радиатор BMW X5 E70» или «фара Geely Atlas»_' +
      subsList,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        ...(subs.length > 0 ? [[{ text: '🗑 Отменить все подписки', callback_data: 'unsub_all' }]] : []),
        [{ text: '← Главное меню', callback_data: 'back_main' }],
      ]}}
    );
  });

  // ── Отменить все подписки (кнопка) ───────────────────────────────────────
  // ── Sales Agent: оформить заявку по кнопке ────────────────────────────────
  bot.action('sales_lead', async (ctx) => {
    await ctx.answerCbQuery();
    const result = await handleSalesMessage(
      ctx.chat.id,
      'Хочу оформить заявку на то что мы обсуждали'
    );
    if (result?.text) {
      await ctx.reply(result.text, { parse_mode: 'Markdown', ...salesKeyboard(ctx.chat.id) });
    }
  });

  bot.action('unsub_all', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    removeSubscriptions(ctx.chat.id);
    await ctx.reply('✅ Все подписки отменены.', KB_MAIN);
  });

  // ── 📋 СБКТС / ЭПТС ──────────────────────────────────────────────────────
  bot.action('svc_docs', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '📋 *Оформление документов*\n\n' +
      '*СБКТС* — свидетельство безопасности конструкции ТС\n' +
      '*ЭПТС* — электронный паспорт транспортного средства\n\n' +
      'Выберите нужный документ:',
      { parse_mode: 'Markdown', ...KB_DOCS }
    );
  });

  // ── Выбор варианта из ZZap под заказ ─────────────────────────────────────
  bot.action(/^resale_pick_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('Оформляем заказ...');
    const chatId    = String(ctx.chat.id);
    const offerIdx  = parseInt(ctx.match[2]);
    const offer     = getResaleOffer(chatId, offerIdx);
    if (!offer) return ctx.reply('❌ Вариант устарел. Пожалуйста, введите запрос заново.');

    // Сохраняем заявку
    const leadData = `Под заказ: ${offer.partName}\nВариант: ${offer.name}\nЦена клиента: ${offer.ourPrice} ₽\nАвто: ${offer.car || '—'}`;
    await gasGet('save_lead', {
      source:   'zzap_resale',
      chat_id:  chatId,
      username: ctx.from?.username || '',
      car:      offer.car || '',
      data:     leadData,
    }).catch(() => {});
    onFriendCreatedLead(chatId).catch(() => {});

    // Уведомляем менеджера
    const adminBot = (await import('./adminBot.js')).notifyNewLead;
    if (typeof adminBot === 'function') {
      await adminBot({
        chatId,
        username: ctx.from?.username,
        car:      offer.car || '—',
        data:     leadData,
        source:   'zzap_resale',
      }).catch(() => {});
    }

    await ctx.reply(
      `✅ *Заявка принята!*\n\n` +
      `📦 ${offer.name}\n` +
      `💰 Цена: *${offer.ourPrice.toLocaleString('ru-RU')} ₽*\n` +
      `🚚 Доставка: 2–5 рабочих дней\n\n` +
      `Менеджер свяжется с вами для подтверждения и оплаты.\n` +
      `📲 Или напишите сами: @${MGR}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '📲 Написать менеджеру', url: `https://t.me/${MGR}` },
        { text: '🏠 Главное меню',       callback_data: 'back_main' },
      ]]}}
    );
  });

  // ── 🎁 Реферальная программа ─────────────────────────────────────────────
  bot.action('svc_ref', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat.id;
    const { link } = await getOrCreateRefLink(chatId);
    const stats = await getUserRefStats(chatId);
    await ctx.reply(
      `🎁 *Приглашайте друзей — получайте скидки!*\n\n` +
      `Поделитесь ссылкой:\n\`${link}\`\n\n` +
      `За каждого друга который оставит заявку — *скидка 500 ₽* на вашу следующую покупку.\n\n` +
      `👥 Приглашено: *${stats.total}* | ✅ Заявок: *${stats.leads}* | 🎁 Бонусов: *${stats.rewarded}*`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
        { text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Нашёл классный магазин б/у запчастей — быстро, дёшево, с гарантией!')}` },
      ]]}}
    );
  });

  // ── 📋 Статус заявки ──────────────────────────────────────────────────────
  bot.action('svc_status', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = String(ctx.chat.id);
    await ctx.reply('🔍 Проверяю ваши заявки...');
    try {
      const data  = await gasGet('leads');
      const leads = (data?.leads || []).filter(l => String(l.chat_id) === chatId);
      if (!leads.length) {
        return ctx.reply(
          `📋 *Заявок не найдено*\n\nВы ещё не оформляли заявки через бот.\n\nНажмите «🛒 Купить запчасть» чтобы начать:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
            { text: '🛒 Купить запчасть', callback_data: 'svc_buy' },
          ]]}}
        );
      }
      leads.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const last3 = leads.slice(0, 3);
      const STATUS_LABELS = {
        new: '🆕 Новая', work: '⚙️ В работе', done: '✅ Выполнена',
        closed: '✅ Закрыта', cold: '❄️ Нет ответа', skip: '❌ Отклонена', '': '🆕 Новая',
      };
      const lines = last3.map(l => {
        const status = (l.status || '').toLowerCase();
        const label  = STATUS_LABELS[status] || status;
        const date   = l.created_at ? new Date(l.created_at).toLocaleDateString('ru-RU') : '';
        const what   = (l.data || '').split('\n')[0]?.slice(0, 55) || 'Запчасть';
        return `${label}\n_${what}${date ? ' · ' + date : ''}_`;
      }).join('\n\n');
      await ctx.reply(
        `📋 *Ваши заявки:*\n\n${lines}` +
        (leads.length > 3 ? `\n\n_...и ещё ${leads.length - 3} шт._` : ''),
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '🛒 Новая заявка',       callback_data: 'svc_buy' },
          { text: '📲 Написать менеджеру',  url: `https://t.me/${MGR}` },
        ]]}}
      );
    } catch (e) {
      await ctx.reply(`😔 Не удалось загрузить заявки. Напишите менеджеру: @${MGR}`);
    }
  });

  // ── Выбор марки (для подбора по AI) ──────────────────────────────────────
  bot.action('svc_parts', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🔩 *Подбор запчасти*\n\nВыберите марку автомобиля:', { parse_mode: 'Markdown', ...KB_BRANDS });
  });

  for (const brand of ['BMW', 'Geely', 'Li Auto', 'Mercedes', 'Audi', 'Toyota']) {
    bot.action(`brand_${brand}`, async (ctx) => {
      await ctx.answerCbQuery();
      clearState(ctx.chat.id);
      setState(ctx.chat.id, { step: 'buy_ask_part', prefillBrand: brand });
      await ctx.reply(
        `✅ *${brand}*\n\nКакая запчасть нужна?\n\n_Напишите название детали и модель авто:_\n_Например: «тормозные диски X5 E70»_`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
          [{ text: '📦 Каталог запчастей', web_app: { url: MINI_APP_URL } }],
          [{ text: '← Выбрать другую марку', callback_data: 'svc_parts' }],
        ]}}
      );
    });
  }

  bot.action('brand_other', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    await ctx.reply(
      '🚗 Напишите марку и модель вашего автомобиля:\n\n_Например: «Lada Vesta», «Kia Rio»_',
      { parse_mode: 'Markdown' }
    );
    setState(ctx.chat.id, { service: 'parts', history: [], waitBrand: true });
  });

  // ── Кнопки услуг (СБКТС, ЭПТС, Утильсбор, Таможня) ─────────────────────
  for (const svc of ['sbkts', 'epts', 'util', 'customs']) {
    bot.action(`svc_${svc}`, async (ctx) => {
      await ctx.answerCbQuery();
      const name = SVC_NAMES[svc];
      await ctx.reply(
        `✅ *${name}*\n\nОтвечу на несколько вопросов и оформлю заявку.\nОтвечайте по одному — это займёт 2–3 минуты.`,
        { parse_mode: 'Markdown' }
      );
      const firstQ = await askAIFirst(svc, `Начни сбор данных для ${name}. Задай первый вопрос.`);
      setState(ctx.chat.id, {
        service: svc,
        history: [
          { role: 'user', content: `Начни сбор данных для ${name}` },
          { role: 'assistant', content: firstQ }
        ]
      });
      await ctx.reply(firstQ);
    });
  }

  // ── Калькулятор утильсбора ─────────────────────────────────────────────────
  bot.action('calc_util', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🧮 *Калькулятор утильсбора*\n\nВыберите тип:', { parse_mode: 'Markdown', ...KB_UTIL_TYPE });
  });

  bot.action('util_phys', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.chat.id, { service: 'calc_util', isLegal: false, step: 'ask_volume' });
    await ctx.reply(
      '👤 Физическое лицо.\n\n' +
      'Введите объём двигателя в **куб. см** (например: `1600`)\n' +
      'или напишите `электромобиль`:',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('util_legal', async (ctx) => {
    await ctx.answerCbQuery();
    setState(ctx.chat.id, { service: 'calc_util', isLegal: true, step: 'ask_volume' });
    await ctx.reply(
      '🏢 Юридическое лицо.\n\n' +
      'Введите объём двигателя в **куб. см** (например: `2000`)\n' +
      'или напишите `электромобиль`:',
      { parse_mode: 'Markdown' }
    );
  });

  // ── Менеджер ───────────────────────────────────────────────────────────────
  bot.action('svc_manager', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `📲 *Написать менеджеру*\n\n` +
      `Нажмите кнопку ниже — менеджер ответит в течение 30 минут.\n\n` +
      `⏰ Время работы: пн–пт 9:00–20:00 МСК\n` +
      `📢 Канал с запчастями: @LegalAutoParts24`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '📲 Написать @LegalAuto247', url: `https://t.me/${MGR}` }],
        [{ text: '← Главное меню', callback_data: 'back_main' }],
      ]}}
    );
  });

  // ── Назад / Главное меню ───────────────────────────────────────────────────
  bot.action('back_main', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(ctx.chat.id);
    try {
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    } catch (_) {}
    await ctx.reply('Главное меню 👇', KB_MAIN);
  });

  // ── VIN → подобрать запчасти ───────────────────────────────────────────────
  bot.action(/^vin_parts_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const vin = ctx.match[1];
    await ctx.reply(
      `🔩 Введите название нужной запчасти для VIN \`${vin}\`\n\nПример: _«тормозные диски передние»_, _«фара левая»_, _«бампер»_`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /oem — поиск по OEM артикулу ──────────────────────────────────────────
  bot.command('oem', async (ctx) => {
    const oem = ctx.message.text.replace('/oem', '').trim();
    if (!oem) return ctx.reply('Укажите OEM артикул:\n`/oem 11127599660`', { parse_mode: 'Markdown' });
    await searchByOem(ctx, oem);
  });

  // Нормализация OEM — убираем пробелы, дефисы, точки
  function normalizeOem(oem) {
    return String(oem || '').replace(/[\s\-\.]/g, '').toUpperCase();
  }

  async function searchByOem(ctx, rawOem, carContext = '') {
    const oem     = rawOem.trim();
    const normOem = normalizeOem(oem);

    const waitMsg = await ctx.reply(`🔍 Ищу по OEM: \`${oem}\`...`, { parse_mode: 'Markdown' });

    // Серверный поиск по OEM в GAS (полный скан всех строк таблицы)
    const gasData = await gasGet('search_oem', { oem: normOem }).catch(() => null);
    const parts   = gasData?.products || [];

    if (parts.length > 0) {
      // ── Нашли в нашем каталоге ────────────────────────────────────────────────
      const lines = parts.slice(0, 5).map(p => {
        const price = Number(p.price || 0).toLocaleString('ru-RU');
        const cond  = p.condition ? ` | ${p.condition}` : '';
        return `🔩 *${p.name}*\nOEM: \`${p.oem}\`\nЦена: *${price} ₽*${cond}`;
      }).join('\n\n');

      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg.message_id, null,
        `✅ *Найдено ${parts.length} позиций по OEM \`${oem}\`:*\n\n${lines}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
          [{ text: '🛒 Открыть каталог', web_app: { url: MINI_APP_URL } }],
          [{ text: '💬 Связаться с менеджером', url: `https://t.me/${MGR}` }],
        ]}}
      ).catch(() => {});

      // Заявка + уведомление менеджеру
      const leadText = `OEM: ${oem}\n${carContext ? `Авто: ${carContext}\n` : ''}В каталоге: ${parts.length} позиций`;
      saveLead(ctx.chat.id, 'oem_search', leadText, ctx.from?.username).catch(() => {});
      notifyManagerVinSearch({
        chatId: ctx.chat.id, username: ctx.from?.username,
        vin: '', make: carContext, model: '', year: '',
        partName: oem, partsFound: parts.length, topParts: parts.slice(0, 3),
      }).catch(() => {});

    } else {
      // ── Не нашли в каталоге — ищем ZZap сами, показываем клиенту +25% ────────
      const zzapResult = await searchZzap({ partName: oem, oem: normOem })
        .catch(() => ({ ok: false, results: [] }));

      let clientMsg = `🔍 *Запрос OEM \`${oem}\` принят*\n\n`;

      if (zzapResult?.ok && zzapResult.results?.length > 0) {
        // Есть цены — делаем наценку +25%, показываем клиенту топ-10 как «нашу цену»
        const priceLines = zzapResult.results.slice(0, 10).map((r, i) => {
          const rawPrice = Number(r.price) || 0;
          const ourPrice = rawPrice > 0 ? Math.ceil(rawPrice * 1.25) : null;
          const priceStr = ourPrice
            ? `*${ourPrice.toLocaleString('ru-RU')} ₽*`
            : '_уточните у менеджера_';
          return `${i + 1}. ${r.name || 'Запчасть'} — ${priceStr}`;
        }).join('\n');
        clientMsg += `💰 *Наша цена (топ-${zzapResult.results.length} предложений):*\n${priceLines}\n\n`;
        clientMsg += `_Менеджер подтвердит наличие и оформит заказ._`;
      } else {
        clientMsg += `Запчасть найдём под заказ.\n_Менеджер уточнит цену и наличие в течение 30 минут._`;
      }

      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg.message_id, null, clientMsg,
        { parse_mode: 'Markdown', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [
            [{ text: '📞 Менеджер', url: `https://t.me/${MGR}` }],
          ]}}
      ).catch(() => {});

      // Создаём заявку
      const leadText = `OEM: ${oem}\n${carContext ? `Авто: ${carContext}\n` : ''}В каталоге: не найдено`;
      saveLead(ctx.chat.id, 'oem_not_found', leadText, ctx.from?.username).catch(() => {});

      // Менеджер получает себестоимость ZZap + ссылки (передаём готовый результат — без повторного поиска)
      notifyManagerVinSearch({
        chatId: ctx.chat.id, username: ctx.from?.username,
        vin: '', make: carContext, model: '', year: '',
        partName: oem, partsFound: 0, topParts: [],
        zzapResult,
      }).catch(() => {});
    }
  }

  // ── Текстовые сообщения ────────────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    const text  = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const state = getState(ctx.chat.id);

    // ── Интент: «хочу купить» / «заказать» ────────────────────────────────────
    if (!state && /хочу\s+купить|хочу\s+заказ|хочу\s+приобрести|куплю|заказать\s+запчасть|нужна\s+запчасть|ищу\s+запчасть/i.test(text)) {
      setState(ctx.chat.id, { step: 'buy_ask_part' });
      return ctx.reply(
        '🛒 *Отлично! Какую запчасть ищете?*\n\n_Напишите название детали и марку авто:_\n_Например: «тормозные диски BMW X5» или «фара правая Geely Atlas»_',
        { parse_mode: 'Markdown' }
      );
    }

    // ── Интент: «уведоми меня» / «подпиши меня» ───────────────────────────────
    if (!state && /уведоми\s+меня|подпиши\s+меня|notify\s+me|оповести|сообщи\s+когда|напиши\s+когда|уведомить/i.test(text)) {
      return handleSubscribeQuery(ctx, text);
    }

    // ── Шаг buy_ask_part: получили название запчасти ───────────────────────────
    if (state?.step === 'buy_ask_part') {
      const partQuery = text;
      trackPartQuery(partQuery); // 📊 статистика трендов
      registerLead({ chatId: ctx.chat.id, partName: partQuery, username: ctx.from?.username }); // 🐕 watchdog
      setState(ctx.chat.id, { step: 'buy_ask_phone', partQuery });
      return ctx.reply(
        `✅ *${partQuery}*\n\n📞 Поделитесь номером телефона — менеджер свяжется с вами в течение 30 минут:`,
        { parse_mode: 'Markdown', reply_markup: {
          keyboard: [[
            { text: '📱 Поделиться номером', request_contact: true },
          ], [
            { text: '✍️ Ввести номер вручную' },
          ]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }}
      );
    }

    // ── Шаг buy_ask_phone: получили номер вручную текстом ─────────────────────
    if (state?.step === 'buy_ask_phone') {
      const phone = text;
      const { partQuery } = state;
      clearState(ctx.chat.id);

      await ctx.reply(
        `✅ *Заявка принята!*\n\n` +
        `📦 Деталь: ${partQuery}\n` +
        `📞 Телефон: ${phone}\n\n` +
        `Менеджер свяжется с вами в течение 30 минут.\nЕсли срочно — @${MGR}`,
        { parse_mode: 'Markdown', reply_markup: {
          inline_keyboard: [[
            { text: '🛒 Каталог', web_app: { url: MINI_APP_URL } },
            { text: '📲 Менеджер', url: `https://t.me/${MGR}` },
          ]]
        }}
      );

      // Сохраняем заявку в GAS
      const leadText = `Запчасть: ${partQuery}\nТелефон: ${phone}\nКлиент: @${ctx.from?.username || ctx.from?.id}`;
      saveLead(ctx.chat.id, 'buy_direct', leadText, ctx.from?.username).catch(() => {});

      // Ищем ZZap параллельно с уведомлением
      const zzapBuyResult = await searchZzap({ partName: partQuery })
        .catch(() => ({ ok: false, results: [] }));

      // Строим отчёт менеджеру с ZZap
      const resaleOffers = zzapBuyResult?.ok && zzapBuyResult.results?.length
        ? applyMarkupAndFormat(zzapBuyResult.results, partQuery, '')
        : [];
      const { text: zzapManagerMsg } = formatManagerZzapMsg({
        make: '', model: '', year: '', partName: partQuery,
        partsInStock:  0,
        topStockParts: [],
        zzapResult:    zzapBuyResult,
        username:      ctx.from?.username,
        chatId:        ctx.chat.id,
        resaleOffers,
      });

      const buyHeader =
        `🛒 *НОВАЯ ЗАЯВКА НА ПОКУПКУ*\n` +
        `📞 Телефон: ${phone}\n` +
        `👤 @${ctx.from?.username || ctx.from?.id} (id: ${ctx.chat.id})\n\n`;

      const zzapUrls = buildZzapUrls({ partName: partQuery });
      const buttons = [
        [{ text: '📲 Написать клиенту', url: `https://t.me/${ctx.from?.username || ''}` }],
        ...(zzapUrls[0] ? [[{ text: '🔍 Открыть ZZap', url: zzapUrls[0].url }]] : []),
      ];

      await sendToAllManagers({
        text:       buyHeader + zzapManagerMsg,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }).catch(() => {});

      return;
    }

    // ── Шаг subscribe_ask_query: получили запрос для подписки ─────────────────
    if (state?.step === 'subscribe_ask_query') {
      clearState(ctx.chat.id);
      return handleSubscribeQuery(ctx, text);
    }

    // ── VIN-номер (17 символов) — всегда, даже при активном диалоге ──────────
    const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) {
      clearState(ctx.chat.id);
      const vin = vinMatch[1].toUpperCase();
      const waitMsg = await ctx.reply('🔍 Декодирую VIN...');
      try {
        const info = await decodeVin(vin);
        const vinCard = formatVinResult(info);
        // Сохраняем VIN в state — ждём название детали
        setState(ctx.chat.id, {
          step:  'vin_ask_part',
          vin,
          make:  info.make  || '',
          model: info.model || '',
          year:  info.year  || '',
        });
        await ctx.telegram.editMessageText(
          ctx.chat.id, waitMsg.message_id, null,
          `${vinCard}\n\n*Какая запчасть нужна?*\n_Введите название детали, например: тормозные диски, фара левая, бампер_`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛒 Смотреть весь каталог', web_app: { url: MINI_APP_URL } }],
                [{ text: '📋 Просто оставить заявку', callback_data: 'svc_parts'   }],
              ]
            }
          }
        ).catch(() => ctx.reply(vinCard, { parse_mode: 'Markdown' }));
      } catch (e) {
        clearState(ctx.chat.id);
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null,
          '❌ Не удалось декодировать VIN. Проверьте номер (17 символов).'
        ).catch(() => {});
      }
      return;
    }

    // ── Ввод названия детали после VIN ────────────────────────────────────────
    if (state?.step === 'vin_ask_part') {
      const partName = text;
      const { vin, make, model, year } = state;
      trackPartQuery(partName, make, model); // 📊 статистика трендов
      clearState(ctx.chat.id);
      const car = [make, model, year].filter(Boolean).join(' ') || 'ваш автомобиль';

      const waitMsg2 = await ctx.reply(`⏳ Ищу *${partName}* для ${car}...`, { parse_mode: 'Markdown' });

      // 1. Поиск в нашем каталоге
      let parts = [];
      try {
        const d = await gasGet('catalog', { brand: make, search: partName, limit: '20' });
        const all = d?.products || [];
        const words = partName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        parts = all.filter(p => {
          const name = (p.name || '').toLowerCase();
          return words.some(w => name.includes(w));
        });
      } catch (_) {}

      // 2. Показываем клиенту результаты
      let clientMsg;
      if (parts.length > 0) {
        const lines = parts.slice(0, 5).map(p => {
          const price  = Number(p.price || 0).toLocaleString('ru-RU');
          const oemStr = p.oem ? `\nOEM: \`${p.oem}\`` : '';
          const cond   = p.condition ? ` | ${p.condition}` : '';
          return `🔩 *${p.name}*${oemStr}\n${make || p.brand || ''} | *${price} ₽*${cond}`;
        }).join('\n\n');
        clientMsg = `✅ *Найдено ${parts.length} позиций "${partName}" для ${car}:*\n\n${lines}\n\n_Заявка создана — менеджер подтвердит наличие и свяжется с вами._`;
      } else {
        clientMsg = `📭 *"${partName}" для ${car} в наличии не нашлось.*\n\nЗаявка принята — найдём под заказ и свяжемся с вами.`;
      }

      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg2.message_id, null, clientMsg,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛒 Открыть каталог', web_app: { url: MINI_APP_URL } }],
              [{ text: '📞 Связаться с менеджером', url: `https://t.me/${MGR}` }],
            ]
          }
        }
      ).catch(() => ctx.reply(clientMsg, { parse_mode: 'Markdown' }));

      // 3. Создаём заявку в GAS
      const leadText = [
        `VIN: ${vin}`,
        `Авто: ${car}`,
        `Запчасть: ${partName}`,
        `В каталоге: ${parts.length > 0 ? `${parts.length} позиций` : 'не найдено'}`,
        `Клиент: @${ctx.from?.username || ctx.from?.id}`,
      ].join('\n');
      saveLead(ctx.chat.id, 'vin_parts', leadText, ctx.from?.username).catch(() => {});

      // 4. Уведомляем менеджера + ZZap поиск (async)
      notifyManagerVinSearch({
        chatId:      ctx.chat.id,
        username:    ctx.from?.username,
        vin, make, model, year, partName,
        partsFound:  parts.length,
        topParts:    parts.slice(0, 3),
      }).catch(() => {});

      return;
    }

    // OEM артикул — если нет активного диалога
    if (!state) {
      // OEM: цифровой (≥7 цифр) или буквенно-цифровой (≥6 символов)
      const oemMatch = text.match(/\b(\d{7,})\b/) ||
                       text.match(/\b([A-Z0-9]{4,}[-\s]?[A-Z0-9]{3,})\b/i);
      if (oemMatch) {
        // Контекст авто — всё что осталось после OEM номера
        const carContext = text.replace(oemMatch[0], '').trim();
        return searchByOem(ctx, oemMatch[1] || oemMatch[0], carContext);
      }

      // ── Smart Matching — поиск по Supabase каталогу ─────────────────────────
      if (isPartsRequest(text) || isSalesIntent(text) || text.length > 10) {
        const thinkMsg = await ctx.reply('🔍 Ищу в каталоге...');
        try {
          // Пробуем Smart Match (Supabase) первым
          const matchResult = await smartMatch(ctx.chat.id, text);
          await ctx.telegram.deleteMessage(ctx.chat.id, thinkMsg.message_id).catch(() => {});

          if (matchResult.found && matchResult.parts?.length > 0) {
            // ✅ Нашли в Supabase — показываем результат
            await ctx.reply(matchResult.text, {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [
                [
                  { text: '✅ Хочу заказать', callback_data: `order_sm_${matchResult.leadId?.slice(0,8) || '0'}` },
                  { text: '📦 Весь каталог',  web_app: { url: MINI_APP_URL } },
                ],
                [{ text: '📲 Написать менеджеру', url: `https://t.me/${MGR}` }],
              ]}
            });

            // Уведомляем менеджера о новом лиде из Smart Match
            if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
              const who = ctx.from?.username ? `@${ctx.from.username}` : `id:${ctx.chat.id}`;
              await sendToAllManagers({
                text: `🎯 *Smart Match — новый запрос*\n\n👤 ${who}\n📝 «${text}»\n✅ Найдено: ${matchResult.parts.length} позиций\n🆔 Lead: \`${matchResult.leadId?.slice(0,8)}\``,
                parse_mode: 'Markdown',
              }).catch(() => {});
            }
            return;
          }

          // Ничего в Supabase — fallback на Sales Agent
          const salesResult = await handleSalesMessage(ctx.chat.id, text);
          if (salesResult?.text) {
            await ctx.reply(salesResult.text, {
              parse_mode: 'Markdown',
              ...salesKeyboard(ctx.chat.id),
            });
          }
          if (salesResult?.lead_created) {
            // Классифицируем лид — горячий или нет
            classifyLead(text).then(hotness => {
              if (hotness === 'HOT' && ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
                const who = ctx.from?.username ? `@${ctx.from.username}` : `id:${ctx.chat.id}`;
                sendToAllManagers({
                  text: `🔥 *ГОРЯЧИЙ ЛИД!*\n\n👤 ${who}\n📝 «${text}»\n\n⚡️ Клиент готов купить — свяжитесь немедленно!`,
                  parse_mode: 'Markdown',
                }).catch(() => {});
              }
            }).catch(() => {});

            await ctx.reply(
              `✅ Заявка создана — менеджер свяжется в течение 30 минут.\nЕсли срочно: @${MGR}`,
              { reply_markup: { inline_keyboard: [[{ text: '📲 Написать сейчас', url: `https://t.me/${MGR}` }]] }}
            );
          }
        } catch (e) {
          console.error('[ClientBot] SmartMatch/SalesAgent error:', e.message);
          await ctx.telegram.deleteMessage(ctx.chat.id, thinkMsg.message_id).catch(() => {});
          await ctx.reply(`Уточните что именно ищете — я проверю наличие.\n\nИли напишите напрямую: @${MGR}`);
        }
        return;
      }

      return ctx.reply('Выберите раздел:', KB_MAIN);
    }

    // Калькулятор утильсбора
    if (state.service === 'calc_util' && state.step === 'ask_volume') {
      const isElectric = /электр/i.test(text);
      const vol = isElectric ? 0 : parseInt(text.replace(/\D/g, ''), 10);

      if (!isElectric && (isNaN(vol) || vol < 50)) {
        return ctx.reply('Введите корректный объём в куб. см (например: 1600) или "электромобиль":');
      }

      const rate   = calcUtil(vol, state.isLegal, isElectric);
      const type   = state.isLegal ? 'Юр. лицо' : 'Физ. лицо';
      const engine = isElectric ? 'Электромобиль' : `${vol} куб. см`;
      const fmt    = (n) => n.toLocaleString('ru-RU');

      clearState(ctx.chat.id);
      await ctx.reply(
        `🧮 *Расчёт утильсбора*\n\n` +
        `Тип: ${type}\n` +
        `Двигатель: ${engine}\n\n` +
        `💰 *Утильсбор: ${fmt(rate)} ₽*\n\n` +
        `_Ставки актуальны на 2024 год. Для точного расчёта и помощи с оплатой — нажмите кнопку ниже._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 Оформить через LegalAuto', callback_data: 'svc_util' }],
              [{ text: '← Главное меню',              callback_data: 'back_main' }],
            ]
          }
        }
      );
      return;
    }

    // Марка "другая" — первый шаг
    if (state.waitBrand) {
      const intro = `✅ *${text}*\n\nНачинаю подбор запчасти:`;
      await ctx.reply(intro, { parse_mode: 'Markdown' });
      const firstQ = await askAIFirst('parts', `Клиент ищет запчасть для ${text}. Уточни модель и год.`);
      setState(ctx.chat.id, {
        service: 'parts',
        history: [
          { role: 'user', content: `Ищу запчасть для ${text}` },
          { role: 'assistant', content: firstQ }
        ]
      });
      return ctx.reply(firstQ);
    }

    // Обычный AI диалог
    const { service, history } = state;
    history.push({ role: 'user', content: text });

    let aiReply;
    try {
      aiReply = await askAI(SERVICE_PROMPTS[service], history);
    } catch (e) {
      return ctx.reply(`❌ AI временно недоступен. Напишите менеджеру: @${MGR}`);
    }

    history.push({ role: 'assistant', content: aiReply });
    setState(ctx.chat.id, { ...state, history });

    if (aiReply.includes('LEAD_READY')) {
      clearState(ctx.chat.id);
      const svcName = SVC_NAMES[service] || service;
      await ctx.reply(
        `✅ *Заявка принята!*\n\n` +
        `Услуга: ${svcName}\n\n` +
        `Менеджер свяжется с вами в течение 30 минут.\n\n` +
        `Если срочно — пишите @${MGR}`,
        { parse_mode: 'Markdown', ...KB_MAIN }
      );
      const leadParsed = parseLeadData(aiReply);
      await saveLead(ctx.chat.id, service, aiReply, ctx.from?.username).catch(() => {});
      // Уведомление через Admin Bot (с кнопками принять/отклонить)
      await notifyNewLead({
        chatId:   ctx.chat.id,
        username: ctx.from?.username,
        service:  SVC_NAMES[service] || service,
        car:      leadParsed.car,
        client:   leadParsed.client,
        phone:    leadParsed.phone,
        summary:  aiReply,
      }).catch(() => {});
      // Fallback: прямой запрос к Telegram API если admin bot недоступен
      await notifyManager(SVC_NAMES[service] || service, ctx.chat.id, ctx.from?.username, aiReply);
    } else {
      // Показываем кнопку "Назад" если диалог длинный
      const opts = history.length > 8
        ? { reply_markup: { inline_keyboard: [[
            { text: '← Главное меню', callback_data: 'back_main' },
            { text: '👤 Менеджер',    callback_data: 'svc_manager' },
          ]]}}
        : {};
      await ctx.reply(aiReply, opts);
    }
  });

  // ── Контакт (кнопка «Поделиться номером») ────────────────────────────────────
  bot.on('contact', async (ctx) => {
    const state = getState(ctx.chat.id);
    const phone = ctx.message.contact?.phone_number || 'неизвестен';
    const partQuery = state?.partQuery || state?.step === 'buy_ask_phone' ? state.partQuery : null;

    if (!partQuery) return; // не в buy-flow

    // 🐕 Watchdog: обновляем лид с номером телефона (менеджер ещё не ответил)
    registerLead({ chatId: ctx.chat.id, partName: partQuery, phone, username: ctx.from?.username });
    clearState(ctx.chat.id);

    await ctx.reply(
      `✅ *Заявка принята!*\n\n📦 Деталь: ${partQuery}\n📞 Телефон: ${phone}\n\nМенеджер свяжется с вами в течение 30 минут.`,
      { parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true } }
    );

    saveLead(ctx.chat.id, 'buy_direct', `Запчасть: ${partQuery}\nТелефон: ${phone}`, ctx.from?.username).catch(() => {});

    const zzapBuyResult = await searchZzap({ partName: partQuery }).catch(() => ({ ok: false, results: [] }));
    const resaleOffers  = zzapBuyResult?.ok && zzapBuyResult.results?.length
      ? applyMarkupAndFormat(zzapBuyResult.results, partQuery, '') : [];
    const { text: zzapManagerMsg } = formatManagerZzapMsg({
      make: '', model: '', year: '', partName: partQuery,
      partsInStock: 0, topStockParts: [], zzapResult: zzapBuyResult,
      username: ctx.from?.username, chatId: ctx.chat.id, resaleOffers,
    });
    const buyHeader = `🛒 *НОВАЯ ЗАЯВКА НА ПОКУПКУ*\n📞 Телефон: ${phone}\n👤 @${ctx.from?.username || ctx.from?.id} (id: ${ctx.chat.id})\n\n`;
    const zzapUrls  = buildZzapUrls({ partName: partQuery });
    const buttons   = [
      [{ text: '📲 Написать клиенту', url: `https://t.me/${ctx.from?.username || ''}` }],
      ...(zzapUrls[0] ? [[{ text: '🔍 Открыть ZZap', url: zzapUrls[0].url }]] : []),
    ];
    await sendToAllManagers({ text: buyHeader + zzapManagerMsg, parse_mode: 'Markdown',
      disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });

  // ── Lead monitoring — слушаем авто-группы где добавлен бот ─────────────────
  setupLeadMonitoring(bot);

  console.log('✅ Client bot v2 handlers registered');
}

// ── Alert subscription helper ─────────────────────────────────────────────────
async function handleSubscribeQuery(ctx, query) {
  const result = addSubscription(ctx.chat.id, query);
  if (result === 'exists') {
    return ctx.reply(
      `🔔 Вы уже подписаны на похожий запрос.\n\nНапишите /mysubs чтобы посмотреть все подписки.`
    );
  }
  if (!result) {
    return ctx.reply(
      `❌ Не удалось разобрать запрос. Напишите точнее, что ищете.\n_Например: «радиатор BMW X5 E70»_`,
      { parse_mode: 'Markdown' }
    );
  }
  const subs = getSubscriptions(ctx.chat.id);
  await ctx.reply(
    `✅ *Подписка оформлена!*\n\n🔔 Как только в наличии появится:\n«${query}»\n\nя сразу напишу вам.\n\n` +
    `_Активных подписок: ${subs.length}. /mysubs — список, /unsubscribe — отписаться._`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
      { text: '🛒 Смотреть каталог', web_app: { url: MINI_APP_URL } },
      { text: '📲 Написать менеджеру', url: `https://t.me/${MGR}` },
    ]]}}
  );
}

async function askAIFirst(svc, userMsg) {
  try {
    const h = [{ role: 'user', content: userMsg }];
    const r = await askAI(SERVICE_PROMPTS[svc], h);
    return r;
  } catch (e) {
    return `Расскажите подробнее о вашем запросе.`;
  }
}

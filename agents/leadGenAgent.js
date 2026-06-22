/**
 * LegalAuto — Lead Generation Agent
 *
 * Стратегия: мониторим публичные Telegram-каналы/группы по авто-тематике,
 * находим людей которые САМИ пишут "ищу запчасть", "нужна деталь" и т.д.
 * AI-ассистент анализирует пост и если это реальный запрос — уведомляет админа
 * чтобы он написал человеку вручную (или через бота).
 *
 * Дополнительно: создаём "приманки" — шаблоны постов для размещения
 * в группах где Эдо вручную разрешит постить (без автоматики в чужих группах).
 *
 * Railway env:
 *   LEAD_KEYWORDS = "ищу запчасть,нужна деталь,где купить,помогите найти" (необязательно)
 *   MONITOR_CHATS = "[-100123,-100456]"  ← чаты которые мы САМИ мониторим через clientBot
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const CLAUDE_API_KEY   = process.env.CLAUDE_API_KEY;
const ADMIN_BOT_TOKEN  = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID    = process.env.ADMIN_CHAT_ID;
const CLIENT_BOT_TOKEN = process.env.CLIENT_BOT_TOKEN;
const BOT_USERNAME     = process.env.CLIENT_BOT_USERNAME || 'LegalAutoAssist_bot';
const MGR              = process.env.MANAGER_USERNAME    || 'LegalAuto247';

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// ── Ключевые слова для определения лидов ─────────────────────────────────────
const DEFAULT_KEYWORDS = [
  'ищу запчасть', 'нужна деталь', 'где купить', 'помогите найти',
  'нет в наличии', 'под заказ', 'запчасть для', 'ищу б/у',
  'разборка', 'откуда взять', 'детали для', 'куплю запчасть',
  'нужен двигатель', 'нужна коробка', 'нужна фара', 'нужен бампер',
  'ищу двигатель', 'ищу акпп', 'ищу мкпп',
];

function getKeywords() {
  try {
    const env = process.env.LEAD_KEYWORDS;
    if (env) return env.split(',').map(k => k.trim().toLowerCase());
  } catch {}
  return DEFAULT_KEYWORDS;
}

// ── Целевые марки ─────────────────────────────────────────────────────────────
const TARGET_BRANDS = [
  'bmw', 'geely', 'li auto', 'лиаuto', 'li', 'лиаут',
  'mercedes', 'мерседес', 'audi', 'ауди', 'toyota', 'тойота',
  'lexus', 'лексус', 'volvo', 'вольво', 'coolray', 'atlas',
  'tugella', 'emgrand', 'monjaro',
];

// ── Кэш уже обработанных сообщений ───────────────────────────────────────────
const processedMsgIds = new Set();
const MAX_CACHE = 500;

function markProcessed(msgId) {
  processedMsgIds.add(msgId);
  if (processedMsgIds.size > MAX_CACHE) {
    const first = processedMsgIds.values().next().value;
    processedMsgIds.delete(first);
  }
}

// ── Анализ текста сообщения через AI ─────────────────────────────────────────
async function analyzeMessage(text) {
  if (!claude) return simpleKeywordCheck(text);

  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content:
          `Текст из Telegram группы: "${text.slice(0, 400)}"

Это запрос на покупку автозапчасти? Марка машины (если упомянута)?
Ответь JSON: {"is_lead": true/false, "brand": "BMW"|"Geely"|"Mercedes"|etc|null, "part": "название детали"|null, "confidence": 0.0-1.0}
Только JSON, без объяснений.`,
      }],
    });
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return simpleKeywordCheck(text);
  }
}

function simpleKeywordCheck(text) {
  const t = text.toLowerCase();
  const keywords = getKeywords();
  const hasKeyword = keywords.some(k => t.includes(k));
  const brand = TARGET_BRANDS.find(b => t.includes(b)) || null;
  return {
    is_lead: hasKeyword,
    brand: brand ? brand.toUpperCase() : null,
    part: null,
    confidence: hasKeyword ? 0.6 : 0,
  };
}

// ── Уведомить Эдо о найденном лиде ───────────────────────────────────────────
async function notifyAdminAboutLead(lead) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;

  const brandTag = lead.brand ? `\n🚗 Марка: *${lead.brand}*` : '';
  const partTag  = lead.part  ? `\n🔧 Деталь: *${lead.part}*`  : '';
  const chatLink = lead.chatUsername
    ? `\n📍 Группа: @${lead.chatUsername}`
    : `\n📍 Chat: ${lead.chatId}`;
  const userLink = lead.username
    ? `\n👤 Автор: @${lead.username}`
    : lead.firstName
    ? `\n👤 Автор: ${lead.firstName}`
    : '';

  const text =
    `🎯 *Потенциальный клиент найден!*${brandTag}${partTag}${chatLink}${userLink}\n\n` +
    `💬 Сообщение:\n_${lead.text.slice(0, 300)}_\n\n` +
    `👇 Напишите им вручную или предложите бота`;

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ADMIN_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          ...(lead.username ? [{ text: '✍️ Написать клиенту', url: `https://t.me/${lead.username}` }] : []),
          { text: '🤖 Скопировать ссылку бота', callback_data: `copy_bot_link` },
        ]],
      },
    }),
  }).catch(e => console.error('[LeadGen] Notify error:', e.message));
}

// ── Обработать входящее сообщение из мониторинга ─────────────────────────────
export async function processGroupMessage(msg, chatUsername) {
  const text = msg.text || msg.caption || '';
  if (!text || text.length < 15) return;

  const msgId = `${msg.chat?.id}_${msg.message_id}`;
  if (processedMsgIds.has(msgId)) return;
  markProcessed(msgId);

  const analysis = await analyzeMessage(text);
  if (!analysis.is_lead || analysis.confidence < 0.5) return;

  const lead = {
    text,
    brand: analysis.brand,
    part: analysis.part,
    chatId: msg.chat?.id,
    chatUsername: chatUsername || msg.chat?.username,
    username: msg.from?.username,
    firstName: msg.from?.first_name,
    msgId: msg.message_id,
  };

  console.log(`[LeadGen] 🎯 Найден лид: ${lead.brand || '?'} / ${lead.part || '?'} от @${lead.username || '?'}`);
  await notifyAdminAboutLead(lead);
}

// ── Подключить мониторинг к clientBot ────────────────────────────────────────
// Вызывается из clientBot.js — передаём обработчик для групповых сообщений
export function setupLeadMonitoring(bot) {
  const MONITOR_CHATS = (() => {
    try { return JSON.parse(process.env.MONITOR_CHATS || '[]'); }
    catch { return []; }
  })();

  if (!MONITOR_CHATS.length) {
    console.log('[LeadGen] MONITOR_CHATS не настроен — мониторинг отключён');
    return;
  }

  // Слушаем сообщения в группах
  bot.on('message', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    if (!MONITOR_CHATS.includes(chat.id) && !MONITOR_CHATS.includes(String(chat.id))) return;

    await processGroupMessage(ctx.message, chat.username).catch(e =>
      console.error('[LeadGen] Error:', e.message)
    );
  });

  console.log(`[LeadGen] ✅ Мониторинг включён для ${MONITOR_CHATS.length} чатов`);
}

// ── Генератор "приманок" — готовые посты для ручного размещения ──────────────
export async function generateHookPost(segment = 'general') {
  const prompts = {
    bmw: 'BMW E/F/G серии, X3/X5/X6',
    geely: 'Geely Atlas, Coolray, Tugella',
    li_auto: 'Li Auto L7/L8/L9/One',
    general: 'BMW, Geely, Li Auto, Mercedes',
  };
  const catalog = prompts[segment] || prompts.general;

  if (!claude) return `🔧 Ищете запчасти для ${catalog}?\n\nЕсть в наличии + под заказ.\n📲 @${BOT_USERNAME}`;

  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content:
          `Напиши короткий пост (3-4 строки) от имени частного продавца для авто-группы Telegram.
Тема: продаю б/у запчасти для ${catalog}.
Тон: живой, человеческий, не рекламный. Как написал бы обычный человек.
В конце упомяни @${BOT_USERNAME} как контакт.
Без хэштегов. Без заглавий.`,
      }],
    });
    return msg.content[0].text.trim();
  } catch {
    return `🔧 Есть запчасти для ${catalog} — б/у оригинал с разборки.\nСостояние хорошее, цены ниже рынка.\n📲 @${BOT_USERNAME}`;
  }
}

// ── Статистика ────────────────────────────────────────────────────────────────
const leadStats = { found: 0, notified: 0 };
export function getLeadStats() { return { ...leadStats }; }

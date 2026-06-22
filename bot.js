import 'dotenv/config';
import fetch from 'node-fetch';
import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';

const {
  TELEGRAM_BOT_TOKEN,
  ADMIN_CHAT_ID,
  GEMINI_API_KEY,
  APPS_SCRIPT_API_URL
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing in .env');
if (!ADMIN_CHAT_ID) throw new Error('ADMIN_CHAT_ID is missing in .env');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing in .env');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

function isAdmin(ctx) {
  return String(ctx.chat?.id) === String(ADMIN_CHAT_ID);
}

async function guard(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.reply('🔒 Этот бот только для владельца.');
    return false;
  }
  return true;
}

async function askAI(prompt) {
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 1000
    }
  });

  return result.response.text().trim();
}

async function api(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) {
    throw new Error('APPS_SCRIPT_API_URL is missing in .env');
  }

  const url = new URL(APPS_SCRIPT_API_URL);
  url.searchParams.set('action', action);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Apps Script returned non-JSON: ' + text.slice(0, 300));
  }

  if (!data.ok) {
    throw new Error(data.error || 'Apps Script API error');
  }

  return data;
}

function extractLimit(text, fallback = 20) {
  const match = String(text || '').match(/\d+/);
  if (!match) return fallback;
  return Math.min(Math.max(Number(match[0]) || fallback, 1), 100);
}

function looksCatalogQuestion(text) {
  const q = String(text || '').toLowerCase();
  return [
    'топ', 'позици', 'маржин', 'прибыл', 'дорог', 'товар',
    'запчаст', 'не опублик', 'без фото', 'авито', 'выстав'
  ].some(word => q.includes(word));
}

async function handleCatalog(ctx, text) {
  const q = String(text || '').toLowerCase();
  const limit = extractLimit(q, 20);

  if (q.includes('без фото') || q.includes('нет фото')) {
    const data = await api('no_photo', { limit });
    return ctx.reply(data.text);
  }

  if (q.includes('не опублик') || q.includes('не выстав') || q.includes('не вылож')) {
    const data = await api('not_published', { limit });
    return ctx.reply(data.text);
  }

  const data = await api('top_price', { limit });
  return ctx.reply(data.text);
}

bot.start(async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(
    '🎛 LegalAuto Agent\n\n' +
    '/ping — проверка связи\n' +
    '/ai — проверка AI\n' +
    '/status — статус платформы\n' +
    '/products — товары\n\n' +
    'Можно писать обычным языком:\n' +
    '• топ 100 позиций\n' +
    '• какие позиции самые дорогие\n' +
    '• какие товары без фото\n' +
    '• что не опубликовано'
  );
});

bot.command('ping', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply('✅ pong. Node bot работает мгновенно.');
});

bot.command('ai', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply('⏳ Проверяю AI...');
  try {
    const answer = await askAI('Ответь кратко: AI LegalAuto работает.');
    await ctx.reply('🤖 ' + answer);
  } catch (err) {
    await ctx.reply('❌ Ошибка AI: ' + err.message);
  }
});

bot.command('status', async (ctx) => {
  if (!(await guard(ctx))) return;
  try {
    const data = await api('status');
    await ctx.reply(data.text);
  } catch (err) {
    await ctx.reply('⚠️ Бот жив, но Apps Script API недоступен:\n' + err.message);
  }
});

bot.command('products', async (ctx) => {
  if (!(await guard(ctx))) return;
  try {
    const data = await api('products');
    await ctx.reply(data.text);
  } catch (err) {
    await ctx.reply('❌ Ошибка товаров: ' + err.message);
  }
});

bot.on('text', async (ctx) => {
  if (!(await guard(ctx))) return;

  const text = ctx.message.text;
  await ctx.reply('⏳ Думаю...');

  try {
    if (looksCatalogQuestion(text)) {
      return await handleCatalog(ctx, text);
    }

    const answer = await askAI(
      'Ты личный AI-ассистент LegalAuto. Направления: автозапчасти, привоз авто, оформление документов, Telegram-контент, продажи, реклама, контроль сотрудников. Отвечай практично, кратко и по делу.\n\n' +
      'Вопрос пользователя: ' + text
    );

    await ctx.reply('🤖 ' + answer);
  } catch (err) {
    await ctx.reply('❌ Ошибка обработки:\n' + err.message);
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

bot.launch({ dropPendingUpdates: true });

console.log('✅ LegalAuto Node bot started');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

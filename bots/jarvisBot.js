/**
 * LegalAuto — Jarvis Personal Bot (@LegalAuto247_bot)
 *
 * Personal AI assistant for Edo only. Uses JARVIS_BOT_TOKEN.
 * Guarded by ADMIN_CHAT_ID — anyone else gets a 403.
 *
 * Commands:
 *   /start      — greeting + menu
 *   /status     — health of all bots + Railway uptime
 *   /leads      — today's leads summary
 *   /post       — trigger manual post to @LegalAutoParts24
 *   /stats      — analytics from GAS
 *   /broadcast  — send message to all clients
 *   /news       — trigger newsBot run
 *   /cars       — show latest cars in @LegalAutoStore
 *   /queue      — show orchestrator task queue
 *   Free text   — Claude Sonnet answers as personal AI with full business context
 */

import Anthropic from '@anthropic-ai/sdk';
import { Telegraf } from 'telegraf';
import {
  getMemory, buildSystemPrompt, addConversation, getRecentConversations, learnFact,
} from '../agents/memoryAgent.js';
import { orchestrate } from '../agents/orchestratorAgent.js';
import { jarvisThink } from '../agents/jarvisBrain.js';

const TAG = '[JarvisBot]';

// ── Runtime state ──────────────────────────────────────────────────────────
const startTime = Date.now();
let botInstance = null;

// Per-user dialog history for Claude (in-memory, last 20 msgs)
const dialogHistory = new Map();
const MAX_HISTORY = 20;

function getHistory(id) { return dialogHistory.get(String(id)) || []; }
function pushHistory(id, role, content) {
  const h = getHistory(id);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  dialogHistory.set(String(id), h);
}

// ── Claude client ──────────────────────────────────────────────────────────
function claude() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });
}

// ── Guard ──────────────────────────────────────────────────────────────────
function isEdo(ctx) {
  return String(ctx.chat?.id || ctx.from?.id) === String(process.env.ADMIN_CHAT_ID);
}

async function guard(ctx) {
  if (!isEdo(ctx)) {
    await ctx.reply('🔒 Этот бот только для владельца.').catch(() => {});
    return false;
  }
  return true;
}

// ── System prompt for Claude ───────────────────────────────────────────────
function buildJarvisSystemPrompt() {
  const memory = getMemory();
  const base = buildSystemPrompt(memory);
  return `${base}

Ты — Jarvis, личный AI-ассистент Эдо, владельца LegalAuto.
Бизнес: автозапчасти (BMW, Geely, Li Auto) + оформление документов на авто.
Telegram-каналы: @LegalAutoParts24 (запчасти), @LegalAuto24 (новости для импортёров), @LegalAutoStore (объявления об авто).
Боты: @LegalAutoAssist_bot (клиенты), @LegalAutoAgentUprav_Bot (админ), @LegalAutoStore_Bot (авто объявления).
GAS база данных: ${process.env.APPS_SCRIPT_API_URL ? 'подключена' : 'не настроена'}.

Текущее время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК.
Аптайм системы: ${Math.floor((Date.now() - startTime) / 60000)} мин.

Отвечай по-русски, кратко и по делу. Если нужно выполнить действие — скажи что делаешь.
Не придумывай данные — если не знаешь, честно скажи.`;
}

// ── /status handler ────────────────────────────────────────────────────────
async function getStatusText() {
  const uptimeMin = Math.floor((Date.now() - startTime) / 60000);
  const uptimeH   = Math.floor(uptimeMin / 60);
  const uptimeM   = uptimeMin % 60;

  const checks = [];

  // Check GAS
  try {
    const url = new URL(process.env.APPS_SCRIPT_API_URL || 'http://localhost');
    url.searchParams.set('action', 'health');
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });
    const data = await res.json().catch(() => ({}));
    checks.push(`🗄 GAS: ${data.ok ? '✅ онлайн' : '⚠️ ответил, но ошибка'}`);
  } catch (e) {
    checks.push(`🗄 GAS: ❌ недоступен (${e.message.slice(0, 40)})`);
  }

  // Token presence checks
  checks.push(`🤖 AdminBot: ${process.env.ADMIN_BOT_TOKEN ? '✅' : '❌ токен отсутствует'}`);
  checks.push(`💬 ClientBot: ${process.env.CLIENT_BOT_TOKEN ? '✅' : '❌ токен отсутствует'}`);
  checks.push(`📰 NewsBot: ${process.env.NEWS_BOT_TOKEN ? '✅' : '⚠️ токен опционален'}`);
  checks.push(`🚗 StoreBot: ${process.env.AUTO_STORE_BOT_TOKEN ? '✅' : '⚠️ не настроен'}`);
  checks.push(`🧠 Claude API: ${process.env.CLAUDE_API_KEY ? '✅' : '❌ нет ключа'}`);
  checks.push(`💎 Gemini API: ${process.env.GEMINI_API_KEY ? '✅' : '⚠️ не подключён'}`);

  return `*Статус платформы LegalAuto*\n` +
    `⏱ Аптайм: ${uptimeH}ч ${uptimeM}м\n\n` +
    checks.join('\n');
}

// ── /leads handler ─────────────────────────────────────────────────────────
async function getLeadsText() {
  const result = await orchestrate({ type: 'get_leads' }, 'jarvis');
  return result.message;
}

// ── Thinking indicator ─────────────────────────────────────────────────────
async function withThinking(ctx, fn) {
  let msgId;
  try {
    const sent = await ctx.reply('🤔 Думаю...').catch(() => null);
    msgId = sent?.message_id;
    const result = await fn();
    if (msgId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
    }
    return result;
  } catch (e) {
    if (msgId) await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
    throw e;
  }
}

// ── Ask Claude ─────────────────────────────────────────────────────────────
async function askJarvis(chatId, userText) {
  const history = getHistory(chatId);
  pushHistory(chatId, 'user', userText);

  const messages = getHistory(chatId);

  const response = await claude().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: buildJarvisSystemPrompt(),
    messages,
  });

  const reply = response.content[0]?.text?.trim() || 'Не могу ответить.';
  pushHistory(chatId, 'assistant', reply);

  // Persist to memoryAgent
  addConversation(`Эдо: ${userText.slice(0, 100)}`);
  addConversation(`Jarvis: ${reply.slice(0, 100)}`);

  return reply;
}

// ── Setup ──────────────────────────────────────────────────────────────────
export function setupJarvisBot(bot) {
  // ── /start ───────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    if (!await guard(ctx)) return;
    await ctx.reply(
      `*Привет, Эдо! Я Jarvis — твой личный AI-ассистент LegalAuto.*\n\n` +
      `Что умею:\n` +
      `📊 /status — статус всех ботов\n` +
      `📋 /leads — заявки за сегодня\n` +
      `📈 /stats — аналитика\n` +
      `📦 /post — опубликовать запчасть\n` +
      `📰 /news — запустить newsBot\n` +
      `🚗 /cars — последние авто в канале\n` +
      `📣 /broadcast <текст> — рассылка клиентам\n` +
      `📋 /queue — очередь задач\n\n` +
      `Или просто напиши что нужно — я отвечу как AI.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /status ──────────────────────────────────────────────────────────────
  bot.command('status', async (ctx) => {
    if (!await guard(ctx)) return;
    const text = await withThinking(ctx, getStatusText);
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // ── /leads ───────────────────────────────────────────────────────────────
  bot.command('leads', async (ctx) => {
    if (!await guard(ctx)) return;
    const text = await withThinking(ctx, getLeadsText);
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // ── /post ────────────────────────────────────────────────────────────────
  bot.command('post', async (ctx) => {
    if (!await guard(ctx)) return;
    const result = await withThinking(ctx, () =>
      orchestrate({ type: 'post_part', payload: { requestedBy: 'edo_jarvis' } }, 'jarvis')
    );
    await ctx.reply(result.message || '✅ Готово.', { parse_mode: 'Markdown' });
  });

  // ── /stats ───────────────────────────────────────────────────────────────
  bot.command('stats', async (ctx) => {
    if (!await guard(ctx)) return;
    const result = await withThinking(ctx, () =>
      orchestrate({ type: 'get_stats' }, 'jarvis')
    );
    await ctx.reply(result.message || 'Нет данных.', { parse_mode: 'Markdown' });
  });

  // ── /broadcast ───────────────────────────────────────────────────────────
  bot.command('broadcast', async (ctx) => {
    if (!await guard(ctx)) return;
    const text = ctx.message.text.replace(/^\/broadcast\s*/i, '').trim();
    if (!text) {
      return ctx.reply('Использование: /broadcast <текст рассылки>');
    }
    const result = await withThinking(ctx, () =>
      orchestrate({ type: 'send_broadcast', payload: { text } }, 'jarvis')
    );
    await ctx.reply(result.message || '✅ Отправлено.', { parse_mode: 'Markdown' });
  });

  // ── /news ────────────────────────────────────────────────────────────────
  bot.command('news', async (ctx) => {
    if (!await guard(ctx)) return;
    await ctx.reply('📰 Запускаю newsBot...');
    const result = await orchestrate({ type: 'post_news' }, 'jarvis');
    await ctx.reply(result.message || '✅ Готово.', { parse_mode: 'Markdown' });
  });

  // ── /cars ────────────────────────────────────────────────────────────────
  bot.command('cars', async (ctx) => {
    if (!await guard(ctx)) return;
    const result = await withThinking(ctx, () =>
      orchestrate({ type: 'find_cars' }, 'jarvis')
    );
    await ctx.reply(result.message || 'Нет авто в базе.', { parse_mode: 'Markdown' });
  });

  // ── /queue ───────────────────────────────────────────────────────────────
  bot.command('queue', async (ctx) => {
    if (!await guard(ctx)) return;
    const { getTaskQueue } = await import('../agents/orchestratorAgent.js');
    const queue = getTaskQueue().slice(0, 10);
    if (!queue.length) return ctx.reply('📋 Очередь задач пуста.');
    const lines = queue.map(t =>
      `• [${t.status}] ${t.type} (${t.source}) — ${t.createdAt.slice(11, 19)}`
    );
    await ctx.reply(`*Последние 10 задач:*\n\`\`\`\n${lines.join('\n')}\n\`\`\``, { parse_mode: 'Markdown' });
  });

  // ── Free text → Claude Sonnet ─────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    if (!await guard(ctx)) return;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    try {
      // Агент-мозг: Claude Opus сам вызывает инструменты (аналитика, картинки, расчёты, постинг)
      const reply = await withThinking(ctx, () =>
        jarvisThink(text, { telegram: ctx.telegram, chatId: ctx.chat.id }));
      await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(reply));
    } catch (e) {
      console.error(`${TAG} AI error:`, e.message);
      await ctx.reply(`❌ Ошибка мозга: ${e.message}`);
    }
  });

  // ── Голосовые сообщения: распознаём (Whisper) → мозг → ответ ──────────────
  bot.on(['voice', 'audio'], async (ctx) => {
    if (!await guard(ctx)) return;
    try {
      const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const buf = Buffer.from(await (await fetch(link.href || link.toString())).arrayBuffer());
      const { transcribe } = await import('../agents/tts.js');
      const text = await transcribe(buf, 'voice.ogg');
      await ctx.reply(`🎙 _«${text}»_`, { parse_mode: 'Markdown' }).catch(() => {});
      const reply = await withThinking(ctx, () =>
        jarvisThink(text, { telegram: ctx.telegram, chatId: ctx.chat.id }));
      await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(reply));
    } catch (e) {
      console.error(`${TAG} voice error:`, e.message);
      await ctx.reply(`❌ Не расслышал голосовое: ${e.message}`);
    }
  });

  console.log(`${TAG} Handlers registered.`);
}

// ── Init (creates and launches the bot) ───────────────────────────────────
export async function initJarvisBot() {
  const token = process.env.JARVIS_BOT_TOKEN;
  if (!token) {
    console.log(`${TAG} JARVIS_BOT_TOKEN не задан — бот не запущен.`);
    return null;
  }

  botInstance = new Telegraf(token);
  setupJarvisBot(botInstance);

  botInstance.catch((err, ctx) => {
    console.error(`${TAG} Unhandled error:`, err.message, 'ctx:', ctx?.updateType);
  });

  await botInstance.launch({ dropPendingUpdates: true })
    .catch(e => console.error(`${TAG} Launch error:`, e.message));

  console.log(`${TAG} Launched (@LegalAuto247_bot).`);
  return botInstance;
}

export function getJarvisBot() { return botInstance; }

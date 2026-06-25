/**
 * LegalAuto — Orchestrator Agent (v2)
 *
 * Master brain that accepts structured tasks from JarvisBot or any other source,
 * routes them to the correct agent, and returns results back to Edo via adminBot.
 *
 * Export:  async function orchestrate(task, source)
 *   task   = { type: string, payload: object }
 *   source = 'jarvis' | 'admin' | 'scheduler' | 'client'
 *
 * Task types:
 *   'post_part'        — publish next part to @LegalAutoParts24
 *   'post_news'        — run newsBot cycle immediately
 *   'get_leads'        — fetch and summarise today's leads
 *   'get_stats'        — analytics from GAS
 *   'send_broadcast'   — send message to all clients via clientBot
 *   'find_cars'        — show latest cars in @LegalAutoStore
 *   'generate_content' — generate post text for a given topic/channel
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import https from 'https';

const TAG = '[OrchestratorAgent]';

// ── Clients ───────────────────────────────────────────────────────────────
const getClaudeClient = () =>
  new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });

// ── Task queue (in-memory, max 50) ────────────────────────────────────────
const taskQueue = [];
const MAX_QUEUE = 50;

function enqueue(task, source) {
  const entry = {
    id:        `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type:      task.type,
    payload:   task.payload || {},
    source:    source || 'unknown',
    status:    'queued',
    createdAt: new Date().toISOString(),
    result:    null,
    error:     null,
  };
  taskQueue.unshift(entry);
  if (taskQueue.length > MAX_QUEUE) taskQueue.length = MAX_QUEUE;
  return entry;
}

function updateTask(id, patch) {
  const idx = taskQueue.findIndex(t => t.id === id);
  if (idx !== -1) Object.assign(taskQueue[idx], patch);
}

export function getTaskQueue() { return [...taskQueue]; }

// ── GAS API helper ────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  const url = new URL(process.env.APPS_SCRIPT_API_URL || '');
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalAutoOrchestrator/2.0)' },
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

// ── Telegram send helper ───────────────────────────────────────────────────
async function tgSend(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'Markdown', disable_web_page_preview: true }),
  });
  return (await res.json()).ok;
}

// ── Individual task handlers ───────────────────────────────────────────────

async function handlePostPart(payload) {
  const { prepareAutoPost, publishToChannel } = await import('./postAgent.js');
  const result = await prepareAutoPost(payload.requestedBy || 'orchestrator');
  if (!result.ok) return { ok: false, message: `Пропуск: ${result.error}` };

  // publishToChannel needs a telegram client object — we use the raw Telegram Bot API instead
  const token = process.env.ADMIN_BOT_TOKEN;
  const channelId = process.env.PARTS_CHANNEL || '@LegalAutoParts24';
  const p = result.post?.part;
  if (!p) return { ok: false, message: 'Нет данных о запчасти' };

  const price = Number(p.price || 0).toLocaleString('ru-RU');
  const text = result.post?.text ||
    `🔩 *${p.brand} — ${p.name}*\n\n💰 Цена: ${price} ₽\n📦 Состояние: ${p.condition || 'б/у'}\n🚗 Авто: ${p.car || '—'}\n\n📲 Заказать → @LegalAutoAssist_bot`;

  let photoOk = false;
  if (p.photo_url) {
    const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, photo: p.photo_url, caption: text, parse_mode: 'Markdown' }),
    });
    photoOk = (await photoRes.json()).ok;
  }
  if (!photoOk) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, text, parse_mode: 'Markdown' }),
    });
  }

  // mark published in GAS
  if (p.id) {
    await gasGet('mark_published', { id: p.id }).catch(() => {});
  }

  return { ok: true, message: `Опубликовано: ${p.brand} ${p.name} (${price} ₽)` };
}

async function handlePostNews() {
  const { runNewsBot } = await import('../bots/newsBot.js');
  await runNewsBot();
  return { ok: true, message: 'Цикл newsBot запущен. Посты ожидают одобрения.' };
}

async function handleGetLeads(payload) {
  const data = await gasGet('leads');
  const leads = data?.leads || [];
  const today = new Date().toDateString();
  const todayLeads = leads.filter(l => l.created_at && new Date(l.created_at).toDateString() === today);
  const statuses = { new: 0, processing: 0, done: 0, cancelled: 0, other: 0 };
  for (const l of todayLeads) {
    const st = (l.status || 'other').toLowerCase();
    if (st in statuses) statuses[st]++;
    else statuses.other++;
  }
  const text =
    `📋 *Заявки за сегодня: ${todayLeads.length}*\n` +
    `🆕 Новые: ${statuses.new}\n` +
    `⚙️ В работе: ${statuses.processing}\n` +
    `✅ Закрыты: ${statuses.done}\n` +
    `❌ Отменены: ${statuses.cancelled}\n\n` +
    `Всего в системе: ${leads.length}`;
  return { ok: true, message: text, data: { todayLeads, total: leads.length } };
}

async function handleGetStats() {
  const { getStats, formatReport } = await import('./analyticsAgent.js');
  const stats = await getStats('today');
  return { ok: true, message: formatReport(stats, 'today'), data: stats };
}

async function handleSendBroadcast(payload) {
  const { text } = payload;
  if (!text) return { ok: false, message: 'Текст рассылки не указан' };

  const data = await gasGet('leads');
  const leads = data?.leads || [];
  const clientToken = process.env.CLIENT_BOT_TOKEN;
  if (!clientToken) return { ok: false, message: 'CLIENT_BOT_TOKEN не задан' };

  // Unique active chat IDs from leads
  const chatIds = [...new Set(
    leads.filter(l => l.chat_id || l.telegram_id).map(l => l.chat_id || l.telegram_id)
  )];

  let sent = 0, failed = 0;
  for (const chatId of chatIds) {
    const ok = await tgSend(clientToken, chatId, text);
    if (ok) sent++; else failed++;
    await new Promise(r => setTimeout(r, 200));
  }

  return { ok: true, message: `Рассылка завершена: отправлено ${sent}, ошибок ${failed}` };
}

async function handleFindCars() {
  const data = await gasGet('cars', { limit: '5' }).catch(() => ({ cars: [] }));
  const cars = data?.cars || [];
  if (!cars.length) return { ok: true, message: 'Нет авто в базе @LegalAutoStore.' };

  const lines = cars.slice(0, 5).map(c => {
    const price = c.price ? `${Number(c.price).toLocaleString('ru-RU')} ₽` : 'по запросу';
    return `🚗 *${c.brand || ''} ${c.model || ''}* ${c.year || ''} — ${price}`;
  });
  return { ok: true, message: `*Последние авто в @LegalAutoStore:*\n\n${lines.join('\n')}`, data: cars };
}

async function handleGenerateContent(payload) {
  const { topic, channel = '@LegalAuto24', style = '' } = payload;
  if (!topic) return { ok: false, message: 'Тема не указана' };

  const claude = getClaudeClient();
  const channelCtx = {
    '@LegalAuto24':      'канал для импортёров авто. Аудитория: люди, которые сами ввозят авто в РФ. Нужны: таможня, СБКТС/ЭПТС, утильсбор, параллельный импорт.',
    '@LegalAutoParts24': 'канал запчастей BMW, Geely, Li Auto. Аудитория: автовладельцы и механики.',
    '@LegalAutoStore':   'канал продажи авто. Аудитория: покупатели авто. Конкретные объявления.',
  };
  const ctx = channelCtx[channel] || 'канал LegalAuto';

  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Ты копирайтер Telegram-канала LegalAuto.
Контекст канала ${channel}: ${ctx}
${style ? 'Особые указания: ' + style : ''}
Стиль: экспертный, лаконичный, 2-3 эмодзи, без хэштегов.
В конце CTA: написать @LegalAuto247 или @LegalAutoAssist_bot.

Напиши пост на тему: "${topic}"
Длина: 4-7 строк.`,
    }],
  });

  const text = msg.content[0].text.trim();
  return { ok: true, message: text, data: { text, topic, channel } };
}

// ── Main orchestrate() ─────────────────────────────────────────────────────
/**
 * @param {{ type: string, payload?: object }} task
 * @param {string} [source]
 * @returns {Promise<{ ok: boolean, message: string, data?: any, taskId: string }>}
 */
export async function orchestrate(task, source = 'unknown') {
  const entry = enqueue(task, source);
  const startedAt = Date.now();

  console.log(`${TAG} [${entry.id}] type=${task.type} source=${source}`);
  updateTask(entry.id, { status: 'running', startedAt: new Date().toISOString() });

  let result;
  try {
    switch (task.type) {
      case 'post_part':        result = await handlePostPart(task.payload || {}); break;
      case 'post_news':        result = await handlePostNews(); break;
      case 'get_leads':        result = await handleGetLeads(task.payload || {}); break;
      case 'get_stats':        result = await handleGetStats(); break;
      case 'send_broadcast':   result = await handleSendBroadcast(task.payload || {}); break;
      case 'find_cars':        result = await handleFindCars(); break;
      case 'generate_content': result = await handleGenerateContent(task.payload || {}); break;
      default:
        result = { ok: false, message: `Неизвестный тип задачи: ${task.type}` };
    }
  } catch (err) {
    console.error(`${TAG} [${entry.id}] error:`, err.message);
    result = { ok: false, message: `Ошибка: ${err.message}` };
    updateTask(entry.id, { status: 'error', error: err.message, completedAt: new Date().toISOString() });
    return { ...result, taskId: entry.id };
  }

  const elapsed = Date.now() - startedAt;
  updateTask(entry.id, { status: 'done', result, completedAt: new Date().toISOString(), elapsedMs: elapsed });
  console.log(`${TAG} [${entry.id}] done in ${elapsed}ms — ok=${result.ok}`);

  return { ...result, taskId: entry.id };
}

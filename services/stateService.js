/**
 * LegalAuto — Platform State Service.
 * ЕДИНОЕ состояние платформы: задачи, события, heartbeats, секции.
 * Хранение: Railway Volume (/data, переживает деплой) или локально ./data.
 *
 * Каждая задача: { id, type, source, status: created/processing/done/failed,
 *                  owner, created_at, updated_at, result, error, meta }
 *
 * Правила:
 *  - Агенты НЕ хранят своё состояние сами — пишут сюда.
 *  - status=failed → автоматический доклад Эдо (ADMIN_CHAT_ID).
 *  - Jarvis читает stateSummary() и отвечает фактами, не гаданием.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Постоянный диск: Railway Volume → /data; локально → ./data
export const PERSIST_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(ROOT, 'data');
try { mkdirSync(PERSIST_DIR, { recursive: true }); } catch {}

/** Путь к персистентному файлу + разовая миграция из старого ./data репозитория */
export function persistentPath(filename) {
  const target = join(PERSIST_DIR, filename);
  const legacy = join(ROOT, 'data', filename);
  try {
    if (!existsSync(target) && legacy !== target && existsSync(legacy)) copyFileSync(legacy, target);
  } catch {}
  return target;
}

const STATE_FILE = join(PERSIST_DIR, 'platform_state.json');
const MAX_EVENTS = 300;
const MAX_TASKS = 400;

function emptyState() {
  return { tasks: {}, events: [], heartbeats: {}, sections: {}, updated_at: null };
}
function load() {
  try { return { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; }
  catch { return emptyState(); }
}
let state = load();

function save() {
  state.updated_at = new Date().toISOString();
  try {
    const tmp = STATE_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, STATE_FILE);   // атомарно — не бьём файл при падении
  } catch (e) { console.error('[State] save:', e.message); }
}

async function notifyEdo(text) {
  const t = process.env.ADMIN_BOT_TOKEN, c = process.env.ADMIN_CHAT_ID;
  if (!t || !c) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

// ── Задачи ───────────────────────────────────────────────────────────────────
export function createTask({ type, source = 'unknown', owner = 'system', meta = {} }) {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  state.tasks[id] = { id, type, source, owner, status: 'created', created_at: now, updated_at: now, result: null, error: null, meta };
  // подрезаем старые done-задачи
  const ids = Object.keys(state.tasks);
  if (ids.length > MAX_TASKS) {
    ids.map(i => state.tasks[i])
      .filter(t => t.status === 'done')
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(0, ids.length - MAX_TASKS)
      .forEach(t => delete state.tasks[t.id]);
  }
  save();
  return id;
}
export function updateTask(id, patch = {}) {
  const t = state.tasks[id]; if (!t) return;
  Object.assign(t, patch, { updated_at: new Date().toISOString() });
  save();
  if (patch.status === 'failed') {
    logEvent('task_failed', { id, type: t.type, error: String(t.error || '').slice(0, 200) });
    notifyEdo(`🔴 Задача провалилась\n${t.type} (${t.source}, #${id})\n${String(t.error || '').slice(0, 300)}`);
  }
}
export const taskProcessing = (id) => updateTask(id, { status: 'processing' });
export const taskDone = (id, result = null) => updateTask(id, { status: 'done', result });
export const taskFailed = (id, error) => updateTask(id, { status: 'failed', error: String(error?.message || error) });

// ── События (журнал решений/действий) ────────────────────────────────────────
export function logEvent(kind, data = {}) {
  state.events.push({ at: new Date().toISOString(), kind, ...data });
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  save();
}

// ── Heartbeats (кто жив) ─────────────────────────────────────────────────────
export function heartbeat(name, info = {}) {
  state.heartbeats[name] = { at: new Date().toISOString(), ...info };
  save();
}

// ── Секции (analytics, crm, posts... — любые срезы платформы) ────────────────
export function setSection(name, obj) { state.sections[name] = { ...obj, updated_at: new Date().toISOString() }; save(); }
export function getSection(name) { return state.sections[name]; }

export function getState() { return state; }

// ── Сводка для Jarvis — компактные ФАКТЫ вместо гаданий ─────────────────────
export function stateSummary() {
  const now = Date.now();
  const ago = (iso) => { const m = Math.round((now - Date.parse(iso)) / 60000); return m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`; };

  const hb = Object.entries(state.heartbeats).map(([k, v]) => {
    const stale = now - Date.parse(v.at) > 15 * 60_000;
    return `${stale ? '🔴' : '🟢'} ${k}: ${ago(v.at)}${v.note ? ' — ' + v.note : ''}`;
  });

  const tasks = Object.values(state.tasks).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const active = tasks.filter(t => ['created', 'processing'].includes(t.status));
  const failed = tasks.filter(t => t.status === 'failed').slice(0, 5);
  const recentDone = tasks.filter(t => t.status === 'done').slice(0, 5);
  const fmtT = (t) => `#${t.id} ${t.type} [${t.source}] ${t.status} (${ago(t.updated_at)})${t.error ? ' — ' + String(t.error).slice(0, 80) : ''}${t.result?.url ? ' → ' + t.result.url : ''}`;

  const events = state.events.slice(-12).map(e => `${e.at.slice(11, 16)} ${e.kind}${e.note ? ': ' + e.note : ''}`);
  const sections = Object.entries(state.sections).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 160)}`);

  return [
    '=== PLATFORM STATE (реальные данные, не гадание) ===',
    `Компоненты (heartbeat):\n${hb.join('\n') || '—'}`,
    `Задачи в работе (${active.length}):\n${active.map(fmtT).join('\n') || '—'}`,
    `Последние провалы:\n${failed.map(fmtT).join('\n') || '— нет'}`,
    `Последние выполненные:\n${recentDone.map(fmtT).join('\n') || '—'}`,
    `Журнал (последние события):\n${events.join('\n') || '—'}`,
    sections.length ? `Срезы:\n${sections.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

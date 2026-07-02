// ============================================================
// LEGAL AUTO — Memory Agent
// Долгосрочная память Эдо: бизнес-контекст, предпочтения,
// история решений, задачи, заметки
//
// Хранение: JSON файл (memory.json) рядом с проектом
// Может быть мигрирован на Supabase в будущем
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { persistentPath } from '../services/stateService.js';
const MEMORY_FILE = persistentPath('edo_memory.json');

// ── Структура памяти ──────────────────────────────────────────────────────
const DEFAULT_MEMORY = {
  version: 1,
  owner: 'Эдо',
  business: {
    name: 'LegalAuto',
    type: 'автозапчасти',
    channel: '@LegalAuto24',
    description: 'Интернет-магазин автозапчастей (BMW, Geely, Li Auto, Mercedes, Audi, Toyota)',
  },
  preferences: {
    language: 'ru',
    tone: 'профессиональный но дружеский',
    briefingTime: '09:00',
    autoPostEnabled: true,
    autoPostInterval: 6, // часов
    escalateHotLeads: true,
  },
  stats: {
    totalLeads: 0,
    hotLeads: 0,
    postsPublished: 0,
    tasksCompleted: 0,
    lastActivity: null,
  },
  decisions: [],      // история решений Эдо
  notes: [],          // заметки и напоминания
  tasks: [],          // задачи в работе
  learnedFacts: [],   // что Эдо говорил / чему научил бота
  context: {},        // свободный контекст (key-value)
  conversations: [],  // последние 50 сообщений (кратко)
};

// ── Загрузка/сохранение ───────────────────────────────────────────────────
function load() {
  try {
    if (!existsSync(MEMORY_FILE)) {
      save(DEFAULT_MEMORY);
      return { ...DEFAULT_MEMORY };
    }
    const raw = readFileSync(MEMORY_FILE, 'utf-8');
    const mem = JSON.parse(raw);
    // Мерж с дефолтами на случай новых полей
    return deepMerge(DEFAULT_MEMORY, mem);
  } catch (e) {
    console.error('[MemoryAgent] Ошибка загрузки памяти:', e.message);
    return { ...DEFAULT_MEMORY };
  }
}

function save(mem) {
  try {
    const dir = join(__dirname, '..', 'data');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf-8');
  } catch (e) {
    console.error('[MemoryAgent] Ошибка сохранения памяти:', e.message);
  }
}

function deepMerge(defaults, override) {
  const result = { ...defaults };
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(defaults[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ── Публичное API ──────────────────────────────────────────────────────────

/**
 * Получить всю память
 */
export function getMemory() {
  return load();
}

/**
 * Добавить факт (чему Эдо научил бота)
 * @param {string} fact
 */
export function learnFact(fact) {
  const mem = load();
  mem.learnedFacts.push({
    fact,
    timestamp: new Date().toISOString(),
  });
  if (mem.learnedFacts.length > 200) mem.learnedFacts.shift();
  save(mem);
}

/**
 * Запомнить решение Эдо
 * @param {string} situation - что было
 * @param {string} decision  - что решил
 */
export function rememberDecision(situation, decision) {
  const mem = load();
  mem.decisions.push({
    situation,
    decision,
    timestamp: new Date().toISOString(),
  });
  if (mem.decisions.length > 100) mem.decisions.shift();
  save(mem);
}

/**
 * Добавить заметку / напоминание
 * @param {string} text
 * @param {string|null} remindAt - ISO дата или null
 */
export function addNote(text, remindAt = null) {
  const mem = load();
  const note = {
    id: Date.now(),
    text,
    remindAt,
    done: false,
    created: new Date().toISOString(),
  };
  mem.notes.push(note);
  save(mem);
  return note;
}

/**
 * Пометить заметку как выполненную
 */
export function doneNote(id) {
  const mem = load();
  const note = mem.notes.find(n => n.id === Number(id));
  if (note) {
    note.done = true;
    save(mem);
    return true;
  }
  return false;
}

/**
 * Получить активные заметки
 */
export function getActiveNotes() {
  const mem = load();
  return mem.notes.filter(n => !n.done);
}

/**
 * Установить произвольный контекст
 */
export function setContext(key, value) {
  const mem = load();
  mem.context[key] = { value, updated: new Date().toISOString() };
  save(mem);
}

/**
 * Получить контекст по ключу
 */
export function getContext(key) {
  const mem = load();
  return mem.context[key]?.value ?? null;
}

/**
 * Обновить статистику
 */
export function updateStats(delta = {}) {
  const mem = load();
  for (const [k, v] of Object.entries(delta)) {
    if (typeof mem.stats[k] === 'number') {
      mem.stats[k] += v;
    }
  }
  mem.stats.lastActivity = new Date().toISOString();
  save(mem);
}

/**
 * Добавить сообщение в историю диалога
 */
export function addConversation(role, text) {
  const mem = load();
  mem.conversations.push({
    role,     // 'user' | 'assistant'
    text: text.slice(0, 500),  // обрезаем длинные сообщения
    ts: new Date().toISOString(),
  });
  if (mem.conversations.length > 50) mem.conversations.shift();
  save(mem);
}

/**
 * Получить последние N сообщений для контекста AI
 */
export function getRecentConversations(n = 10) {
  const mem = load();
  return mem.conversations.slice(-n);
}

/**
 * Собрать системный промпт с памятью для AI
 */
export function buildSystemPrompt() {
  const mem = load();
  const recentDecisions = mem.decisions.slice(-5).map(d =>
    `• Ситуация: ${d.situation} → Решение: ${d.decision}`
  ).join('\n');

  const learnedFacts = mem.learnedFacts.slice(-10).map(f => `• ${f.fact}`).join('\n');
  const activeNotes = mem.notes.filter(n => !n.done).slice(0, 5).map(n => `• ${n.text}`).join('\n');

  return `Ты — личный AI-ассистент Эдо, владельца бизнеса ${mem.business.name}.

БИЗНЕС:
• Тип: ${mem.business.description}
• Канал: ${mem.business.channel}
• Всего лидов: ${mem.stats.totalLeads}, горячих: ${mem.stats.hotLeads}
• Постов опубликовано: ${mem.stats.postsPublished}

ПРЕДПОЧТЕНИЯ ЭДО:
• Язык: русский
• Тон: ${mem.preferences.tone}
• Автопостинг каждые ${mem.preferences.autoPostInterval} часов

${recentDecisions ? `ПОСЛЕДНИЕ РЕШЕНИЯ ЭДО:\n${recentDecisions}` : ''}

${learnedFacts ? `ЧТО ЭДО ГОВОРИЛ / ЧЕМУ НАУЧИЛ:\n${learnedFacts}` : ''}

${activeNotes ? `АКТИВНЫЕ ЗАДАЧИ/ЗАМЕТКИ:\n${activeNotes}` : ''}

ТВОИ ПРАВИЛА:
1. Всегда отвечай на русском
2. Будь лаконичным — Эдо занят
3. Если нужно решение — предлагай конкретное, не спрашивай без необходимости
4. Действуй самостоятельно когда можешь — спрашивай только если нужно разрешение
5. При ошибках — сообщай коротко и сразу предлагай решение
6. Помни прошлые решения Эдо и учись на них`;
}

/**
 * Обновить настройки
 */
export function updatePreferences(prefs = {}) {
  const mem = load();
  mem.preferences = { ...mem.preferences, ...prefs };
  save(mem);
}

/**
 * Получить статистику для брифинга
 */
export function getStatsForBriefing() {
  const mem = load();
  return {
    ...mem.stats,
    notesCount: mem.notes.filter(n => !n.done).length,
    learnedFactsCount: mem.learnedFacts.length,
    decisionsCount: mem.decisions.length,
    preferences: mem.preferences,
  };
}

console.log('🧠 Memory Agent загружен — долгосрочная память Эдо активна');

// Экспорт saveMemory для других агентов
export const saveMemory = save;

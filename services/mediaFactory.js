/**
 * LEGAL AUTO — MEDIA_FACTORY · Collections Engine (Этапы 1-2).
 *
 * Каждый ролик = ТЕМА, а не случайные детали.
 * analyzeCatalog(parts) → смысловые коллекции: (марка+модель) × категория,
 * скоринг по цене/ликвидности/фото/новизне. pickCollection() → тема дня
 * без повторов (трекинг на постоянном диске).
 *
 *   buildCollections(parts) → [{ id, title, theme, brand, model, category, parts[], score }]
 *   pickCollection(parts, { platform }) → лучшая неиспользованная коллекция
 *   markCollectionUsed(id, platform)
 */
import { readFileSync, writeFileSync } from 'fs';
import { persistentPath, logEvent } from './stateService.js';

const USED_FILE = persistentPath('collections_used.json');
const loadUsed = () => { try { return JSON.parse(readFileSync(USED_FILE, 'utf8')); } catch { return {}; } };
const saveUsed = (u) => { try { writeFileSync(USED_FILE, JSON.stringify(u, null, 1)); } catch {} };

// Категория → человеческое имя темы (для заголовка коллекции)
const CATEGORY_TITLES = {
  'Фары': 'Оптика', 'Фонари': 'Оптика',
  'Кузов': 'Кузовные детали', 'Подвеска': 'Подвеска',
  'Электрика': 'Электрика', 'Прочее': null,
};
// Смысловые подгруппы внутри «Кузов»/«Прочее» — по названию детали
const SUBGROUPS = [
  { name: 'Двери и молдинги', kw: ['двер', 'молдинг'] },
  { name: 'Передняя часть', kw: ['бампер', 'решетк', 'решётк', 'капот', 'воздуховод', 'усилител'] },
  { name: 'Крылья и пороги', kw: ['крыл', 'порог', 'арк', 'подкрылок'] },
  { name: 'Багажник и задняя часть', kw: ['багажник', 'крышк', 'спойлер'] },
  { name: 'Салон', kw: ['салон', 'обшивк', 'сиден', 'подлокот', 'торпед', 'руль'] },
  { name: 'Тормоза', kw: ['тормоз', 'колодк', 'суппорт'] },
];

function subgroupOf(p) {
  const hay = String(p.name || '').toLowerCase();
  const g = SUBGROUPS.find(g => g.kw.some(k => hay.includes(k)));
  return g ? g.name : null;
}

// Скоринг детали: цена (ликвидность/чек) + фото (визуальность) + наличие
function partScore(p) {
  const price = Number(p.price) || 0;
  const photos = (p.photos || []).length || 1;
  return Math.min(price / 5000, 10) * 3 + photos * 2 + (Number(p.qty) > 0 ? 2 : 0);
}

/** Этапы 1-2: анализ каталога → смысловые коллекции */
export function buildCollections(parts) {
  const groups = new Map();   // key: brand|model|topic
  for (const p of parts) {
    if (!p.photo || !p.name) continue;
    const brand = String(p.brand || '').trim();
    const model = String(p.display_car || p.title || '').replace(/•/g, '·').trim()
      || `${brand} ${String(p.series || '').replace(/\|/g, '/')}`.trim();
    const catTitle = CATEGORY_TITLES[String(p.category || '').trim()];
    const topic = catTitle || subgroupOf(p);
    if (!topic || !brand) continue;
    const key = `${brand}|${model}|${topic}`;
    if (!groups.has(key)) groups.set(key, { brand, model, topic, parts: [] });
    groups.get(key).parts.push(p);
  }

  const collections = [];
  for (const g of groups.values()) {
    // дедуп по названию — «дверь, дверь, дверь» запрещено
    const seen = new Set();
    const uniq = g.parts.filter(p => {
      const k = String(p.name).toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).sort((a, b) => partScore(b) - partScore(a));
    if (uniq.length < 3) continue;   // тема без содержания — не коллекция

    const top = uniq.slice(0, 6);
    const score = top.reduce((s, p) => s + partScore(p), 0) / top.length;
    const title = `${g.topic} ${g.model}`.replace(/\s+/g, ' ').trim();
    collections.push({
      id: title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').slice(0, 60),
      title, theme: g.topic, brand: g.brand, model: g.model,
      parts: top, score: Math.round(score * 10) / 10, size: uniq.length,
    });
  }
  return collections.sort((a, b) => b.score - a.score);
}

/** Лучшая НЕиспользованная коллекция (ротация тем, без повторов) */
export function pickCollection(parts, { platform = 'youtube' } = {}) {
  const cols = buildCollections(parts);
  if (!cols.length) return null;
  const used = loadUsed();
  const fresh = cols.filter(c => !(used[c.id] || []).includes(platform));
  const pick = (fresh.length ? fresh : cols)[0];
  // среди топ-5 берём случайную — чтобы дни не были предсказуемо одинаковыми
  const pool = (fresh.length ? fresh : cols).slice(0, 5);
  return pool[Math.floor(Math.random() * pool.length)] || pick;
}

export function markCollectionUsed(id, platform = 'youtube') {
  const used = loadUsed();
  used[id] = Array.from(new Set([...(used[id] || []), platform]));
  // трекинг не растёт бесконечно
  const keys = Object.keys(used);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete used[k];
  saveUsed(used);
  logEvent('collection_used', { note: `${id} → ${platform}` });
}

/** Для Jarvis: обзор доступных тем */
export function listCollections(parts, limit = 10) {
  return buildCollections(parts).slice(0, limit)
    .map(c => `${c.title} — ${c.size} дет., топ: ${c.parts.slice(0, 3).map(p => p.name).join(', ')} (score ${c.score})`);
}

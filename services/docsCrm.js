/**
 * LegalAuto — CRM «Документы» v2 (по реальной таблице Эдо «работы СБКТС»).
 *
 * Заказ = МАШИНА клиента. У машины НЕСКОЛЬКО работ (СБКТС, ЭПТС, Утиль, Внесение),
 * у каждой работы: свой СРМ-номер, цена клиенту, себестоимость, статус.
 * Статусы работы (из таблицы Эдо): Ожидание → Макет → Печать → Эптс → Выпущено → Оплачено / Отмена.
 * Лаборатория: название + дата ("Одинцово 13.09").
 * Нумерация машин по клиенту: А1, А2 (один клиент), Б1 (другой).
 *
 * + База знаний (docs_knowledge): лаборатории (Серконс ~20, у Кати свои), себестоимости
 *   по услугам в каждой лаборатории, растаможка под ключ по таможенным постам.
 *   Себестоимость работы подставляется из базы знаний автоматически, если не указана.
 *
 * Хранится ТОЛЬКО на сервере Эдо (Railway Volume).
 */
import { getSection, setSection, logEvent } from './stateService.js';

export const WORK_TYPES = ['СБКТС', 'ЭПТС', 'Утиль', 'Внесение'];
export const WORK_STATUSES = ['Ожидание', 'Макет', 'Печать', 'Эптс', 'Выпущено', 'Оплачено', 'Отмена'];

function orders() {
  const cur = getSection('docs_orders') || {};
  return Array.isArray(cur.list) ? cur.list : [];
}
function save(list) { setSection('docs_orders', { list }); }

// ── База знаний: лаборатории, себестоимости, растаможка ─────────────────────
function knowledge() {
  const k = getSection('docs_knowledge') || {};
  return { labs: k.labs || [], customs: k.customs || [] };
}
// lab: { name: 'Одинцово', owner: 'Серконс'|'Катя', costs: { 'СБКТС': 15000, 'ЭПТС': 800, 'Утиль': 0 }, notes }
export function upsertLab({ name, owner = '', costs = {}, notes = '' }) {
  const k = knowledge();
  const i = k.labs.findIndex(l => l.name.toLowerCase() === String(name).toLowerCase());
  // rev 9999 = «правил вручную», будущий сид из репо это не затрёт
  if (i >= 0) k.labs[i] = { ...k.labs[i], owner: owner || k.labs[i].owner, costs: { ...k.labs[i].costs, ...costs }, notes: notes || k.labs[i].notes, rev: 9999 };
  else k.labs.push({ name, owner, costs, notes, rev: 9999 });
  setSection('docs_knowledge', k);
  logEvent('docs_kb_lab', { note: `${name} (${owner})` });
  return k.labs.find(l => l.name.toLowerCase() === String(name).toLowerCase());
}
// customs: { post: 'МАПП Забайкальск', price: 120000, includes: 'под ключ + СБКТС + ЭПТС', notes }
export function upsertCustoms({ post, price = 0, includes = '', notes = '' }) {
  const k = knowledge();
  const i = k.customs.findIndex(c => c.post.toLowerCase() === String(post).toLowerCase());
  if (i >= 0) k.customs[i] = { ...k.customs[i], price: price || k.customs[i].price, includes: includes || k.customs[i].includes, notes: notes || k.customs[i].notes };
  else k.customs.push({ post, price, includes, notes });
  setSection('docs_knowledge', k);
  logEvent('docs_kb_customs', { note: post });
  return k.customs.find(c => c.post.toLowerCase() === String(post).toLowerCase());
}
export function getKnowledge() { return knowledge(); }

// Удалить лабораторию из активных (партнёр отвалился / точка закрылась)
export function removeLab(name) {
  const k = knowledge();
  const before = k.labs.length;
  k.labs = k.labs.filter(l => l.name.toLowerCase() !== String(name).toLowerCase());
  setSection('docs_knowledge', k);
  const removed = before - k.labs.length;
  if (removed) logEvent('docs_kb_lab_del', { note: name });
  return removed;
}

// Сид базы знаний из brand/docs_knowledge_seed.json (прайсы партнёров, себестоимости).
// НЕ перезаписывает добавленное через Джарвиса — только дополняет отсутствующее.
export async function seedKnowledge() {
  try {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const seed = JSON.parse(await readFile(join(root, 'brand', 'docs_knowledge_seed.json'), 'utf8'));
    const k = knowledge();
    let added = 0, updated = 0;
    for (const lab of seed.labs || []) {
      const ex = k.labs.find(l => l.name.toLowerCase() === lab.name.toLowerCase());
      if (!ex) { k.labs.push(lab); added++; }
      // Обновляем ТОЛЬКО если у сида выше rev — не затираем правки, сделанные Джарвисом
      else if ((lab.rev || 0) > (ex.rev || 0)) { Object.assign(ex, lab); updated++; }
    }
    for (const c of seed.customs || []) {
      const ex = k.customs.find(x => x.post.toLowerCase() === c.post.toLowerCase());
      if (!ex) { k.customs.push(c); added++; }
      else if ((c.rev || 0) > (ex.rev || 0)) { Object.assign(ex, c); updated++; }
    }
    if (added || updated) { setSection('docs_knowledge', k); console.log(`[DocsCRM] 📚 База знаний: +${added} новых, ${updated} обновлено из сида`); }
  } catch (e) { console.error('[DocsCRM] seed:', e.message); }
}
export function labCost(labName, workType) {
  const lab = knowledge().labs.find(l => labName && l.name.toLowerCase() === String(labName).toLowerCase());
  return lab?.costs?.[workType] ?? null;
}

// Рыночный бенчмарк конкурентов (разведка июль 2026: whitebrokerdv.ru, vlb-broker.ru, агрегаторы).
// Чтобы Джарвис показывал «мы дешевле рынка» при просчёте клиенту.
export const MARKET = {
  'СБКТС+ЭПТС': { low: 40000, high: 60000, note: 'у брокеров СБКТС идёт пакетом с растаможкой 40-60к' },
  'ЭПТС': { low: 7000, high: 15000, note: '' },
  'Утиль коммерческий': { low: 25000, high: 40000, note: 'после отмены льгот 12.2025 спрос вырос' },
  'Утиль льготный': { low: 25000, high: 40000, note: '' },
  'ГЛОНАСС': { low: 28000, high: 40000, note: '' },
};

// Просчёт услуги для КЛИЕНТА: ищем где дешевле себес и предлагаем цену с наценкой.
// Возвращает варианты (дешёвый/средний) + твою маржу. Для быстрых котировок в продажах.
export function quoteService(workType, { region = '', markup = 10000 } = {}) {
  const k = knowledge();
  // Синонимы регионов: «Москва/МСК» → лаборатории МО, «Питер» → СПб и т.п.
  const SYN = {
    'москва': ['москва', 'мо,', 'мо ', 'одинцово', 'химки', 'чехов', 'селятино', 'голицыно', 'люберцы', 'дмитров', 'бронницы'],
    'мск': ['мо,', 'одинцово', 'химки', 'чехов', 'селятино', 'голицыно', 'люберцы', 'дмитров'],
    'питер': ['спб', 'санкт', 'руставели', 'ленинград', 'федоровское'],
    'спб': ['спб', 'санкт', 'руставели', 'ленинград', 'федоровское'],
  };
  const rlow = region ? String(region).toLowerCase().trim() : '';
  const needles = SYN[rlow] || (rlow ? [rlow] : []);
  const opts = k.labs
    .map(l => ({ lab: l.name, owner: l.owner, cost: l.costs?.[workType], notes: l.notes }))
    .filter(o => typeof o.cost === 'number' && o.cost > 0)
    .filter(o => !needles.length || needles.some(nd => o.lab.toLowerCase().includes(nd) || (o.notes || '').toLowerCase().includes(nd)))
    .sort((a, b) => a.cost - b.cost);
  if (!opts.length) return { workType, region, options: [] };
  const cheapest = opts[0];
  const clientPrice = cheapest.cost + markup;
  const mk = MARKET[workType];
  const market = mk ? { ...mk, cheaper: mk.low - clientPrice } : null;   // насколько мы ниже нижней планки рынка
  return {
    workType, region,
    cheapest, clientPrice, margin: markup, market,
    options: opts.slice(0, 5).map(o => ({ ...o, client: o.cost + markup, margin: markup })),
  };
}

// ── Нумерация по клиенту: А1, А2 / Б1 ────────────────────────────────────────
const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ';
function clientLetter(client, list) {
  const key = String(client).trim().toLowerCase();
  const known = {};
  for (const o of list) if (o.client_key) known[o.client_key] = o.id.replace(/\d+$/, '');
  if (known[key]) return known[key];
  const used = new Set(Object.values(known));
  for (const ch of LETTERS) if (!used.has(ch)) return ch;
  return 'Я';
}

// ── Заказ-машина ─────────────────────────────────────────────────────────────
// works: [{ crm, type, price, cost, status }]
export function addOrder({ client, phone = '', car, vin = '', lab = '', lab_date = '', works = [], notes = '' }) {
  const list = orders();
  const letter = clientLetter(client, list);
  const n = list.filter(o => o.id.replace(/\d+$/, '') === letter).length + 1;
  const id = `${letter}${n}`;
  const now = new Date().toISOString();
  const normWorks = (works.length ? works : [{ type: 'СБКТС' }, { type: 'ЭПТС' }]).map(w => ({
    crm: w.crm || '', type: w.type, price: Number(w.price) || 0,
    cost: w.cost !== undefined ? Number(w.cost) : (labCost(lab, w.type) ?? 0),
    status: w.status || 'Ожидание',
  }));
  const o = { id, client_key: String(client).trim().toLowerCase(), client, phone, car, vin, lab, lab_date, works: normWorks, notes, created: now, updated: now };
  list.unshift(o); save(list);
  logEvent('docs_order_new', { note: `${id}: ${client} — ${car} (${normWorks.map(w => w.type).join('+')})` });
  return o;
}

// Обновление: полей машины и/или конкретной работы (по типу или СРМ)
export function updateOrder(id, patch = {}) {
  const list = orders();
  const o = list.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!o) return null;
  for (const k of ['lab', 'lab_date', 'notes', 'vin', 'phone']) if (patch[k] !== undefined) o[k] = patch[k];
  if (patch.add_work) {
    const w = patch.add_work;
    o.works.push({ crm: w.crm || '', type: w.type, price: Number(w.price) || 0, cost: w.cost !== undefined ? Number(w.cost) : (labCost(o.lab, w.type) ?? 0), status: w.status || 'Ожидание' });
  }
  if (patch.work) {   // { type или crm, status?, price?, cost?, crm? }
    const q = patch.work;
    const w = o.works.find(x => (q.crm && x.crm === String(q.crm)) || (q.type && x.type.toLowerCase() === String(q.type).toLowerCase()));
    if (w) {
      if (q.status !== undefined) w.status = q.status;
      if (q.price !== undefined) w.price = Number(q.price);
      if (q.cost !== undefined) w.cost = Number(q.cost);
      if (q.set_crm !== undefined) w.crm = String(q.set_crm);
    }
  }
  if (patch.all_paid) o.works.forEach(w => { if (w.status !== 'Отмена') w.status = 'Оплачено'; });
  o.updated = new Date().toISOString();
  save(list);
  logEvent('docs_order_upd', { note: `${o.id}: ${JSON.stringify(patch).slice(0, 110)}` });
  return o;
}

export function listOrders({ activeOnly = true } = {}) {
  const all = orders();
  return activeOnly ? all.filter(o => !o.works.every(w => ['Оплачено', 'Отмена'].includes(w.status))) : all;
}
export function getOrder(id) { return orders().find(x => x.id.toLowerCase() === String(id).toLowerCase()); }

export function orderMargin(o) {
  return (o.works || []).filter(w => w.status !== 'Отмена')
    .reduce((s, w) => s + (Number(w.price) || 0) - (Number(w.cost) || 0), 0);
}

const rub = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
export function fmtOrder(o) {
  const works = (o.works || []).map(w =>
    `  ${w.status === 'Оплачено' ? '✅' : w.status === 'Отмена' ? '🚫' : '▫️'} ${w.type}${w.crm ? ` (СРМ ${w.crm})` : ''}: ${rub(w.price)}${w.cost ? ` (себес ${rub(w.cost)})` : ''} — ${w.status}`
  ).join('\n');
  return [
    `${o.id} · ${o.client}${o.phone ? ` (${o.phone})` : ''}`,
    `🚗 ${o.car}${o.vin ? ` · VIN ${o.vin}` : ''}`,
    o.lab ? `🏭 Лаборатория: ${o.lab}${o.lab_date ? ` ${o.lab_date}` : ''}` : '',
    works,
    `📈 Маржа по машине: ${rub(orderMargin(o))}`,
    o.notes ? `📝 ${o.notes}` : '',
  ].filter(Boolean).join('\n');
}

export function docsAlerts() {
  const act = listOrders();
  const a = [];
  for (const o of act) {
    const unpaid = o.works.filter(w => w.status === 'Выпущено');
    if (unpaid.length) a.push(`⚠️ ${o.id} ${o.client}: ${unpaid.map(w => w.type).join(', ')} выпущено, но НЕ оплачено`);
    const days = (Date.now() - Date.parse(o.updated)) / 864e5;
    if (days > 4) a.push(`⏳ ${o.id} ${o.client}: без движения ${Math.floor(days)} дн.`);
  }
  return a;
}

export function docsTotals() {
  const all = orders();
  const sum = (arr) => arr.reduce((s, o) => {
    const act = (o.works || []).filter(w => w.status !== 'Отмена');
    return {
      revenue: s.revenue + act.reduce((x, w) => x + (Number(w.price) || 0), 0),
      cost: s.cost + act.reduce((x, w) => x + (Number(w.cost) || 0), 0),
      margin: s.margin + orderMargin(o),
    };
  }, { revenue: 0, cost: 0, margin: 0 });
  return { active: sum(listOrders()), total: sum(all), count: all.length };
}

/**
 * LegalAuto — CRM направления «Документы» (СБКТС / ЭПТС / утильсбор).
 *
 * Учёт заказов: клиент, авто, услуга, стадия, деньги (цена клиенту, себестоимость,
 * доп-услуги → маржа). Нумерация по клиенту: у каждого клиента своя буква,
 * авто нумеруются внутри — А1, А2 (первый клиент), Б1 (второй клиент).
 * Хранится ТОЛЬКО на сервере Эдо (Railway Volume). Управление — Джарвис или дашборд.
 */
import { getSection, setSection, logEvent } from './stateService.js';

export const STAGES = ['новая', 'авто в лаборатории', 'документы оформляются', 'готово', 'выдано клиенту'];
export const SERVICES = ['СБКТС', 'ЭПТС', 'СБКТС+ЭПТС', 'утильсбор', 'полный пакет'];

function orders() {
  const cur = getSection('docs_orders') || {};
  return Array.isArray(cur.list) ? cur.list : [];
}
function save(list) { setSection('docs_orders', { list }); }

// У каждого клиента — своя буква (А, Б, В...). Повторный клиент = та же буква.
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

export function addOrder({ client, phone = '', car, vin = '', service = 'СБКТС+ЭПТС', price_client = 0, cost = 0, extras = [], notes = '' }) {
  const list = orders();
  const letter = clientLetter(client, list);
  const n = list.filter(o => o.id.replace(/\d+$/, '') === letter).length + 1;
  const id = `${letter}${n}`;
  const now = new Date().toISOString();
  const o = {
    id, client_key: String(client).trim().toLowerCase(), client, phone, car, vin, service,
    stage: STAGES[0], client_paid: false, lab_paid: false,
    price_client, cost, extras, notes, created: now, updated: now,
  };
  list.unshift(o); save(list);
  logEvent('docs_order_new', { note: `${id}: ${client} — ${car} (${service})` });
  return o;
}

// Маржа = (цена клиенту + доп-услуги) − себестоимость
export function orderMargin(o) {
  const extrasSum = (o.extras || []).reduce((s, e) => s + (Number(e.price) || 0), 0);
  return (Number(o.price_client) || 0) + extrasSum - (Number(o.cost) || 0);
}

export function updateOrder(id, patch = {}) {
  const list = orders();
  const o = list.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!o) return null;
  const allowed = ['stage', 'client_paid', 'lab_paid', 'price_client', 'cost', 'notes', 'vin', 'phone'];
  for (const k of allowed) if (patch[k] !== undefined) o[k] = patch[k];
  if (patch.add_extra?.name) (o.extras = o.extras || []).push({ name: patch.add_extra.name, price: Number(patch.add_extra.price) || 0 });
  o.updated = new Date().toISOString();
  save(list);
  logEvent('docs_order_upd', { note: `${o.id}: ${JSON.stringify(patch).slice(0, 100)}` });
  return o;
}

export function listOrders({ activeOnly = true } = {}) {
  const all = orders();
  return activeOnly ? all.filter(o => o.stage !== 'выдано клиенту') : all;
}

const rub = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;

export function fmtOrder(o) {
  const extras = (o.extras || []).map(e => `${e.name} ${rub(e.price)}`).join(', ');
  return [
    `${o.id} · ${o.client}${o.phone ? ` (${o.phone})` : ''}`,
    `🚗 ${o.car}${o.vin ? ` · VIN ${o.vin}` : ''}`,
    `📄 ${o.service} — стадия: ${o.stage}`,
    `💰 Клиенту: ${rub(o.price_client)}${o.client_paid ? ' ✅ оплачено' : ' ❌ не оплачено'} · Себестоимость: ${rub(o.cost)}${o.lab_paid ? ' ✅ лаб. оплачена' : ' ❌ лаб. не оплачена'}`,
    extras ? `➕ Доп: ${extras}` : '',
    `📈 Маржа: ${rub(orderMargin(o))}`,
    o.notes ? `📝 ${o.notes}` : '',
  ].filter(Boolean).join('\n');
}

// Сводка: что требует внимания
export function docsAlerts() {
  const act = listOrders();
  const a = [];
  for (const o of act) {
    if (!o.client_paid && o.stage !== 'новая') a.push(`⚠️ ${o.id} ${o.client}: авто в работе, клиент НЕ оплатил`);
    if (o.client_paid && !o.lab_paid && ['документы оформляются', 'готово'].includes(o.stage)) a.push(`⚠️ ${o.id}: лаборатория не оплачена, а документы уже в работе`);
    const days = (Date.now() - Date.parse(o.updated)) / 864e5;
    if (days > 3 && o.stage !== 'готово') a.push(`⏳ ${o.id} ${o.client}: без движения ${Math.floor(days)} дн. (${o.stage})`);
  }
  return a;
}

// Итоги по деньгам (для дашборда): выручка/себестоимость/маржа по активным и за всё время
export function docsTotals() {
  const all = orders();
  const sum = (arr) => arr.reduce((s, o) => ({
    revenue: s.revenue + (Number(o.price_client) || 0) + (o.extras || []).reduce((x, e) => x + (Number(e.price) || 0), 0),
    cost: s.cost + (Number(o.cost) || 0),
    margin: s.margin + orderMargin(o),
  }), { revenue: 0, cost: 0, margin: 0 });
  return { active: sum(listOrders()), total: sum(all), count: all.length };
}

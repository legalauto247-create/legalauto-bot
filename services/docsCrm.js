/**
 * LegalAuto — CRM направления «Документы» (СБКТС / ЭПТС / утильсбор).
 *
 * Учёт заказов: клиент, авто, услуга, стадия, оплаты (клиент → нам, мы → лаборатории).
 * Хранится в Platform State (Railway Volume). Управление — через Джарвиса или дашборд.
 */
import { getSection, setSection, logEvent } from './stateService.js';

export const STAGES = ['новая', 'авто в лаборатории', 'документы оформляются', 'готово', 'выдано клиенту'];
export const SERVICES = ['СБКТС', 'ЭПТС', 'СБКТС+ЭПТС', 'утильсбор', 'полный пакет'];

function orders() {
  const cur = getSection('docs_orders') || {};
  return Array.isArray(cur.list) ? cur.list : [];
}
function save(list) { setSection('docs_orders', { list }); }

export function addOrder({ client, phone = '', car, vin = '', service = 'СБКТС+ЭПТС', amount_client = 0, amount_lab = 0, notes = '' }) {
  const list = orders();
  const id = 'D' + String(list.length + 1).padStart(3, '0');
  const now = new Date().toISOString();
  const o = { id, client, phone, car, vin, service, stage: STAGES[0], client_paid: false, lab_paid: false, amount_client, amount_lab, notes, created: now, updated: now };
  list.unshift(o); save(list);
  logEvent('docs_order_new', { note: `${id}: ${client} — ${car} (${service})` });
  return o;
}

export function updateOrder(id, patch = {}) {
  const list = orders();
  const o = list.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!o) return null;
  const allowed = ['stage', 'client_paid', 'lab_paid', 'amount_client', 'amount_lab', 'notes', 'vin', 'phone'];
  for (const k of allowed) if (patch[k] !== undefined) o[k] = patch[k];
  if (patch.stage && !STAGES.includes(patch.stage)) o.stage = patch.stage; // свободная стадия тоже ок
  o.updated = new Date().toISOString();
  save(list);
  logEvent('docs_order_upd', { note: `${o.id}: ${JSON.stringify(patch).slice(0, 100)}` });
  return o;
}

export function listOrders({ activeOnly = true } = {}) {
  const all = orders();
  return activeOnly ? all.filter(o => o.stage !== 'выдано клиенту') : all;
}

export function fmtOrder(o) {
  return [
    `${o.id} · ${o.client}${o.phone ? ` (${o.phone})` : ''}`,
    `🚗 ${o.car}${o.vin ? ` · VIN ${o.vin}` : ''}`,
    `📄 ${o.service} — стадия: ${o.stage}`,
    `💰 Клиент: ${o.client_paid ? '✅ оплатил' : '❌ НЕ оплатил'}${o.amount_client ? ` (${Number(o.amount_client).toLocaleString('ru-RU')} ₽)` : ''} · Лаборатория: ${o.lab_paid ? '✅ оплачено' : '❌ НЕ оплачено'}${o.amount_lab ? ` (${Number(o.amount_lab).toLocaleString('ru-RU')} ₽)` : ''}`,
    o.notes ? `📝 ${o.notes}` : '',
  ].filter(Boolean).join('\n');
}

// Сводка для Джарвиса/отчёта: что требует внимания
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

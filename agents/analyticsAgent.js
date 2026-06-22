/**
 * LegalAuto — Analytics Agent
 *
 * Собирает полную статистику платформы:
 *   getStats(period)  — 'today' | 'week' | 'month' | 'all'
 *   formatReport(stats, period) — готовый текст для Telegram
 */

import fetch from 'node-fetch';
import { getSubscriptions } from './alertAgent.js';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;

// ── GAS helper ────────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return {};
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res  = await fetch(url.toString(), {
      redirect: 'follow',
      signal:   AbortSignal.timeout(15000),
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    return JSON.parse(await res.text());
  } catch { return {}; }
}

// ── Фильтр по периоду ─────────────────────────────────────────────────────────
function cutoff(period) {
  const now = Date.now();
  if (period === 'today') return now - 24 * 60 * 60 * 1000;
  if (period === 'week')  return now - 7  * 24 * 60 * 60 * 1000;
  if (period === 'month') return now - 30 * 24 * 60 * 60 * 1000;
  return 0; // all
}

function inPeriod(dateStr, period) {
  if (period === 'all') return true;
  try {
    return new Date(dateStr).getTime() >= cutoff(period);
  } catch { return false; }
}

// ── Топ N из объекта {ключ: число} ───────────────────────────────────────────
function topN(obj, n = 5) {
  return Object.entries(obj)
    .filter(([k]) => k && k !== 'undefined')
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ── Прогресс-бар текстовый ────────────────────────────────────────────────────
function bar(value, max, len = 8) {
  if (!max) return '░'.repeat(len);
  const filled = Math.round((value / max) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

// ── Основной сбор данных ──────────────────────────────────────────────────────
export async function getStats(period = 'week') {
  const [analytics, leadsData, alertsData] = await Promise.all([
    gasGet('analytics'),
    gasGet('leads'),
    gasGet('get_alerts'),
  ]);

  // ── Запчасти ──────────────────────────────────────────────────────────────
  const partsTotal     = Number(analytics.parts_total     || 0);
  const partsPublished = Number(analytics.parts_published || 0);
  const avgPrice       = Number(analytics.avg_price       || 0);
  const brands         = analytics.brands     || {};
  const categories     = analytics.categories || {};

  // ── Заявки ────────────────────────────────────────────────────────────────
  const allLeads = leadsData.leads || [];
  const leads = period === 'all' ? allLeads : allLeads.filter(l => inPeriod(l.created_at, period));

  const leadsBySource = {};
  const SOURCE_NAMES  = {
    buy_direct: '🛒 Купить запчасть',
    vin_parts:  '🔍 По VIN',
    parts:      '🔩 Подбор (AI)',
    sbkts:      '📋 СБКТС',
    epts:       '📄 ЭПТС',
    util:       '♻️ Утильсбор',
    customs:    '🛃 Таможня',
  };
  for (const l of leads) {
    const src = l.source || 'other';
    leadsBySource[src] = (leadsBySource[src] || 0) + 1;
  }

  const newLeads  = leads.filter(l => !l.status || l.status === 'new').length;
  const workLeads = leads.filter(l => l.status === 'work').length;
  const doneLeads = leads.filter(l => l.status === 'done' || l.status === 'closed').length;

  // ── Подписки на уведомления ───────────────────────────────────────────────
  const alertsFromGas = (alertsData.alerts || []).length;

  // ── Считаем потенциальную выручку (done-заявки не имеют price, используем avg)
  const revenueEst = doneLeads * avgPrice;

  return {
    period,
    parts:  { total: partsTotal, published: partsPublished, unpublished: partsTotal - partsPublished, avgPrice },
    brands:     topN(brands, 6),
    categories: topN(categories, 5),
    leads:  { total: leads.length, totalAll: allLeads.length, new: newLeads, work: workLeads, done: doneLeads, bySource: leadsBySource },
    alerts: { total: alertsFromGas },
    revenue: { estimate: revenueEst },
    sourceNames: SOURCE_NAMES,
  };
}

// ── Форматирование отчёта для Telegram ───────────────────────────────────────
export function formatReport(s, period) {
  const PERIOD_LABEL = { today: 'за сегодня', week: 'за неделю', month: 'за месяц', all: 'за всё время' };
  const label = PERIOD_LABEL[period] || '';
  const fmt   = n => Number(n || 0).toLocaleString('ru-RU');
  const msk   = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const time  = `${String(msk.getUTCHours()).padStart(2,'0')}:${String(msk.getUTCMinutes()).padStart(2,'0')} МСК`;

  // Запчасти
  const pubPct = s.parts.total ? Math.round(s.parts.published / s.parts.total * 100) : 0;
  let partsBlock =
    `📦 *Запчасти*\n` +
    `Всего: *${fmt(s.parts.total)}* | Опубликовано: *${fmt(s.parts.published)}* (${pubPct}%)\n` +
    `Ожидают: *${fmt(s.parts.unpublished)}* | Ср. цена: *${fmt(s.parts.avgPrice)} ₽*\n`;

  // Топ брендов
  if (s.brands.length) {
    const maxB = s.brands[0][1];
    partsBlock += `\n*Запчасти по маркам:*\n`;
    for (const [brand, cnt] of s.brands) {
      partsBlock += `${bar(cnt, maxB, 6)} ${brand}: ${fmt(cnt)}\n`;
    }
  }

  // Топ категорий
  if (s.categories.length) {
    partsBlock += `\n*Топ категорий:*\n`;
    for (const [cat, cnt] of s.categories.slice(0, 4)) {
      partsBlock += `  • ${cat}: ${fmt(cnt)}\n`;
    }
  }

  // Заявки
  const funnel = s.leads.total
    ? `🆕 ${s.leads.new} → 🔧 ${s.leads.work} → ✅ ${s.leads.done}`
    : 'нет заявок';

  let leadsBlock =
    `\n📋 *Заявки ${label}*\n` +
    `Всего: *${fmt(s.leads.total)}* (из ${fmt(s.leads.totalAll)} за всё время)\n` +
    `Воронка: ${funnel}\n`;

  // По источникам
  const srcEntries = Object.entries(s.leads.bySource).sort((a,b) => b[1]-a[1]);
  if (srcEntries.length) {
    leadsBlock += `\n*По источникам:*\n`;
    for (const [src, cnt] of srcEntries) {
      const name = s.sourceNames[src] || src;
      leadsBlock += `  ${name}: *${cnt}*\n`;
    }
  }

  // Подписки
  const alertsBlock = s.alerts.total > 0
    ? `\n🔔 *Подписок на уведомления:* ${s.alerts.total}\n`
    : '';

  // Выручка (оценка)
  const revenueBlock = s.revenue.estimate > 0
    ? `\n💰 *Потенц. выручка (done):* ~${fmt(s.revenue.estimate)} ₽\n`
    : '';

  return (
    `📊 *Аналитика LegalAuto* ${label}\n` +
    `🕐 ${time}\n\n` +
    partsBlock +
    leadsBlock +
    alertsBlock +
    revenueBlock
  ).trim();
}

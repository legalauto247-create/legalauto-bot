// ============================================================
// LEGAL AUTO — Market Intelligence Agent
// Аналитика рынка, поиск возможностей для заработка,
// мониторинг конкурентов, трендов и сезонности
// ============================================================

import { MARKET_KNOWLEDGE, PARTS_KNOWLEDGE, CAR_RESALE_KNOWLEDGE } from './knowledgeBase.js';
import { askClaudeOnly, businessDecision } from './dualBrainAgent.js';
import { getMemory, saveMemory } from './memoryAgent.js';

// ── Текущий месяц → сезон ────────────────────────────────────────────────
function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// ── Горячие тренды по сезону ─────────────────────────────────────────────
export function getSeasonalTrends() {
  const season   = getCurrentSeason();
  const trend    = MARKET_KNOWLEDGE.seasonal_trends[season];
  const seasonRU = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' }[season];

  return {
    season,
    seasonRU,
    trends: trend,
    recommendation: `📊 Сезон: *${seasonRU}*\n\n🔥 Актуальный спрос:\n${trend}\n\n💡 Фокус продаж на этот период.`,
  };
}

// ── Оценка возможностей по доходности ────────────────────────────────────
export function getRevenueOpportunities(sortBy = 'margin') {
  const opps = [...MARKET_KNOWLEDGE.revenue_opportunities];

  if (sortBy === 'difficulty') {
    const order = { 'низкая': 0, 'средняя': 1, 'высокая': 2 };
    opps.sort((a, b) => order[a.difficulty] - order[b.difficulty]);
  }

  return opps;
}

// ── Анализ конкурентов ────────────────────────────────────────────────────
export function getCompetitorAnalysis() {
  const competitors = MARKET_KNOWLEDGE.competitors;
  const ourAdvantages = MARKET_KNOWLEDGE.our_advantages;

  const lines = Object.entries(competitors).map(([name, info]) =>
    `• *${name}*: ✅ ${info.strengths} | ❌ ${info.weakness}`
  );

  return {
    text: `🏆 *Анализ конкурентов*\n\n${lines.join('\n')}\n\n*Наши преимущества:*\n${ourAdvantages.map(a => `✅ ${a}`).join('\n')}`,
    competitors,
    ourAdvantages,
  };
}

// ── Рейтинг запчастей по маржинальности ──────────────────────────────────
export function getTopMarginParts() {
  return [
    { part: 'Li Auto запчасти',         margin: '80-120%', reason: 'Дефицит на рынке РФ' },
    { part: 'BMW N57 турбина',           margin: '60-90%',  reason: 'Редкая б/у, высокий спрос' },
    { part: 'Mercedes АКПП 722.9',       margin: '50-80%',  reason: 'Дорогой агрегат, экономия vs новой' },
    { part: 'BMW VANOS N52',             margin: '40-70%',  reason: 'Частая поломка, нужен срочно' },
    { part: 'Пневмобаллоны W164',        margin: '40-60%',  reason: 'Оригинал дорогой, б/у с разборки выгодны' },
    { part: 'Geely Coolray запчасти',    margin: '50-80%',  reason: 'Растущий рынок, низкая конкуренция' },
    { part: 'BMW рулевая рейка E60',     margin: '30-50%',  reason: 'Массовая машина, постоянный спрос' },
    { part: 'Toyota Camry XV70 запчасти',margin: '25-40%',  reason: 'Огромный парк, стабильный спрос' },
  ];
}

// ── AI-аналитика на заданную тему ────────────────────────────────────────
export async function analyzeMarketQuestion(question) {
  const season = getCurrentSeason();
  const opportunities = getRevenueOpportunities()
    .map(o => `${o.idea}: ${o.margin}`)
    .join('\n');

  const system = `Ты бизнес-аналитик рынка автозапчастей России.
Знаешь тренды, цены, конкурентов, сезонность.

ТЕКУЩИЙ СЕЗОН: ${season}
СЕЗОННЫЙ СПРОС: ${MARKET_KNOWLEDGE.seasonal_trends[season]}

ВОЗМОЖНОСТИ ДЛЯ ЗАРАБОТКА:
${opportunities}

НАШИ КОНКУРЕНТЫ: ${Object.keys(MARKET_KNOWLEDGE.competitors).join(', ')}

Отвечай конкретно, с цифрами. Давай actionable советы.`;

  return await askClaudeOnly(system, question, 700);
}

/**
 * Ежедневный брифинг по рынку — для утренней сводки Эдо
 */
export async function getDailyMarketBrief() {
  const { seasonRU, trends } = getSeasonalTrends();
  const topParts = getTopMarginParts().slice(0, 3);
  const topOpps  = getRevenueOpportunities().slice(0, 3);

  const brief = await askClaudeOnly(
    `Ты аналитик рынка автозапчастей России. Напиши краткий утренний брифинг для владельца магазина.
Стиль: деловой, конкретный, 8-12 строк.
Сезон: ${seasonRU}, спрос: ${trends}
Топ маржинальные позиции: ${topParts.map(p => p.part).join(', ')}
Возможности: ${topOpps.map(o => o.idea).join(', ')}`,
    `Дата: ${new Date().toLocaleDateString('ru-RU')}. Составь утренний брифинг по рынку.`,
    500
  );

  return {
    date: new Date().toLocaleDateString('ru-RU'),
    season: seasonRU,
    trends,
    topParts,
    topOpportunities: topOpps,
    aiSummary: brief,
    fullText: `📊 *Утренний брифинг LegalAuto*
📅 ${new Date().toLocaleDateString('ru-RU')} | ${seasonRU}

${brief}

🔥 *Топ маржинальные позиции:*
${topParts.map(p => `• ${p.part} — маржа ${p.margin}`).join('\n')}

💡 *Возможности этой недели:*
${topOpps.map(o => `• ${o.idea}: ${o.margin}`).join('\n')}`,
  };
}

/**
 * Найти арбитражную возможность по запчасти
 * arbitrage = купи дешевле → продай дороже
 */
export async function findArbitrageOpportunity(partName) {
  const system = `Ты специалист по арбитражу на рынке автозапчастей России.
Анализируешь: разницу цен между разборками/поставщиками и рыночными ценами.
Знаешь площадки: Авито, Авто.ру, Zzap, Exist, китайские поставщики.
Давай конкретный план: где купить, почём, где продать, почём, маржа.`;

  const question = `Найди арбитражную возможность для: "${partName}".
Что это за деталь? Типичные цены закупки (разборки/Китай)? Рыночная цена продажи? Маржа?`;

  const result = await businessDecision(question, ['купить на разборке', 'заказать из Китая', 'найти у оптового поставщика']);

  return {
    part: partName,
    analysis: result.synthesis,
    recommendation: result.synthesis,
  };
}

/**
 * Быстрый анализ: стоит ли продавать конкретную модель авто?
 */
export async function analyzeCarFlip(carModel, buyPrice) {
  const similar = CAR_RESALE_KNOWLEDGE.best_cars_to_flip.find(c =>
    c.brand.toLowerCase().includes(carModel.toLowerCase().split(' ')[0].toLowerCase())
  );

  const system = `Ты эксперт по флиппингу авто в России. Оцени выгодность покупки для перепродажи.
Знаешь рынок Авто.ру и Авито. Учитываешь: стоимость подготовки, время продажи, маржу.
Наш плюс: свои запчасти = ремонт дешевле на 30-50%.`;

  const question = `Авто: ${carModel}. Цена покупки: ${buyPrice.toLocaleString('ru-RU')} ₽.
${similar ? `Схожие модели в нашей статистике: ${similar.brand} — маржа ${similar.margin}` : ''}
Стоит ли брать? Какая ожидаемая маржа? Что нужно сделать перед продажей?`;

  const answer = await askClaudeOnly(system, question, 500);

  return {
    car: carModel,
    buyPrice,
    similarStats: similar || null,
    analysis: answer,
  };
}

/**
 * Сохранить рыночное наблюдение в память бота
 */
export async function saveMarketInsight(insight) {
  try {
    const mem = getMemory();
    if (!mem.marketInsights) mem.marketInsights = [];
    mem.marketInsights.push({
      date:    new Date().toISOString(),
      insight,
    });
    // Оставляем только последние 50
    if (mem.marketInsights.length > 50) {
      mem.marketInsights = mem.marketInsights.slice(-50);
    }
    saveMemory(mem);
    return true;
  } catch {
    return false;
  }
}

export default {
  getSeasonalTrends,
  getRevenueOpportunities,
  getCompetitorAnalysis,
  getTopMarginParts,
  analyzeMarketQuestion,
  getDailyMarketBrief,
  findArbitrageOpportunity,
  analyzeCarFlip,
  saveMarketInsight,
};

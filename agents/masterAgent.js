// ============================================================
// LEGAL AUTO — Master Agent (Оркестратор)
// Принимает любой запрос → классифицирует → маршрутизирует
// к нужному агенту → возвращает результат
//
// Поддерживает запросы от:
//  • clientBot (клиентские сообщения)
//  • adminBot (команды владельца)
//  • index.js (расписание, события)
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { askClaudeOnly } from './dualBrainAgent.js';

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });

// ── Типы задач ────────────────────────────────────────────────────────────
const TASK_TYPES = {
  PARTS_SEARCH:    'parts_search',    // ищет запчасть
  PRICE_CHECK:     'price_check',     // узнать цену
  ORDER:           'order',           // оформить заказ
  SUPPORT:         'support',         // вопрос по заказу
  MARKET_POST:     'market_post',     // создать пост
  ANALYTICS:       'analytics',       // аналитика бизнеса
  ARBITRAGE:       'arbitrage',       // найти выгодную запчасть
  SALES_FOLLOWUP:  'sales_followup',  // дожать клиента
  TRENDING:        'trending',        // топ запчастей
  // ── Новые типы Jarvis-уровня ─────────────────────────────────────────
  CAR_DOC:         'car_doc',         // СБКТС, ЭПТС, оформление
  IMAGE_GEN:       'image_gen',       // генерация изображений DALL-E
  MARKET_INTEL:    'market_intel',    // аналитика рынка, тренды
  CAR_IMPORT:      'car_import',      // привоз авто из-за рубежа
  CAR_RESALE:      'car_resale',      // перепродажа / флиппинг авто
  GENERAL:         'general',         // общий вопрос
};

// ── Классификатор запроса (Claude Haiku) ─────────────────────────────────
async function classifyRequest(text) {
  try {
    const result = await askClaudeOnly(
      `Ты классификатор запросов для магазина автозапчастей.
Определи тип запроса и верни ТОЛЬКО JSON без лишнего текста.

Типы:
- parts_search: клиент ищет конкретную запчасть ("нужна фара", "где найти бампер BMW")
- price_check: спрашивает цену ("сколько стоит", "какая цена")
- order: хочет купить/заказать ("хочу заказать", "оформи заказ")
- support: вопрос по статусу/доставке ("где мой заказ", "когда доставят")
- market_post: создать пост/контент ("сделай пост", "напиши для канала")
- analytics: аналитика ("какие продажи", "топ товаров", "статистика")
- arbitrage: арбитраж ("найди дешевле", "что выгодно купить")
- sales_followup: работа с лидами ("кому написать", "кто не ответил")
- trending: тренды ("что популярно", "топ запчастей")
- car_doc: СБКТС, ЭПТС, оформление, таможня, постановка на учёт ("сбктс", "эптс", "растаможка", "птс", "поставить на учёт")
- image_gen: генерация изображения ("нарисуй", "сгенерируй фото", "сделай картинку", "изображение для поста")
- market_intel: аналитика рынка, тренды, возможности ("что сейчас популярно", "рыночный анализ", "что выгоднее", "конкуренты")
- car_import: привоз авто ("привези авто", "заказать из китая", "импорт машины", "пригнать авто")
- car_resale: перепродажа, флиппинг ("купить и продать", "флиппинг авто", "перепродажа машины")
- general: всё остальное

Формат ответа: {"type": "...", "confidence": 0.9, "keywords": ["..."]}`,
      text,
      150
    );

    const json = result?.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : { type: TASK_TYPES.GENERAL, confidence: 0.5, keywords: [] };
  } catch {
    return { type: TASK_TYPES.GENERAL, confidence: 0.5, keywords: [] };
  }
}

// ── Роутер — вызывает нужный агент ───────────────────────────────────────
async function routeToAgent(taskType, request, context = {}) {
  const { telegramId, text } = request;

  switch (taskType) {
    case TASK_TYPES.PARTS_SEARCH:
    case TASK_TYPES.PRICE_CHECK: {
      const { smartMatch } = await import('./smartMatchAgent.js');
      return await smartMatch(telegramId || 'master', text);
    }

    case TASK_TYPES.ORDER: {
      // Создаём лид и передаём в sales
      const { smartMatch } = await import('./smartMatchAgent.js');
      const matchResult = await smartMatch(telegramId || 'master', text);
      return {
        ...matchResult,
        action: 'create_order',
        message: '🛒 Заявка принята! Менеджер свяжется в течение 30 минут.',
      };
    }

    case TASK_TYPES.SUPPORT: {
      const { dualAnswer } = await import('./dualBrainAgent.js');
      return {
        found: true,
        text: await dualAnswer(text, 'Клиент спрашивает о поддержке/доставке.'),
      };
    }

    case TASK_TYPES.MARKET_POST: {
      const { generateSalesPost } = await import('./dualBrainAgent.js');
      const post = await generateSalesPost(text, context.topic || '');
      return { found: true, text: post, type: 'post' };
    }

    case TASK_TYPES.ANALYTICS: {
      const { getStats, formatReport } = await import('./analyticsAgent.js');
      const stats = await getStats(context.period || 'today');
      return { found: true, text: formatReport(stats), type: 'analytics' };
    }

    case TASK_TYPES.ARBITRAGE: {
      const { runArbitrageCheck } = await import('./arbitrageAgent.js');
      await runArbitrageCheck();
      return { found: true, data: { message: 'Арбитраж запущен, результаты отправлены менеджеру' }, type: 'arbitrage' };
    }

    case TASK_TYPES.TRENDING: {
      const { getTopBotQueries } = await import('./trendingAgent.js');
      const trending = getTopBotQueries(10);
      return { found: true, data: trending, type: 'trending' };
    }

    case TASK_TYPES.SALES_FOLLOWUP: {
      const { runFollowUp } = await import('./followUpAgent.js');
      return await runFollowUp(context.telegram);
    }

    case TASK_TYPES.CAR_DOC: {
      const { answerDocQuestion } = await import('./carDocAgent.js');
      const result = await answerDocQuestion(text);
      return { found: true, text: result.text, type: 'car_doc', source: result.source };
    }

    case TASK_TYPES.IMAGE_GEN: {
      const { generatePostImage } = await import('./imageGenAgent.js');
      const topic = text.replace(/нарисуй|сгенерируй фото|сделай картинку|изображение для поста/gi, '').trim() || text;
      const image = await generatePostImage(topic);
      return { found: true, imageUrl: image.url, type: 'image', topic };
    }

    case TASK_TYPES.MARKET_INTEL: {
      const { analyzeMarketQuestion, getSeasonalTrends } = await import('./marketIntelAgent.js');
      const [analysis, trends] = await Promise.all([
        analyzeMarketQuestion(text),
        Promise.resolve(getSeasonalTrends()),
      ]);
      return {
        found: true,
        text: `${analysis}\n\n📊 _Сезон: ${trends.seasonRU} — ${trends.trends}_`,
        type: 'market_intel',
      };
    }

    case TASK_TYPES.CAR_IMPORT: {
      const { answerDocQuestion } = await import('./carDocAgent.js');
      const result = await answerDocQuestion(text + ' привоз авто импорт');
      return { found: true, text: result.text, type: 'car_import' };
    }

    case TASK_TYPES.CAR_RESALE: {
      const { analyzeCarFlip } = await import('./marketIntelAgent.js');
      const carMatch = text.match(/(?:bmw|toyota|mercedes|geely|kia|hyundai|audi|лексус|lexus)[\s\w]*/i);
      const carModel = carMatch?.[0] || 'авто';
      const priceMatch = text.match(/(\d[\d\s]+)(?:₽|руб|тыс)/i);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, '')) * (text.includes('тыс') ? 1000 : 1) : 500000;
      const result = await analyzeCarFlip(carModel, price);
      return { found: true, text: result.analysis, type: 'car_resale' };
    }

    default: {
      // Общий вопрос — отвечает dualBrain
      const { dualAnswer } = await import('./dualBrainAgent.js');
      const answer = await dualAnswer(text);
      return { found: true, text: answer };
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ — orchestrate()
// ══════════════════════════════════════════════════════════════════════════

/**
 * Принимает запрос, определяет тип, маршрутизирует к агенту
 *
 * @param {string} text         — текст запроса
 * @param {object} options      — { telegramId, context, telegram }
 * @returns {object}            — { type, result, agentUsed, confidence }
 */
export async function orchestrate(text, options = {}) {
  const { telegramId, context = {}, telegram } = options;

  console.log(`[MasterAgent] Входящий запрос: "${text.substring(0, 80)}"`);

  // 1. Классифицируем
  const classification = await classifyRequest(text);
  const { type, confidence, keywords } = classification;
  console.log(`[MasterAgent] Тип: ${type} (уверенность: ${confidence}), ключи: ${keywords}`);

  // 2. Маршрутизируем
  let result;
  let agentUsed = type;

  try {
    result = await routeToAgent(type, { telegramId, text }, { ...context, telegram });
  } catch (err) {
    console.error(`[MasterAgent] Ошибка агента ${type}:`, err.message);
    // Fallback — отвечаем напрямую через dualBrain
    const { dualAnswer } = await import('./dualBrainAgent.js');
    const answer = await dualAnswer(text);
    result = { found: true, text: answer };
    agentUsed = 'dualBrain_fallback';
  }

  return {
    type,
    agentUsed,
    confidence,
    keywords,
    result,
  };
}

// ── Быстрое обучение — сохраняем успешные паттерны ───────────────────────
const successPatterns = new Map(); // type → count

export function reportSuccess(type) {
  successPatterns.set(type, (successPatterns.get(type) || 0) + 1);
}

export function getSuccessStats() {
  return Object.fromEntries(successPatterns);
}

// ── Периодический отчёт мастер-агента ─────────────────────────────────────
export function getMasterStatus() {
  const stats = getSuccessStats();
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return {
    totalHandled: total,
    byType: stats,
    topType: Object.entries(stats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
  };
}

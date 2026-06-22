// ============================================================
// LEGAL AUTO — Car Documentation Agent
// Сопровождение клиентов по:
//   • СБКТС (сертификация конструкции ТС)
//   • ЭПТС (электронный паспорт ТС)
//   • Таможня и привоз авто
//   • Постановка на учёт
//   • Перепродажа авто (документальное сопровождение)
// ============================================================

import { SBKTS_KNOWLEDGE, EPTS_KNOWLEDGE, CAR_IMPORT_KNOWLEDGE, CAR_RESALE_KNOWLEDGE } from './knowledgeBase.js';
import { askClaudeOnly } from './dualBrainAgent.js';

// ── Типы документальных задач ────────────────────────────────────────────
export const DOC_TASK_TYPES = {
  SBKTS:      'sbkts',
  EPTS:       'epts',
  CUSTOMS:    'customs',
  CAR_IMPORT: 'car_import',
  CAR_RESALE: 'car_resale',
  GIBDD:      'gibdd',
  GENERAL:    'general_doc',
};

// ── Определить тип запроса по тексту ─────────────────────────────────────
export function detectDocTaskType(text) {
  const t = text.toLowerCase();
  if (t.includes('сбктс') || t.includes('безопасности конструкции') || t.includes('свидетельство безопасн')) return DOC_TASK_TYPES.SBKTS;
  if (t.includes('эптс') || t.includes('электронный паспорт') || t.includes('птс')) return DOC_TASK_TYPES.EPTS;
  if (t.includes('таможн') || t.includes('растаможк') || t.includes('пошлин')) return DOC_TASK_TYPES.CUSTOMS;
  if (t.includes('привоз') || t.includes('импорт') || t.includes('заказать авто') || t.includes('пригнать')) return DOC_TASK_TYPES.CAR_IMPORT;
  if (t.includes('продать авто') || t.includes('продажу авто') || t.includes('перепродаж') || t.includes('флиппинг')) return DOC_TASK_TYPES.CAR_RESALE;
  if (t.includes('гибдд') || t.includes('постановк') || t.includes('на учёт') || t.includes('номера')) return DOC_TASK_TYPES.GIBDD;
  return DOC_TASK_TYPES.GENERAL;
}

// ── Быстрые ответы на типовые вопросы без AI ─────────────────────────────
const QUICK_ANSWERS = {
  [DOC_TASK_TYPES.SBKTS]: () => {
    const k = SBKTS_KNOWLEDGE;
    return `📋 *СБКТС — Свидетельство безопасности конструкции ТС*

${k.description}

💰 Стоимость: ${k.costs.sbkts_standard} (стандарт) / ${k.costs.sbkts_express} (экспресс)
⏱ Сроки: ${k.costs.timeline} (экспресс: ${k.costs.express})

📝 Этапы:
${k.stages.map(s => `${s.step}. ${s.name} — ${s.days}`).join('\n')}

✅ Наш сервис: ${k.our_service}

Напишите менеджеру @LegalAuto247 — всё организуем!`;
  },

  [DOC_TASK_TYPES.EPTS]: () => {
    const k = EPTS_KNOWLEDGE;
    return `📄 *ЭПТС — Электронный паспорт ТС*

${k.how_it_works}

💰 Стоимость: ${k.cost}
⏱ Срок: ${k.timeline}

📋 Документы:
${k.required_docs.map(d => `• ${d}`).join('\n')}

✅ ${k.our_service}

👉 @LegalAutoAssist_bot или @LegalAuto247`;
  },

  [DOC_TASK_TYPES.CUSTOMS]: () => {
    const k = CAR_IMPORT_KNOWLEDGE;
    return `🏛 *Таможенное оформление авто*

Основные ставки пошлин:
• До 3 лет (до 1800 куб.см): ~48% от стоимости
• 3-5 лет: 2.7 €/куб.см
• 5-7 лет: 2.7 €/куб.см
• Старше 7 лет: 5.7 €/куб.см

💡 Пример — Geely 2023, 2.0T, 25 000$:
${Object.entries(k.full_cost_example).map(([k,v]) => `• ${k}: ${v}`).join('\n')}

📞 Помогаем с таможенным оформлением — @LegalAuto247`;
  },

  [DOC_TASK_TYPES.CAR_IMPORT]: () => {
    const k = CAR_IMPORT_KNOWLEDGE;
    return `🚗 *Привоз авто из-за рубежа*

Популярные направления:
${Object.entries(k.popular_routes).map(([country, info]) =>
  `🔹 ${country.toUpperCase()}: ${info.brands.slice(0, 3).join(', ')} — ${info.transit}`
).join('\n')}

📋 Процесс (${k.stages.length} этапов):
${k.stages.map(s => `${s.step}. ${s.name}`).join(' → ')}

💰 Наша комиссия: ${k.our_margin}

✅ Работаем под ключ — от выбора авто до передачи ключей
👉 @LegalAuto247 — рассчитаем стоимость под ваш запрос`;
  },

  [DOC_TASK_TYPES.CAR_RESALE]: () => {
    const k = CAR_RESALE_KNOWLEDGE;
    return `💰 *Перепродажа авто — флиппинг*

Лучшие машины для перепродажи:
${k.best_cars_to_flip.map(c => `🔹 ${c.brand} — маржа ${c.margin}`).join('\n')}

📌 Стратегия:
${k.strategy.slice(0, 3).map(s => `• ${s}`).join('\n')}

🔍 Площадки: Авто.ру, Авито, Drom.ru

✅ Помогаем с документальным оформлением покупки/продажи
👉 @LegalAuto247`;
  },

  [DOC_TASK_TYPES.GIBDD]: () => `🚔 *Постановка на учёт в ГИБДД*

Что нужно:
• ЭПТС (или бумажный ПТС)
• СБКТС (если ввезён из-за рубежа)
• СТС (свидетельство о регистрации)
• Полис ОСАГО
• Паспорт владельца

⏱ Сроки: 1 рабочий день
💰 Госпошлина: 500 ₽ (СТС) + 1500-2000 ₽ (номера)

📍 Можно через Госуслуги (предзапись) или напрямую в ГИБДД

✅ Помогаем подготовить все документы — @LegalAuto247`,
};

/**
 * Ответить на вопрос по документам
 * Сначала пробуем быстрый ответ, потом AI
 */
export async function answerDocQuestion(question) {
  const taskType = detectDocTaskType(question);

  // Быстрый ответ если есть шаблон
  if (QUICK_ANSWERS[taskType]) {
    return {
      type: taskType,
      text: QUICK_ANSWERS[taskType](),
      source: 'template',
    };
  }

  // Иначе спрашиваем AI
  const context = `
СБКТС: ${JSON.stringify(SBKTS_KNOWLEDGE.costs)}
ЭПТС: стоимость ${EPTS_KNOWLEDGE.cost}, срок ${EPTS_KNOWLEDGE.timeline}
Привоз авто: ${JSON.stringify(CAR_IMPORT_KNOWLEDGE.stages)}
`;

  const system = `Ты эксперт по документальному оформлению автомобилей в России.
Специализация: СБКТС, ЭПТС, таможня, постановка на учёт, перепродажа авто.
Работаешь в LegalAuto. Отвечай конкретно, коротко, с ценами и сроками если знаешь.
В конце — призыв написать @LegalAuto247 для консультации.
Контекст: ${context}`;

  const answer = await askClaudeOnly(system, question, 500);

  return {
    type: taskType,
    text: answer || 'По этому вопросу лучше проконсультируйтесь с менеджером @LegalAuto247',
    source: 'ai',
  };
}

/**
 * Создать план действий для клиента по его запросу
 */
export async function buildActionPlan(clientRequest) {
  const taskType = detectDocTaskType(clientRequest);
  let knowledgeContext = '';

  switch (taskType) {
    case DOC_TASK_TYPES.SBKTS:
      knowledgeContext = JSON.stringify(SBKTS_KNOWLEDGE);
      break;
    case DOC_TASK_TYPES.CAR_IMPORT:
      knowledgeContext = JSON.stringify(CAR_IMPORT_KNOWLEDGE);
      break;
    case DOC_TASK_TYPES.CAR_RESALE:
      knowledgeContext = JSON.stringify(CAR_RESALE_KNOWLEDGE);
      break;
    default:
      knowledgeContext = `СБКТС, ЭПТС, привоз, постановка — все услуги LegalAuto`;
  }

  const system = `Ты помощник по автодокументам в LegalAuto.
На основе запроса клиента создай чёткий план действий — что делать, в каком порядке, сколько стоит, сколько займёт.
Формат: нумерованный список шагов. В конце — что мы делаем за клиента.
База знаний: ${knowledgeContext}`;

  const plan = await askClaudeOnly(system, `Клиент запрашивает: ${clientRequest}`, 600);

  return {
    type: taskType,
    plan: plan || 'Свяжитесь с менеджером @LegalAuto247 для составления плана',
  };
}

/**
 * Рассчитать примерную стоимость услуги
 */
export function estimateCost(serviceType, params = {}) {
  switch (serviceType) {
    case 'sbkts':
      return {
        min:     15000,
        max:     60000,
        express: 60000,
        note:    'Зависит от типа авто и требуемых испытаний',
      };
    case 'epts':
      return {
        min:  2000,
        max:  5000,
        note: 'Наше оформление: 3 500 ₽',
      };
    case 'car_import': {
      const carPrice = params.carPrice || 2000000;
      const customs  = Math.round(carPrice * 0.27);
      const util     = 126000;
      const sbkts    = 40000;
      const logistics = 80000;
      return {
        car_price: carPrice,
        customs,
        util_sbor: util,
        sbkts_epts: sbkts,
        logistics,
        total: carPrice + customs + util + sbkts + logistics,
        our_commission: 80000,
        note: 'Примерный расчёт. Точная сумма зависит от конкретного авто.',
      };
    }
    default:
      return { note: 'Уточните у менеджера @LegalAuto247' };
  }
}

export default {
  answerDocQuestion,
  buildActionPlan,
  estimateCost,
  detectDocTaskType,
  DOC_TASK_TYPES,
  QUICK_ANSWERS,
};

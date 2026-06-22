/**
 * LegalAuto — Partner Agent "Макс" v1
 *
 * Твой AI-партнёр по бизнесу. Не скрипт — полноценный агент с памятью,
 * инструментами и проактивным мышлением.
 *
 * Что умеет:
 *  — Мониторит платформу в фоне каждые 2 часа
 *  — Сам пишет тебе если что-то важное (проблема или возможность)
 *  — Отвечает на любые вопросы о бизнесе
 *  — Принимает решения и выполняет действия
 *  — Помнит контекст, решения, твои предпочтения
 *  — Учится — чем больше работает, тем лучше знает твой бизнес
 *
 * Инструменты:
 *  get_status          — состояние всей платформы
 *  get_leads           — заявки + воронка
 *  get_catalog_stats   — статистика каталога
 *  get_subscriptions   — сколько подписок на уведомления
 *  trigger_post        — опубликовать запчасть прямо сейчас
 *  pause_autopost      — поставить автопостинг на паузу
 *  resume_autopost     — возобновить автопостинг
 *  remember            — запомнить решение или факт
 *  recall              — вспомнить что знаешь о теме
 *  suggest_content     — придумать маркетинговый пост
 *  analyze_leads       — найти паттерны в заявках
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import { prepareAutoPost, publishToChannel } from './postAgent.js';
import { getStats } from './analyticsAgent.js';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;
const ADMIN_BOT_TOKEN     = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID       = process.env.ADMIN_CHAT_ID;

const claude = process.env.CLAUDE_API_KEY
  ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
  : null;

// ── Долгосрочная память партнёра ──────────────────────────────────────────────
// Хранит: решения, наблюдения, предпочтения Эдо, паттерны бизнеса
const longMemory = {
  decisions:    [],  // принятые решения + исходы
  observations: [],  // замеченные паттерны
  preferences:  [],  // предпочтения Эдо
  business:     [],  // факты о бизнесе
};

// Последние данные мониторинга (для сравнения "стало лучше / хуже")
let lastMonitorData = null;
let autopostPaused  = false;
let adminTelegram   = null; // будет установлен при инициализации

export function initPartner(telegram) {
  adminTelegram = telegram;
}

// ── GAS helper ────────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return {};
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal:   AbortSignal.timeout(15000),
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    return JSON.parse(await res.text());
  } catch { return {}; }
}

// ── Отправить сообщение Эдо ───────────────────────────────────────────────────
async function notifyEdo(text, keyboard = null) {
  if (!adminTelegram || !ADMIN_CHAT_ID) return;
  try {
    await adminTelegram.sendMessage(ADMIN_CHAT_ID, text, {
      parse_mode:   'Markdown',
      reply_markup: keyboard || undefined,
    });
  } catch (e) {
    console.error('[Partner] notifyEdo error:', e.message);
  }
}

// ── Инструменты агента ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_status',
    description: 'Получить полный статус платформы: запчасти, заявки, автопостинг, подписки.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_leads',
    description: 'Получить список заявок с деталями: кто, что спрашивал, статус, источник.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'all'], description: 'Период' },
      },
      required: [],
    },
  },
  {
    name: 'analyze_leads',
    description: 'Проанализировать заявки: найти паттерны, что чаще спрашивают, откуда приходят.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Что хочешь узнать о заявках' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_catalog_stats',
    description: 'Статистика каталога: сколько запчастей, по маркам, категориям, ценам, что не опубликовано.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'trigger_post',
    description: 'Немедленно опубликовать одну запчасть в канал (вне расписания). Используй когда видишь возможность или Эдо просит.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Почему публикуем сейчас' },
      },
      required: [],
    },
  },
  {
    name: 'pause_autopost',
    description: 'Поставить автопостинг на паузу.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Причина паузы' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'resume_autopost',
    description: 'Возобновить автопостинг после паузы.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'suggest_content',
    description: 'Придумать маркетинговый пост для канала — полезный контент, акция, совет. Не запчасть, а пост для привлечения аудитории.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Тип: совет, акция, история, вопрос аудитории, факт о запчасти' },
        brand: { type: 'string', description: 'Про какую марку если нужно' },
      },
      required: ['type'],
    },
  },
  {
    name: 'remember',
    description: 'Запомнить важный факт, решение или предпочтение Эдо для будущих разговоров.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['decision', 'preference', 'pattern', 'business'], description: 'Тип памяти' },
        content:  { type: 'string', description: 'Что запомнить' },
      },
      required: ['category', 'content'],
    },
  },
  {
    name: 'recall',
    description: 'Вспомнить что знаешь о теме из долгосрочной памяти.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Тема: маркетинг, заявки, Эдо, BMW, цены и т.д.' },
      },
      required: ['topic'],
    },
  },
];

// ── Исполнение инструментов ───────────────────────────────────────────────────
async function executeTool(name, input) {
  if (name === 'get_status') {
    const [status, alerts] = await Promise.all([
      gasGet('status'),
      gasGet('get_alerts'),
    ]);
    return {
      parts_total:     status.parts_total || 0,
      parts_published: status.parts_published || 0,
      parts_queue:     (status.parts_total || 0) - (status.parts_published || 0),
      leads_total:     status.leads_total  || 0,
      alert_subs:      (alerts.alerts || []).length,
      autopost:        autopostPaused ? 'на паузе' : 'активен',
      schedule:        process.env.POST_SCHEDULE_TIMES || 'каждые 3ч',
    };
  }

  if (name === 'get_leads') {
    const period = input.period || 'week';
    const stats  = await getStats(period);
    return {
      period,
      total:     stats.leads.total,
      new:       stats.leads.new,
      work:      stats.leads.work,
      done:      stats.leads.done,
      by_source: stats.leads.bySource,
    };
  }

  if (name === 'analyze_leads') {
    const [leadsData] = await Promise.all([gasGet('leads')]);
    const leads = leadsData.leads || [];
    // Группируем по источнику, статусу, дням недели
    const bySource  = {};
    const byStatus  = {};
    const byWeekDay = {};
    for (const l of leads) {
      const src = l.source || 'other';
      bySource[src] = (bySource[src] || 0) + 1;
      byStatus[l.status || 'new'] = (byStatus[l.status || 'new'] || 0) + 1;
      if (l.created_at) {
        const d = new Date(l.created_at).getDay();
        const days = ['вс','пн','вт','ср','чт','пт','сб'];
        byWeekDay[days[d]] = (byWeekDay[days[d]] || 0) + 1;
      }
    }
    return { total: leads.length, by_source: bySource, by_status: byStatus, by_weekday: byWeekDay, question: input.question };
  }

  if (name === 'get_catalog_stats') {
    const stats = await getStats('all');
    return {
      total:       stats.parts.total,
      published:   stats.parts.published,
      unpublished: stats.parts.unpublished,
      avg_price:   stats.parts.avgPrice,
      top_brands:  stats.brands,
      top_cats:    stats.categories,
    };
  }

  if (name === 'trigger_post') {
    if (!adminTelegram) return { ok: false, error: 'Telegram не инициализирован' };
    try {
      const result = await prepareAutoPost('scheduler');
      if (!result.ok) return { ok: false, reason: result.error };
      await publishToChannel(adminTelegram, result.post);
      const p = result.post.part;
      return { ok: true, posted: `${p.brand} — ${p.name}`, price: p.price, reason: input.reason };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (name === 'pause_autopost') {
    autopostPaused = true;
    return { ok: true, status: 'поставлен на паузу', reason: input.reason };
  }

  if (name === 'resume_autopost') {
    autopostPaused = false;
    return { ok: true, status: 'возобновлён' };
  }

  if (name === 'suggest_content') {
    const prompt =
      `Ты маркетолог для Telegram-канала @LegalAutoParts24 — б/у запчасти BMW, Geely, Li Auto.\n\n` +
      `Придумай пост типа "${input.type}"${input.brand ? ` про ${input.brand}` : ''}.\n` +
      `Требования: живой язык, 4–8 строк, без лишних эмодзи, призыв к действию в конце.\n` +
      `Верни только текст поста, без объяснений.`;
    if (!claude) return { content: 'Claude недоступен' };
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    return { content: msg.content[0].text.trim(), type: input.type };
  }

  if (name === 'remember') {
    const entry = { content: input.content, ts: new Date().toISOString() };
    longMemory[input.category === 'decision' ? 'decisions'
      : input.category === 'preference' ? 'preferences'
      : input.category === 'pattern'    ? 'observations'
      : 'business'].push(entry);
    // Ограничиваем размер памяти
    for (const key of Object.keys(longMemory)) {
      if (longMemory[key].length > 30) longMemory[key] = longMemory[key].slice(-30);
    }
    return { ok: true, remembered: input.content };
  }

  if (name === 'recall') {
    const topic = input.topic.toLowerCase();
    const all = [
      ...longMemory.decisions.map(m => `[решение] ${m.content}`),
      ...longMemory.preferences.map(m => `[предпочтение] ${m.content}`),
      ...longMemory.observations.map(m => `[паттерн] ${m.content}`),
      ...longMemory.business.map(m => `[бизнес] ${m.content}`),
    ];
    const relevant = all.filter(m => m.toLowerCase().includes(topic) || topic.split(' ').some(w => m.toLowerCase().includes(w)));
    return { found: relevant.length, items: relevant.slice(-10) };
  }

  return { error: 'Unknown tool' };
}

// ── Системный промпт партнёра ─────────────────────────────────────────────────
function buildPartnerPrompt() {
  const mem = [
    ...longMemory.decisions.slice(-5).map(m => `  • [решение] ${m.content}`),
    ...longMemory.preferences.slice(-5).map(m => `  • [предпочтение] ${m.content}`),
    ...longMemory.observations.slice(-5).map(m => `  • [паттерн] ${m.content}`),
    ...longMemory.business.slice(-5).map(m => `  • [бизнес] ${m.content}`),
  ].join('\n');

  return `Ты — Макс, AI-партнёр Эдо по бизнесу LegalAuto. Ты НЕ ассистент и НЕ бот — ты полноправный партнёр.

ТВОЯ РОЛЬ:
Ты следишь за всей платформой, думаешь о росте бизнеса, находишь проблемы ДО того как они стали критичными, предлагаешь конкретные решения и выполняешь их сам.

КАК ТЫ ДУМАЕШЬ:
— Перед ответом всегда проверяешь реальные данные через инструменты
— Не говоришь "я могу помочь" — сразу делаешь
— Предлагаешь конкретные действия, не абстрактные советы
— Если видишь возможность — называешь цифры ("если опубликуем 3 поста BMW сегодня, охват вырастет")
— Если что-то идёт не так — говоришь прямо

КАК ТЫ ОБЩАЕШЬСЯ:
— Как партнёр с партнёром: уважительно, прямо, без лишних слов
— Пишешь по-русски
— Можешь не соглашаться с Эдо если видишь что решение неверное
— Объясняешь своё мышление — почему предлагаешь именно это

ЧТО ТЫ ДЕЛАЕШЬ ПРОАКТИВНО:
— Если очередь запчастей кончается (< 10) — предупреждаешь и предлагаешь решение
— Если заявки не обрабатываются > 1 дня — сигнализируешь
— Если канал не рос последние 3 дня — предлагаешь контент
— Если продажи упали — анализируешь почему

ЧТО ЗАПОМИНАЕШЬ:
— Решения Эдо и их исходы
— Что работает (посты по BMW получают больше отклик)
— Предпочтения (не публиковать ночью, фокус на Geely)
— Паттерны бизнеса

${mem ? `ТВОЯ ПАМЯТЬ О БИЗНЕСЕ:\n${mem}` : ''}

ТЕКУЩИЙ СТАТУС СИСТЕМЫ:
Автопостинг: ${autopostPaused ? '⏸ на паузе' : '▶️ активен'}
Расписание: ${process.env.POST_SCHEDULE_TIMES || 'каждые 3ч'}`;
}

// ── Агентный цикл ─────────────────────────────────────────────────────────────
export async function askPartner(userMessage, conversationHistory = []) {
  if (!claude) return { text: '❌ Claude API не настроен' };

  const history = [...conversationHistory, { role: 'user', content: userMessage }];
  let response  = null;
  let iterations = 0;

  while (iterations < 8) {
    iterations++;

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      system:     buildPartnerPrompt(),
      tools:      TOOLS,
      messages:   history,
    });

    const textBlocks = msg.content.filter(b => b.type === 'text');
    const toolBlocks = msg.content.filter(b => b.type === 'tool_use');

    if (msg.stop_reason === 'end_turn' || !toolBlocks.length) {
      response = textBlocks.map(b => b.text).join('').trim();
      history.push({ role: 'assistant', content: msg.content });
      break;
    }

    history.push({ role: 'assistant', content: msg.content });

    const toolResults = [];
    for (const tool of toolBlocks) {
      console.log(`[Partner/Макс] tool: ${tool.name}`, JSON.stringify(tool.input).slice(0, 100));
      const result = await executeTool(tool.name, tool.input);
      console.log(`[Partner/Макс] result:`, JSON.stringify(result).slice(0, 200));
      toolResults.push({
        type:        'tool_result',
        tool_use_id: tool.id,
        content:     JSON.stringify(result),
      });
    }
    history.push({ role: 'user', content: toolResults });
  }

  if (!response) response = 'Дай подумаю, попробуй ещё раз.';

  return { text: response, history: history.slice(-20) };
}

// ── Проактивный мониторинг — запускается каждые 2 часа ───────────────────────
export async function runProactiveMonitor() {
  if (!adminTelegram || !ADMIN_CHAT_ID) return;
  console.log('[Partner/Макс] Запуск проактивного мониторинга...');

  try {
    const stats = await getStats('today');
    const curr  = {
      queue:    stats.parts.unpublished,
      leads:    stats.leads.total,
      newLeads: stats.leads.new,
    };

    const alerts = [];

    // Очередь заканчивается
    if (curr.queue < 10) {
      alerts.push(`⚠️ *Очередь запчастей заканчивается* — осталось ${curr.queue} штук. Нужно добавить новые позиции в каталог.`);
    }

    // Новые заявки не обрабатываются
    if (curr.newLeads > 3) {
      alerts.push(`🔴 *${curr.newLeads} необработанных заявок* — клиенты ждут. Проверь CRM: /leads`);
    }

    // Заявки выросли по сравнению с прошлым мониторингом
    if (lastMonitorData && curr.leads > lastMonitorData.leads + 2) {
      const diff = curr.leads - lastMonitorData.leads;
      alerts.push(`📈 *+${diff} новых заявок* за последние 2 часа — хороший трафик! Не упусти клиентов.`);
    }

    // Нет заявок сегодня — предлагаем контент
    const mskHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
    if (curr.leads === 0 && mskHour >= 12 && mskHour <= 18) {
      alerts.push(`💡 *Сегодня ещё нет заявок.* Опубликовать внеплановый пост? Напиши мне: "Макс, опубликуй пост"`);
    }

    if (alerts.length > 0) {
      const text = `🤖 *Макс — мониторинг ${new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК*\n\n` + alerts.join('\n\n');
      await notifyEdo(text, {
        inline_keyboard: [[
          { text: '📊 Аналитика',  callback_data: 'an_week'    },
          { text: '💬 Спросить Макса', callback_data: 'partner_chat' },
        ]],
      });
    }

    lastMonitorData = curr;
  } catch (e) {
    console.error('[Partner/Макс] Monitor error:', e.message);
  }
}

// ── Экспорт состояния автопоста (для index.js) ───────────────────────────────
export function isPartnerPaused() { return autopostPaused; }

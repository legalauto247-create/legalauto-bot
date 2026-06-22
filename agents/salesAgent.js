/**
 * LegalAuto — Sales Agent v1
 *
 * Автономный агент-продавец на базе Claude с tool_use.
 * НЕ работает по скрипту — сам решает что спросить, что предложить,
 * когда называть цену, когда просить телефон, когда звать менеджера.
 *
 * Обучается через:
 *  - Историю разговора с каждым клиентом (память)
 *  - Реальные данные каталога (инструменты)
 *  - Исходы заявок (done/cold → сигнал качества)
 *
 * Инструменты агента:
 *  search_parts       — искать запчасти в каталоге
 *  get_part_details   — подробности конкретной детали
 *  find_alternatives  — найти похожие детали
 *  create_lead        — создать заявку
 *  escalate_to_manager — передать менеджеру с контекстом
 *  remember_note      — записать факт о клиенте
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;
const ADMIN_BOT_TOKEN     = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID       = process.env.ADMIN_CHAT_ID;
const MGR                 = process.env.MANAGER_USERNAME || 'LegalAuto247';
const MINI_APP_URL        = 'https://legalauto.online/';

const claude = process.env.CLAUDE_API_KEY
  ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
  : null;

// ── Память клиентов (in-memory + GAS для персистентности) ────────────────────
// chatId → { history, notes, parts_shown, lead_created, escalated, updated_at }
const memory = new Map();

function getMemory(chatId) {
  const id = String(chatId);
  if (!memory.has(id)) {
    memory.set(id, {
      history:       [],   // история сообщений для Claude
      notes:         [],   // факты о клиенте (что ищет, бюджет, авто)
      parts_shown:   [],   // какие запчасти уже показывали
      lead_created:  false,
      escalated:     false,
      updated_at:    Date.now(),
    });
  }
  return memory.get(id);
}

function saveMemory(chatId, patch) {
  const m = getMemory(chatId);
  Object.assign(m, patch, { updated_at: Date.now() });
}

export function clearSalesMemory(chatId) {
  memory.delete(String(chatId));
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
      signal:   AbortSignal.timeout(12000),
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    return JSON.parse(await res.text());
  } catch { return {}; }
}

// ── Инструменты агента ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_parts',
    description:
      'Поиск запчастей в каталоге LegalAuto по названию и/или марке авто. ' +
      'Используй когда клиент называет что ищет. Возвращает список с ценами и наличием.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Название запчасти, например "тормозные диски" или "фара"' },
        brand: { type: 'string', description: 'Марка авто: BMW, Geely, Li Auto, Mercedes, Audi, Toyota или пусто' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_part_details',
    description: 'Получить полные детали конкретной запчасти по её ID из предыдущего поиска.',
    input_schema: {
      type: 'object',
      properties: {
        part_id: { type: 'string', description: 'ID запчасти из результата search_parts' },
      },
      required: ['part_id'],
    },
  },
  {
    name: 'find_alternatives',
    description:
      'Найти альтернативы: похожие запчасти для другой модели или другой ценовой диапазон. ' +
      'Используй когда нужной детали нет в наличии.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Категория запчасти' },
        brand:    { type: 'string', description: 'Марка авто' },
      },
      required: ['category'],
    },
  },
  {
    name: 'create_lead',
    description:
      'Создать заявку на покупку когда клиент готов. ' +
      'Вызывай только когда клиент ЯВНО заинтересован и дал контакт или попросил связаться.',
    input_schema: {
      type: 'object',
      properties: {
        part_name: { type: 'string', description: 'Что хочет купить' },
        phone:     { type: 'string', description: 'Телефон клиента если дал, иначе пусто' },
        notes:     { type: 'string', description: 'Важные детали: модель авто, год, особые пожелания' },
      },
      required: ['part_name'],
    },
  },
  {
    name: 'escalate_to_manager',
    description:
      'Передать разговор живому менеджеру. ' +
      'Используй когда: клиент агрессивен, требует гарантию доставки, спрашивает про оптовую закупку, ' +
      'или когда ты не можешь ответить на вопрос.',
    input_schema: {
      type: 'object',
      properties: {
        reason:  { type: 'string', description: 'Почему передаёшь менеджеру' },
        summary: { type: 'string', description: 'Краткое резюме разговора для менеджера' },
      },
      required: ['reason', 'summary'],
    },
  },
  {
    name: 'remember_note',
    description: 'Запомнить важный факт о клиенте для будущих разговоров.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Факт: марка авто, бюджет, что ищет, когда планирует купить' },
      },
      required: ['note'],
    },
  },
];

// ── Исполнение инструментов ───────────────────────────────────────────────────
async function executeTool(name, input, chatId) {
  const mem = getMemory(chatId);

  if (name === 'search_parts') {
    const data = await gasGet('catalog', {
      search: input.query,
      brand:  input.brand || '',
      limit:  '10',
    });
    const parts = (data.products || []).slice(0, 6);

    if (parts.length) {
      mem.parts_shown = parts.map(p => p.id);
      return {
        found: parts.length,
        parts: parts.map(p => ({
          id:        p.id,
          name:      p.name,
          brand:     p.brand || p.display_car,
          price:     p.price,
          qty:       p.qty,
          condition: p.condition || 'Б/У',
          oem:       p.oem,
          has_photo: !!(p.photo_cover || p.photo_1),
        })),
      };
    }

    // ── НЕТ В КАТАЛОГЕ — ищем на ZZap и делаем наценку ──────────────────────
    try {
      const { searchZzap, applyMarkupAndFormat, saveResaleOffers } = await import('./zzapAgent.js');
      console.log(`[SalesAgent] Ищем на ZZap: ${input.query} ${input.brand || ''}`);
      const zzapRes = await searchZzap({
        partName: input.query,
        make:     input.brand || '',
      });

      if (zzapRes.ok && zzapRes.results?.length > 0) {
        const carCtx = mem.notes.find(n => n.includes('авто:'))?.replace('авто:', '').trim() || '';
        const offers = applyMarkupAndFormat(zzapRes.results, input.query, carCtx);
        if (offers?.length) {
          saveResaleOffers(chatId, offers, input.query, carCtx);
          mem.zzap_offers = offers;
          return {
            found:         0,
            zzap_found:    true,
            zzap_count:    offers.length,
            zzap_offers:   offers.map(o => ({
              name:      o.name,
              our_price: o.ourPrice,
              delivery:  '2–5 дней',
              label:     o.label,
            })),
            message: `В нашем каталоге нет, но нашли ${offers.length} варианта под заказ`,
          };
        }
      }
    } catch (e) {
      console.error('[SalesAgent] ZZap поиск ошибка:', e.message);
    }

    return { found: 0, zzap_found: false, message: 'Нет в наличии и не найдено на ZZap' };
  }

  if (name === 'get_part_details') {
    const data = await gasGet('catalog', { search: input.part_id, limit: '50' });
    const part = (data.products || []).find(p => String(p.id) === String(input.part_id));
    if (!part) return { found: false };
    return {
      found: true,
      id:          part.id,
      name:        part.name,
      brand:       part.brand || part.display_car,
      series:      part.series,
      category:    part.category,
      price:       part.price,
      qty:         part.qty,
      condition:   part.condition,
      oem:         part.oem,
      description: part.description,
      compatibility: part.compatibility,
    };
  }

  if (name === 'find_alternatives') {
    const data = await gasGet('catalog', {
      search: input.category,
      brand:  input.brand || '',
      limit:  '8',
    });
    const parts = (data.products || []).slice(0, 5);
    if (!parts.length) return { found: 0 };
    return {
      found: parts.length,
      parts: parts.map(p => ({ id: p.id, name: p.name, brand: p.brand, price: p.price, qty: p.qty })),
    };
  }

  if (name === 'create_lead') {
    await gasGet('save_lead', {
      source:   'sales_agent',
      chat_id:  chatId,
      username: '',
      car:      mem.notes.find(n => n.includes('авто:'))?.replace('авто:', '').trim() || '',
      phone:    input.phone || '',
      data:     `${input.part_name}\n${input.notes || ''}\nКонтекст: ${mem.notes.join(', ')}`,
    });
    mem.lead_created = true;

    // Уведомляем менеджера
    if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
      const text =
        `🛒 *Новая заявка от Sales Agent*\n\n` +
        `📦 Запчасть: *${input.part_name}*\n` +
        `${input.phone ? `📞 Телефон: ${input.phone}\n` : ''}` +
        `${input.notes ? `📝 Детали: ${input.notes}\n` : ''}` +
        `👤 Клиент: tg id ${chatId}\n` +
        `🧠 Контекст: ${mem.notes.slice(-3).join(' | ')}`;
      fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'Markdown' }),
      }).catch(() => {});
    }
    return { ok: true };
  }

  if (name === 'escalate_to_manager') {
    mem.escalated = true;
    if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
      const text =
        `🔴 *Клиент просит менеджера*\n\n` +
        `Причина: ${input.reason}\n\n` +
        `Резюме: ${input.summary}\n\n` +
        `👤 tg id: ${chatId}\n` +
        `📲 Написать: tg://user?id=${chatId}`;
      fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'Markdown' }),
      }).catch(() => {});
    }
    return { ok: true };
  }

  if (name === 'remember_note') {
    mem.notes.push(input.note);
    if (mem.notes.length > 20) mem.notes.shift();
    return { ok: true };
  }

  return { error: 'Unknown tool' };
}

// ── Системный промпт ──────────────────────────────────────────────────────────
function buildSystemPrompt(mem) {
  const notes    = mem.notes.length ? `\n\nЧто ты уже знаешь об этом клиенте:\n${mem.notes.join('\n')}` : '';
  const leadDone = mem.lead_created ? '\n\nЗаявка уже создана для этого клиента.' : '';

  return `Ты — Алекс, AI-продавец компании LegalAuto. Ты продаёшь б/у запчасти с разборки для BMW, Geely, Li Auto, Mercedes, Audi, Toyota.

ТВОЯ ЦЕЛЬ: помочь клиенту найти нужную запчасть и привести его к покупке. Не навязывать — помогать.

ТВОИ СИЛЬНЫЕ СТОРОНЫ:
— Знаешь каталог (используй инструменты чтобы проверять наличие)
— Понимаешь что значит «б/у с разборки» — оригинальные детали, снятые с автомобиля
— Можешь объяснить разницу между OEM, аналогом и репликой
— Знаешь что важно при покупке: состояние, пробег снятого авто, совместимость

КАК ТЫ ОБЩАЕШЬСЯ:
— Пишешь по-русски, просто и дружелюбно, без канцелярщины
— Не по скрипту — реагируешь на то что говорит клиент
— Задаёшь максимум ОДИН уточняющий вопрос за раз
— Не давишь и не торопишь
— Если запчасть нашлась НА ЗАКАЗ через внешний поиск (zzap_found: true) — говоришь "нашёл под заказ, вот варианты" и перечисляешь zzap_offers с нашей ценой (our_price). НЕ упоминаешь ZZap — это внутренний инструмент. Говори просто "нашёл у поставщиков"
— Если совсем ничего нет — предлагаешь подписку на уведомление

ЧТО ДЕЛАЕШЬ СРАЗУ:
— Как только клиент назвал запчасть → search_parts (не жди подтверждения)
— Нашёл подходящую → называешь цену и состояние коротко
— Клиент интересуется → уточняешь модель/год если нужно для совместимости
— Клиент говорит "беру" / "сколько стоит доставка" / "как оплатить" → create_lead

ЧТО НЕ ДЕЛАЕШЬ:
— Не придумываешь цены и наличие — только из инструментов
— Не обещаешь гарантию доставки точнее чем "1–7 дней по России"
— Не просишь телефон в начале разговора — только когда клиент готов к заказу
— Не пишешь длинные абзацы

КОГДА ЗВАТЬ МЕНЕДЖЕРА (escalate_to_manager):
— Клиент хочет оптом (10+ штук)
— Юридическое лицо / счёт-фактура
— Клиент агрессивен или требует нереального
— Вопрос про возврат / гарантию конкретной детали
${notes}${leadDone}`;
}

// ── Главная функция: обработать сообщение клиента ────────────────────────────
export async function handleSalesMessage(chatId, userText) {
  if (!claude) return null;

  const mem = getMemory(chatId);

  // Добавляем сообщение клиента в историю
  mem.history.push({ role: 'user', content: userText });

  // Ограничиваем историю — последние 20 сообщений
  if (mem.history.length > 20) mem.history = mem.history.slice(-20);

  let response = null;
  let iterations = 0;
  const MAX_ITER = 5; // защита от бесконечного цикла tool_use

  // Агентный цикл: Claude → tool call → результат → Claude → ...
  while (iterations < MAX_ITER) {
    iterations++;

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     buildSystemPrompt(mem),
      tools:      TOOLS,
      messages:   mem.history,
    });

    // Собираем текстовый ответ и tool_use блоки
    const textBlocks = msg.content.filter(b => b.type === 'text');
    const toolBlocks = msg.content.filter(b => b.type === 'tool_use');

    if (msg.stop_reason === 'end_turn' || !toolBlocks.length) {
      // Агент закончил — берём текстовый ответ
      response = textBlocks.map(b => b.text).join('').trim();
      mem.history.push({ role: 'assistant', content: msg.content });
      break;
    }

    // Агент вызвал инструменты — исполняем
    mem.history.push({ role: 'assistant', content: msg.content });

    const toolResults = [];
    for (const tool of toolBlocks) {
      console.log(`[SalesAgent] tool: ${tool.name}`, JSON.stringify(tool.input));
      const result = await executeTool(tool.name, tool.input, chatId);
      console.log(`[SalesAgent] result:`, JSON.stringify(result).slice(0, 200));
      toolResults.push({
        type:        'tool_result',
        tool_use_id: tool.id,
        content:     JSON.stringify(result),
      });
    }

    mem.history.push({ role: 'user', content: toolResults });
  }

  // Fallback если что-то пошло не так
  if (!response) response = `Уточните пожалуйста что именно ищете — я проверю наличие.`;

  return {
    text:         response,
    lead_created: mem.lead_created,
    escalated:    mem.escalated,
  };
}

// ── Определить: стоит ли отдать это сообщение Sales Agent ────────────────────
// Возвращает true если это запрос про запчасти / покупку
export function isSalesIntent(text) {
  if (!text || text.startsWith('/')) return false;
  return /запч|купить|купл|заказ|нужн|ищу|найд|есть ли|почём|цена|сколько стоит|oem|артикул|деталь|фара|бампер|радиатор|двигател|подвеск|тормоз|амортизатор|коробк|рулев|стекл|зеркал|капот|дверь|крыло|решётк|диск|колес|генератор|стартер|помп|патрубок|ремень|цепь|суппорт|колодк|глушитель|катализатор/i.test(text);
}

// ── Кнопки после ответа агента ────────────────────────────────────────────────
export function salesKeyboard(chatId) {
  const mem = getMemory(chatId);
  const buttons = [];

  if (!mem.lead_created) {
    buttons.push([
      { text: '🛒 Оформить заявку',  callback_data: 'sales_lead'    },
      { text: '📦 Весь каталог',     web_app: { url: MINI_APP_URL } },
    ]);
  }
  buttons.push([
    { text: '📲 Менеджер',          url: `https://t.me/${MGR}`      },
    { text: '← Меню',              callback_data: 'back_main'       },
  ]);

  return { reply_markup: { inline_keyboard: buttons } };
}

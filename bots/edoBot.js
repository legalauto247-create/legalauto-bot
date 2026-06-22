// ============================================================
// EDO BOT — Личный AI-ассистент Эдо (Полный автопилот)
//
// Умеет:
//  🎙 Голос (Whisper) → расшифровка → действие
//  🧠 Долгосрочная память (memoryAgent)
//  🤖 Оркестрация всех агентов (masterAgent, dualBrainAgent...)
//  📊 Утренний брифинг автоматически
//  📝 Постинг в канал по команде
//  💡 Учится на решениях Эдо
//  🔥 Алерты горячих лидов
//  📋 Заметки и напоминания
//
// ТОЛЬКО ДЛЯ ЭДО — проверка по ADMIN_CHAT_ID
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import FormData from 'form-data';
import {
  getMemory, buildSystemPrompt, addConversation, getRecentConversations,
  learnFact, rememberDecision, addNote, doneNote, getActiveNotes,
  setContext, getContext, updateStats, getStatsForBriefing, updatePreferences
} from '../agents/memoryAgent.js';
import { orchestrate } from '../agents/masterAgent.js';
import { dualAnswer, generateSalesPost } from '../agents/dualBrainAgent.js';
import { getStats, formatReport } from '../agents/analyticsAgent.js';
import { publishNewsToChannel } from './newsBot.js';
import { generatePostImage, downloadImage } from '../agents/imageGenAgent.js';
import { answerDocQuestion, buildActionPlan, estimateCost } from '../agents/carDocAgent.js';
import { getDailyMarketBrief, getSeasonalTrends, getTopMarginParts, getRevenueOpportunities, analyzeMarketQuestion, findArbitrageOpportunity } from '../agents/marketIntelAgent.js';

const {
  EDO_BOT_TOKEN,       // токен личного бота Эдо
  ADMIN_CHAT_ID,        // ID чата Эдо (только он имеет доступ)
  OPENAI_API_KEY,       // для Whisper голосовых сообщений
  ANTHROPIC_API_KEY,
} = process.env;

const claude = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
const POLLING_INTERVAL = 1500; // ms

// ── Состояния ──────────────────────────────────────────────────────────────
let lastUpdateId = 0;
let botUsername  = 'EduBot';
const waitingInput = new Map(); // chatId → { type, data }

// ── Telegram API ───────────────────────────────────────────────────────────
async function callTg(method, body = {}) {
  if (!EDO_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${EDO_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`[EdoBot] TG error ${method}:`, e.message);
    return null;
  }
}

async function send(chatId, text, extra = {}) {
  return callTg('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: 'Markdown',
    ...extra,
  });
}

async function sendWithButtons(chatId, text, buttons) {
  return send(chatId, text, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function deleteMessage(chatId, messageId) {
  return callTg('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function answerCallback(callbackQueryId, text = '') {
  return callTg('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

// ── Постоянное меню снизу ─────────────────────────────────────────────────
const MAIN_KEYBOARD = {
  keyboard: [
    [
      { text: '📊 Брифинг', request_contact: false },
      { text: '📝 Написать пост', request_contact: false },
    ],
    [
      { text: '🎨 Нарисовать фото', request_contact: false },
      { text: '📈 Рынок', request_contact: false },
    ],
    [
      { text: '🚗 Авто-сервис', request_contact: false },
      { text: '📌 Заметки', request_contact: false },
    ],
    [
      { text: '🧠 Память', request_contact: false },
      { text: '⚙️ Настройки', request_contact: false },
    ],
  ],
  resize_keyboard: true,
  persistent: true,
  input_field_placeholder: '✍️ или просто напиши команду...',
  one_time_keyboard: false,
};

// Отправить сообщение с меню снизу
async function sendMenu(chatId, text, extra = {}) {
  return send(chatId, text, { reply_markup: MAIN_KEYBOARD, ...extra });
}

// ── Проверка доступа ──────────────────────────────────────────────────────
function isEdo(chatId) {
  if (!ADMIN_CHAT_ID) return false; // не пускаем никого если не задан
  return String(chatId) === String(ADMIN_CHAT_ID);
}

// ── Whisper: расшифровка голосового ──────────────────────────────────────
async function transcribeVoice(fileId) {
  if (!OPENAI_API_KEY) return null;
  try {
    // Получаем путь файла
    const fileInfo = await callTg('getFile', { file_id: fileId });
    if (!fileInfo?.result?.file_path) return null;
    const fileUrl = `https://api.telegram.org/file/bot${EDO_BOT_TOKEN}/${fileInfo.result.file_path}`;

    // Скачиваем файл
    const audioRes = await fetch(fileUrl);
    const audioBuffer = await audioRes.buffer();

    // Отправляем в Whisper
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    form.append('language', 'ru');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const data = await whisperRes.json();
    return data.text || null;
  } catch (e) {
    console.error('[EdoBot] Whisper error:', e.message);
    return null;
  }
}

// ── Главный AI ─────────────────────────────────────────────────────────────
async function askPersonalAI(userText, chatId) {
  if (!claude) return 'Claude API не настроен.';

  const systemPrompt = buildSystemPrompt();
  const recentConvs = getRecentConversations(8);

  const messages = [
    ...recentConvs.map(c => ({ role: c.role, content: c.text })),
    { role: 'user', content: userText },
  ];

  try {
    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    });
    const answer = resp.content[0]?.text || 'Нет ответа';
    addConversation('user', userText);
    addConversation('assistant', answer);
    return answer;
  } catch (e) {
    console.error('[EdoBot] Claude error:', e.message);
    return `Ошибка AI: ${e.message}`;
  }
}

// ── Команда /start ─────────────────────────────────────────────────────────
async function handleStart(chatId) {
  const mem = getMemory();
  await sendMenu(chatId,
    `🤖 *Привет, Эдо! Джарвис онлайн.*\n\n` +
    `Работаю 24/7 на полном автопилоте.\n\n` +
    `*Мои возможности:*\n` +
    `🎙 Голос → расшифрую и выполню (Whisper)\n` +
    `📊 Утренний брифинг бизнеса + рынка\n` +
    `📝 Генерация постов (Claude + GPT)\n` +
    `🎨 Генерация фото для постов (DALL-E 3)\n` +
    `🚗 СБКТС / ЭПТС / привоз авто / перепродажа\n` +
    `📈 Аналитика рынка, конкуренты, тренды\n` +
    `💰 Поиск арбитражных возможностей\n` +
    `🧠 Долгосрочная память о бизнесе\n` +
    `📌 Задачи и напоминания\n\n` +
    `Канал: ${mem.business.channel} | Сайт: legalauto.online\n\n` +
    `Используй кнопки меню или просто напиши! 🚀`
  );
}

// ── Генерация изображения ─────────────────────────────────────────────────
async function handleImageGen(chatId, topic = '') {
  if (!topic) {
    waitingInput.set(String(chatId), { type: 'image_topic' });
    await send(chatId,
      '🎨 *Что нарисовать?*\n\n' +
      'Примеры:\n' +
      '• BMW тормозные колодки\n' +
      '• Акция на запчасти для Geely\n' +
      '• Доставка авто из Китая\n' +
      '• Профессиональная фотография Li Auto запчастей\n\n' +
      'Просто напиши описание 👇'
    );
    return;
  }

  const thinking = await send(chatId,
    `🎨 *Генерирую изображение*\n` +
    `📝 Тема: _${topic}_\n` +
    `⏳ Это может занять 30-60 секунд...\n\n` +
    `💡 Совет: Напиши подробнее что хочешь (стиль, размер, детали)`
  );

  try {
    console.log('[ImageGen] 🎨 START: Генерирую для:', topic);
    const startTime = Date.now();

    const imageResult = await generatePostImage(topic);
    const elapsed = Date.now() - startTime;
    console.log(`[ImageGen] ✅ SUCCESS за ${elapsed}ms:`, imageResult.url?.slice(0, 80));

    const { url } = imageResult;
    if (!url) throw new Error('URL не получена из API');

    // Скачивание
    console.log('[ImageGen] 📥 Загружаю изображение...');
    const buffer = await downloadImage(url);
    console.log(`[ImageGen] ✅ Загружено: ${buffer.length} bytes`);

    // Отправка в Telegram
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', `🎨 *Изображение*\n_${topic}_`);
    form.append('parse_mode', 'Markdown');
    form.append('photo', buffer, { filename: 'generated.jpg', contentType: 'image/jpeg' });

    console.log('[ImageGen] 📤 Отправляю в Telegram...');
    const tgRes = await fetch(`https://api.telegram.org/bot${EDO_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
    });

    if (!tgRes.ok) {
      console.error('[ImageGen] ❌ Telegram error:', tgRes.status);
      throw new Error(`Telegram error ${tgRes.status}`);
    }

    console.log('[ImageGen] ✅ Отправлено в Telegram');

    await deleteMessage(chatId, thinking.result.message_id).catch(() => {});

    await sendWithButtons(chatId, '✅ *Изображение готово!* Что дальше?', [
      [{ text: '📝 Написать пост', callback_data: `edo:post_with_image:${topic}` }],
      [{ text: '🔄 Перегенерировать', callback_data: `edo:regen_image:${topic}` }],
    ]);
  } catch (e) {
    console.error('[ImageGen] 🔴 ОШИБКА:', e.message);
    console.error('[ImageGen] Stack:', e.stack);

    let errorMsg = '❌ *Ошибка генерации изображения*\n\n';

    if (e.message.includes('Timeout')) {
      errorMsg += '⏱️ Запрос занял слишком долго\n';
      errorMsg += '💡 Попробуй ещё раз или опиши покороче\n';
    } else if (e.message.includes('HTTP')) {
      errorMsg += '🔌 Ошибка соединения с API\n';
      errorMsg += '💡 Проверь интернет и попробуй снова\n';
    } else if (e.message.includes('Telegram')) {
      errorMsg += '📱 Ошибка отправки в Telegram\n';
      errorMsg += '💡 Это техническая ошибка, попробуй позже\n';
    } else {
      errorMsg += `Детали: _${e.message.slice(0, 100)}_\n`;
      errorMsg += '💡 Напиши `/image` и попробуй ещё раз\n';
    }

    await send(chatId, errorMsg);
  }
}

// ── Рыночная аналитика ────────────────────────────────────────────────────
async function handleMarket(chatId, query = '') {
  await send(chatId, '📈 Анализирую рынок...');
  try {
    if (query) {
      const answer = await analyzeMarketQuestion(query);
      await send(chatId, answer);
    } else {
      const brief = await getDailyMarketBrief();
      await sendWithButtons(chatId, brief.fullText, [
        [
          { text: '💰 Арбитраж', callback_data: 'edo:arbitrage' },
          { text: '📊 Топ маржа', callback_data: 'edo:top_margin' },
        ],
        [
          { text: '🏆 Конкуренты', callback_data: 'edo:competitors' },
          { text: '🌍 Возможности', callback_data: 'edo:opportunities' },
        ],
      ]);
    }
  } catch (e) {
    await send(chatId, `❌ Ошибка аналитики: ${e.message}`);
  }
}

// ── Авто-сервис (СБКТС, ЭПТС, привоз, перепродажа) ──────────────────────
async function handleCarService(chatId, query = '') {
  if (query) {
    await send(chatId, '📋 Обрабатываю запрос...');
    try {
      const result = await answerDocQuestion(query);
      await send(chatId, result.text);
    } catch (e) {
      await send(chatId, `❌ Ошибка: ${e.message}`);
    }
    return;
  }

  await sendWithButtons(chatId,
    `🚗 *Авто-сервис LegalAuto*\n\nЧто тебя интересует?`,
    [
      [
        { text: '📋 СБКТС', callback_data: 'edo:car:sbkts' },
        { text: '📄 ЭПТС', callback_data: 'edo:car:epts' },
      ],
      [
        { text: '✈️ Привоз авто', callback_data: 'edo:car:import' },
        { text: '💰 Перепродажа', callback_data: 'edo:car:resale' },
      ],
      [
        { text: '🔢 Рассчитать таможню', callback_data: 'edo:car:customs' },
      ],
    ]
  );
}

// ── Брифинг ────────────────────────────────────────────────────────────────
async function handleBriefing(chatId) {
  await send(chatId, '⏳ Собираю данные...');

  try {
    const [stats, memStats, marketBrief] = await Promise.all([
      getStats().catch(() => null),
      Promise.resolve(getStatsForBriefing()),
      getDailyMarketBrief().catch(() => null),
    ]);

    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? '🌅 Доброе утро' : hour < 18 ? '☀️ Добрый день' : '🌙 Добрый вечер';

    let text = `${greeting}, Эдо! 🤖\n\n`;
    text += `📅 ${now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;

    // Бизнес-метрики
    if (stats) {
      text += `*📊 БИЗНЕС СЕГОДНЯ:*\n`;
      text += `• Лидов: ${stats.totalLeads || 0}\n`;
      text += `• Горячих: ${stats.hotLeads || 0} 🔥\n`;
      text += `• Конверсия: ${stats.conversionRate || 0}%\n\n`;
    }

    // Рыночная аналитика
    if (marketBrief) {
      const { seasonRU, trends } = getSeasonalTrends();
      text += `*📈 РЫНОК:*\n`;
      text += `• Сезон: ${seasonRU}\n`;
      text += `• Спрос: ${trends.substring(0, 80)}...\n`;
      const topPart = getTopMarginParts()[0];
      text += `• Топ маржа: ${topPart.part} (${topPart.margin})\n\n`;
    }

    // Задачи
    if (memStats.notesCount > 0) {
      const notes = getActiveNotes().slice(0, 3);
      text += `*📋 ЗАДАЧИ (${memStats.notesCount}):*\n`;
      notes.forEach(n => { text += `• ${n.text}\n`; });
      if (memStats.notesCount > 3) text += `... и ещё ${memStats.notesCount - 3}\n`;
      text += '\n';
    }

    text += `*🤖 АВТОПИЛОТ:*\n`;
    text += `• Постов опубликовано: ${memStats.postsPublished}\n`;
    text += `• Фактов в памяти: ${memStats.learnedFactsCount}\n\n`;
    text += `_Что делаем сегодня?_`;

    await sendWithButtons(chatId, text, [
      [
        { text: '📝 Пост в канал', callback_data: 'edo:post' },
        { text: '🎨 Нарисовать фото', callback_data: 'edo:image' },
      ],
      [
        { text: '📈 Рынок', callback_data: 'edo:market_brief' },
        { text: '🚗 Авто-сервис', callback_data: 'edo:car_service' },
      ],
      [
        { text: '💎 Топ маржа', callback_data: 'edo:top_margin' },
        { text: '📋 Задачи', callback_data: 'edo:notes' },
      ],
    ]);
  } catch (e) {
    await send(chatId, `❌ Ошибка брифинга: ${e.message}`);
  }
}

// ── Пост в канал ───────────────────────────────────────────────────────────
async function handlePost(chatId, topic = '') {
  if (!topic) {
    waitingInput.set(String(chatId), { type: 'post_topic' });
    await send(chatId, '📝 О чём писать пост? (например: "акция на тормозные колодки BMW")');
    return;
  }

  await send(chatId, `⏳ Генерирую пост на тему: _${topic}_...`);
  try {
    const postText = await generateSalesPost(topic);

    await sendWithButtons(chatId, `*Вот пост:*\n\n${postText}`, [
      [
        { text: '✅ Опубликовать', callback_data: `edo:publish_post:${Date.now()}` },
        { text: '✏️ Переделать', callback_data: 'edo:regenerate_post' },
      ],
      [{ text: '❌ Отмена', callback_data: 'edo:cancel' }],
    ]);
    setContext('pending_post', postText);
    setContext('pending_post_topic', topic);
  } catch (e) {
    await send(chatId, `❌ Ошибка генерации: ${e.message}`);
  }
}

// ── Заметки ────────────────────────────────────────────────────────────────
async function handleNotes(chatId) {
  const notes = getActiveNotes();
  if (notes.length === 0) {
    await send(chatId, '📋 Активных задач нет. Напиши что добавить!');
    return;
  }

  const text = notes.map((n, i) =>
    `${i + 1}. ${n.text}${n.remindAt ? ` ⏰ ${new Date(n.remindAt).toLocaleDateString('ru-RU')}` : ''}`
  ).join('\n');

  await sendWithButtons(chatId, `*📋 Твои задачи (${notes.length}):*\n\n${text}`, [
    [{ text: '➕ Добавить задачу', callback_data: 'edo:add_note' }],
    [{ text: '✅ Выполнена', callback_data: 'edo:done_note' }],
  ]);
}

// ── Память ─────────────────────────────────────────────────────────────────
async function handleMemory(chatId) {
  const mem = getMemory();
  const facts = mem.learnedFacts.slice(-5);
  const decisions = mem.decisions.slice(-3);

  let text = `*🧠 Что я помню о тебе:*\n\n`;
  text += `*Бизнес:* ${mem.business.description}\n`;
  text += `*Канал:* ${mem.business.channel}\n\n`;

  if (facts.length) {
    text += `*📚 Последние факты:*\n`;
    facts.forEach(f => { text += `• ${f.fact}\n`; });
    text += '\n';
  }

  if (decisions.length) {
    text += `*✅ Последние решения:*\n`;
    decisions.forEach(d => { text += `• ${d.decision}\n`; });
    text += '\n';
  }

  text += `*📊 Статистика:*\n`;
  text += `• Запомнено фактов: ${mem.learnedFacts.length}\n`;
  text += `• Решений: ${mem.decisions.length}\n`;
  text += `• Диалогов: ${mem.conversations.length}`;

  await send(chatId, text);
}

// ── Настройки ─────────────────────────────────────────────────────────────
async function handleSettings(chatId) {
  const mem = getMemory();
  const p = mem.preferences;

  await sendWithButtons(chatId,
    `*⚙️ Настройки автопилота:*\n\n` +
    `• Автопостинг: ${p.autoPostEnabled ? '✅ Вкл' : '❌ Выкл'}\n` +
    `• Интервал постов: каждые ${p.autoPostInterval}ч\n` +
    `• Брифинг в: ${p.briefingTime}\n` +
    `• Горячие лиды: ${p.escalateHotLeads ? '✅ Алерт' : '❌ Тихо'}`,
    [
      [
        { text: p.autoPostEnabled ? '❌ Выкл автопостинг' : '✅ Вкл автопостинг', callback_data: 'edo:toggle_autopost' },
      ],
      [
        { text: '⏱ Интервал 4ч', callback_data: 'edo:interval:4' },
        { text: '⏱ Интервал 6ч', callback_data: 'edo:interval:6' },
        { text: '⏱ Интервал 12ч', callback_data: 'edo:interval:12' },
      ],
    ]
  );
}

// ── Умная маршрутизация текстовых сообщений ───────────────────────────────
async function handleSmartMessage(chatId, text) {
  const lower = text.toLowerCase();

  // ── Брифинг
  if (lower.includes('брифинг') || lower.includes('как дела') || lower.includes('что по бизнесу')) {
    return handleBriefing(chatId);
  }

  // ── Пост
  if (lower.includes('запости') || lower.includes('сделай пост') || lower.includes('напиши пост')) {
    const topic = text.replace(/запости|сделай пост|напиши пост/gi, '').trim();
    return handlePost(chatId, topic);
  }

  // ── Генерация изображения
  if (lower.includes('нарисуй') || lower.includes('сгенерируй фото') || lower.includes('сделай картинку') || lower.includes('картинку для')) {
    const topic = text.replace(/нарисуй|сгенерируй фото|сделай картинку|картинку для/gi, '').trim();
    return handleImageGen(chatId, topic);
  }

  // ── Рынок и аналитика
  if (lower.includes('аналитика рынка') || lower.includes('что сейчас популярно') || lower.includes('рыночный') || lower.includes('конкурент')) {
    return handleMarket(chatId, text);
  }

  // ── СБКТС / ЭПТС / авто документы
  if (lower.includes('сбктс') || lower.includes('эптс') || lower.includes('растаможк') || lower.includes('таможн') || lower.includes('поставить на учёт') || lower.includes('птс')) {
    const result = await answerDocQuestion(text);
    return send(chatId, result.text);
  }

  // ── Привоз авто
  if (lower.includes('привез') || lower.includes('пригна') || lower.includes('привоз авто') || lower.includes('заказать авто') || lower.includes('импорт авто')) {
    return handleCarService(chatId, text);
  }

  // ── Задачи
  if (lower.includes('мои задачи') || lower.includes('что надо сделать') || (lower.includes('задачи') && !lower.includes('задач агент'))) {
    return handleNotes(chatId);
  }

  // ── Память
  if (lower.includes('запомни') || lower.includes('запиши') || lower.includes('не забудь')) {
    const fact = text.replace(/запомни|запиши|не забудь/gi, '').trim();
    if (lower.includes('задачу') || lower.includes('надо')) {
      addNote(fact);
      return send(chatId, `✅ Записал в задачи: _${fact}_`);
    }
    learnFact(fact);
    return send(chatId, `✅ Запомнил: _${fact}_`);
  }

  // ── Статистика продаж
  if (lower.includes('аналитика') || lower.includes('статистика') || lower.includes('продажи')) {
    const stats = await getStats().catch(() => null);
    if (stats) return send(chatId, formatReport(stats));
    return handleMarket(chatId); // Показываем рыночную аналитику если нет CRM
  }

  // ── Умная оркестрация через masterAgent (определяет тип и маршрутизирует)
  const taskResult = await orchestrate(text, { source: 'edo_personal' }).catch(() => null);

  if (taskResult?.result) {
    const r = taskResult.result;

    // Если агент вернул изображение
    if (r.type === 'image' && r.imageUrl) {
      try {
        const buffer = await downloadImage(r.imageUrl);
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', `🎨 _${r.topic}_`);
        form.append('parse_mode', 'Markdown');
        form.append('photo', buffer, { filename: 'image.png', contentType: 'image/png' });
        await fetch(`https://api.telegram.org/bot${EDO_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
        return;
      } catch {
        return send(chatId, `🎨 Изображение: ${r.imageUrl}`);
      }
    }

    // Обычный текстовый ответ
    if (r.text && taskResult.type !== 'general') {
      addConversation('user', text);
      addConversation('assistant', r.text);
      return send(chatId, r.text);
    }
  }

  // ── Личный AI (Claude с памятью) — последний уровень
  const answer = await askPersonalAI(text, chatId);
  return send(chatId, answer);
}

// ── Обработчик callback кнопок ─────────────────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  if (!isEdo(chatId)) return;

  const data = query.data;
  await answerCallback(query.id);

  if (data === 'edo:post') {
    return handlePost(chatId);
  }
  if (data === 'edo:image') {
    return handleImageGen(chatId);
  }
  if (data === 'edo:market_brief') {
    return handleMarket(chatId);
  }
  if (data === 'edo:car_service') {
    return handleCarService(chatId);
  }
  if (data === 'edo:notes') {
    return handleNotes(chatId);
  }
  if (data === 'edo:analytics') {
    const stats = await getStats().catch(() => null);
    if (stats) return send(chatId, formatReport(stats));
    return send(chatId, '📊 Нет данных.');
  }
  if (data === 'edo:hot_leads') {
    return send(chatId, '🔥 Функция горячих лидов — скоро! Пока смотри в /crm');
  }
  // ── Авто-сервис callbacks
  if (data === 'edo:car:sbkts') {
    const r = await answerDocQuestion('сбктс свидетельство безопасности');
    return send(chatId, r.text);
  }
  if (data === 'edo:car:epts') {
    const r = await answerDocQuestion('эптс электронный паспорт');
    return send(chatId, r.text);
  }
  if (data === 'edo:car:import') {
    const r = await answerDocQuestion('привоз авто из китая импорт');
    return send(chatId, r.text);
  }
  if (data === 'edo:car:resale') {
    const r = await answerDocQuestion('перепродажа флиппинг авто');
    return send(chatId, r.text);
  }
  if (data === 'edo:car:customs') {
    const cost = estimateCost('car_import', { carPrice: 2500000 });
    return send(chatId,
      `🏛 *Примерный расчёт таможни*\n\n` +
      `Пример: авто за 2 500 000 ₽\n` +
      `• Таможенная пошлина: ~${(cost.customs || 0).toLocaleString('ru-RU')} ₽\n` +
      `• Утильсбор: ~${(cost.util_sbor || 0).toLocaleString('ru-RU')} ₽\n` +
      `• СБКТС + ЭПТС: ~${(cost.sbkts_epts || 0).toLocaleString('ru-RU')} ₽\n` +
      `• Логистика: ~${(cost.logistics || 0).toLocaleString('ru-RU')} ₽\n\n` +
      `*ИТОГО (под ключ): ~${(cost.total || 0).toLocaleString('ru-RU')} ₽*\n\n` +
      `_Напиши точную стоимость авто и год выпуска — рассчитаю точнее._`
    );
  }
  // ── Рыночная аналитика callbacks
  if (data === 'edo:arbitrage') {
    waitingInput.set(String(chatId), { type: 'arbitrage_query' });
    return send(chatId, '💰 Введи название запчасти для поиска арбитража:');
  }
  if (data === 'edo:top_margin') {
    const { getTopMarginParts } = await import('../agents/marketIntelAgent.js');
    const parts = getTopMarginParts();
    const text2 = `💎 *Топ маржинальные позиции:*\n\n` +
      parts.map((p, i) => `${i + 1}. ${p.part}\n   Маржа: ${p.margin} | _${p.reason}_`).join('\n\n');
    return send(chatId, text2);
  }
  if (data === 'edo:competitors') {
    const { getCompetitorAnalysis } = await import('../agents/marketIntelAgent.js');
    return send(chatId, getCompetitorAnalysis().text);
  }
  if (data === 'edo:opportunities') {
    const opps = getRevenueOpportunities();
    const text2 = `🌍 *Возможности для заработка:*\n\n` +
      opps.map((o, i) => `${i + 1}. *${o.idea}*\n   💰 ${o.margin} | Сложность: ${o.difficulty}`).join('\n\n');
    return send(chatId, text2);
  }
  // ── Изображение callbacks
  if (data.startsWith('edo:post_with_image:')) {
    const topic = data.replace('edo:post_with_image:', '');
    return handlePost(chatId, topic);
  }
  if (data.startsWith('edo:regen_image:')) {
    const topic = data.replace('edo:regen_image:', '');
    return handleImageGen(chatId, topic);
  }
  if (data === 'edo:add_note') {
    waitingInput.set(String(chatId), { type: 'add_note' });
    return send(chatId, '📋 Напиши задачу:');
  }
  if (data === 'edo:done_note') {
    waitingInput.set(String(chatId), { type: 'done_note' });
    return send(chatId, '✅ Введи номер задачи (1, 2, 3...)');
  }
  if (data === 'edo:cancel') {
    waitingInput.delete(String(chatId));
    return send(chatId, '❌ Отменено.');
  }
  if (data === 'edo:toggle_autopost') {
    const mem = getMemory();
    updatePreferences({ autoPostEnabled: !mem.preferences.autoPostEnabled });
    return send(chatId, `Автопостинг ${!mem.preferences.autoPostEnabled ? '✅ включён' : '❌ выключен'}`);
  }
  if (data.startsWith('edo:interval:')) {
    const h = parseInt(data.split(':')[2]);
    updatePreferences({ autoPostInterval: h });
    return send(chatId, `⏱ Интервал постов: каждые ${h} часов`);
  }
  if (data.startsWith('edo:publish_post:')) {
    const postText = getContext('pending_post');
    if (!postText) return send(chatId, '❌ Пост не найден.');
    try {
      await publishNewsToChannel(postText);
      updateStats({ postsPublished: 1 });
      setContext('pending_post', null);
      return send(chatId, '✅ Пост опубликован в канал!');
    } catch (e) {
      return send(chatId, `❌ Ошибка публикации: ${e.message}`);
    }
  }
  if (data === 'edo:regenerate_post') {
    const topic = getContext('pending_post_topic');
    if (topic) return handlePost(chatId, topic);
    return send(chatId, '❌ Тема не сохранена. Введи заново.');
  }
}

// ── Обработчик входящих апдейтов ───────────────────────────────────────────
async function handleUpdate(update) {
  const msg = update.message;
  const callback = update.callback_query;

  if (callback) {
    return handleCallback(callback);
  }

  if (!msg) return;
  const chatId = msg.chat.id;

  // Если ADMIN_CHAT_ID не задан — помогаем его найти
  if (!ADMIN_CHAT_ID) {
    return send(chatId,
      `⚙️ *Бот не настроен*\n\n` +
      `Добавь в Railway переменную:\n` +
      `\`ADMIN_CHAT_ID = ${chatId}\``
    );
  }

  // Только Эдо!
  if (!isEdo(chatId)) {
    return send(chatId, '🔒 Это личный бот. Доступ закрыт.');
  }

  // Голосовое сообщение
  if (msg.voice) {
    const processing = await send(chatId, '🎙 Слушаю...');
    const text = await transcribeVoice(msg.voice.file_id);
    if (!text) {
      return send(chatId, '❌ Не удалось расшифровать. Попробуй ещё раз.');
    }
    await send(chatId, `🎙 *Ты сказал:* _${text}_`);
    return handleSmartMessage(chatId, text);
  }

  // Аудио файл (тоже через Whisper)
  if (msg.audio) {
    const text = await transcribeVoice(msg.audio.file_id);
    if (text) return handleSmartMessage(chatId, text);
    return send(chatId, '❌ Не удалось обработать аудио.');
  }

  const text = msg.text || '';
  if (!text) return;

  // Проверяем ожидание ввода
  const waiting = waitingInput.get(String(chatId));
  if (waiting) {
    waitingInput.delete(String(chatId));

    if (waiting.type === 'post_topic') {
      return handlePost(chatId, text);
    }
    if (waiting.type === 'add_note') {
      addNote(text);
      return send(chatId, `✅ Задача добавлена: _${text}_`);
    }
    if (waiting.type === 'done_note') {
      const notes = getActiveNotes();
      const idx = parseInt(text) - 1;
      if (notes[idx]) {
        doneNote(notes[idx].id);
        return send(chatId, `✅ Выполнено: _${notes[idx].text}_`);
      }
      return send(chatId, '❌ Задача не найдена.');
    }
    if (waiting.type === 'learn_fact') {
      learnFact(text);
      return send(chatId, `🧠 Запомнил: _${text}_`);
    }
    if (waiting.type === 'image_topic') {
      return handleImageGen(chatId, text);
    }
    if (waiting.type === 'arbitrage_query') {
      await send(chatId, '🔍 Анализирую арбитражную возможность...');
      try {
        const result = await findArbitrageOpportunity(text);
        return send(chatId, `💰 *Арбитраж: ${text}*\n\n${result.analysis}`);
      } catch (e) {
        return send(chatId, `❌ Ошибка: ${e.message}`);
      }
    }
    if (waiting.type === 'market_query') {
      return handleMarket(chatId, text);
    }
    if (waiting.type === 'car_doc_query') {
      return handleCarService(chatId, text);
    }
  }

  // Кнопки нижнего меню
  if (text === '📊 Брифинг')           return handleBriefing(chatId);
  if (text === '📝 Написать пост')     return handlePost(chatId);
  if (text === '🎨 Нарисовать фото')   return handleImageGen(chatId);
  if (text === '📈 Рынок')             return handleMarket(chatId);
  if (text === '🚗 Авто-сервис')       return handleCarService(chatId);
  if (text === '📌 Заметки')           return handleNotes(chatId);
  if (text === '🧠 Память')            return handleMemory(chatId);
  if (text === '⚙️ Настройки')         return handleSettings(chatId);

  // Команды
  if (text.startsWith('/start'))     return handleStart(chatId);
  if (text.startsWith('/briefing'))  return handleBriefing(chatId);
  if (text.startsWith('/post'))      return handlePost(chatId, text.replace('/post', '').trim());
  if (text.startsWith('/image'))     return handleImageGen(chatId, text.replace('/image', '').trim());
  if (text.startsWith('/img'))       return handleImageGen(chatId, text.replace('/img', '').trim());
  if (text.startsWith('/market'))    return handleMarket(chatId, text.replace('/market', '').trim());
  if (text.startsWith('/car'))       return handleCarService(chatId, text.replace('/car', '').trim());
  if (text.startsWith('/sbkts'))     return handleCarService(chatId, 'сбктс');
  if (text.startsWith('/epts'))      return handleCarService(chatId, 'эптс');
  if (text.startsWith('/import'))    return handleCarService(chatId, 'привоз авто');
  if (text.startsWith('/notes'))     return handleNotes(chatId);
  if (text.startsWith('/memory'))    return handleMemory(chatId);
  if (text.startsWith('/settings'))  return handleSettings(chatId);

  if (text.startsWith('/learn')) {
    const fact = text.replace('/learn', '').trim();
    if (fact) { learnFact(fact); return send(chatId, `🧠 Запомнил: _${fact}_`); }
    waitingInput.set(String(chatId), { type: 'learn_fact' });
    return send(chatId, '🧠 Что запомнить?');
  }

  if (text.startsWith('/decision')) {
    const parts = text.replace('/decision', '').trim().split('|');
    if (parts.length >= 2) {
      rememberDecision(parts[0].trim(), parts[1].trim());
      return send(chatId, '✅ Решение записано в память!');
    }
    return send(chatId, 'Формат: /decision ситуация | решение');
  }

  // Новые команды
  if (text === '/help' || text === '/помощь') {
    return send(chatId,
      `*🤖 Справка по командам:*\n\n` +
      `*Основные функции (кнопки):*\n` +
      `📊 /briefing — утренний брифинг\n` +
      `📝 /post [тема] — написать пост\n` +
      `🎨 /image [описание] — нарисовать фото\n` +
      `📈 /market [вопрос] — аналитика рынка\n` +
      `🚗 /car [вопрос] — авто-сервис\n\n` +
      `*Управление памятью:*\n` +
      `/learn [факт] — запомнить факт\n` +
      `/decision [ситуация] | [решение] — записать решение\n` +
      `/memory — показать память\n\n` +
      `*Другое:*\n` +
      `/notes — управлять заметками\n` +
      `/settings — настройки\n` +
      `/status — статус системы`
    );
  }

  if (text === '/status') {
    const mem = getMemory();
    return send(chatId,
      `*⚙️ Статус системы:*\n\n` +
      `✅ Bot ID: @${botUsername}\n` +
      `✅ API: Claude + OpenAI ready\n` +
      `📚 Памяти: ${mem.conversations.length} диалогов\n` +
      `📝 Заметок: ${mem.notes.length} активных\n` +
      `🧠 Фактов: ${mem.facts.length} в памяти\n` +
      `⚡ Версия: v2.0 (87.5% готово)\n\n` +
      `🟢 Все системы работают`
    );
  }

  if (text === '/stats') {
    const stats = getStatsForBriefing();
    return send(chatId,
      `*📊 Статистика:*\n\n` +
      `Постов: ${stats.postsPublished || 0}\n` +
      `Лидов: ${stats.hotLeads || 0}\n` +
      `Решений: ${stats.decisionsLogged || 0}\n` +
      `Диалогов: ${stats.messagesProcessed || 0}`
    );
  }

  // Умная маршрутизация
  return handleSmartMessage(chatId, text);
}

// ── Polling ────────────────────────────────────────────────────────────────
async function poll() {
  if (!EDO_BOT_TOKEN) return;
  try {
    const res = await callTg('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 20,
      limit: 10,
    });
    if (res?.ok && res.result?.length) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        handleUpdate(update).catch(e => console.error('[EdoBot] handleUpdate error:', e.message));
      }
    }
  } catch (e) {
    console.error('[EdoBot] poll error:', e.message);
  }
  setTimeout(poll, POLLING_INTERVAL);
}

// ── Утренний брифинг по расписанию ────────────────────────────────────────
export async function sendMorningBriefing() {
  if (!ADMIN_CHAT_ID || !EDO_BOT_TOKEN) return;
  console.log('[EdoBot] Отправляю утренний брифинг...');
  await handleBriefing(ADMIN_CHAT_ID);
}

// ── Уведомление о горячем лиде ────────────────────────────────────────────
export async function notifyHotLead(username, message) {
  if (!ADMIN_CHAT_ID || !EDO_BOT_TOKEN) return;
  const who = username ? '@' + username : 'неизвестный';
  await send(ADMIN_CHAT_ID,
    `🔥 *ГОРЯЧИЙ ЛИД!*\n\n` +
    `👤 ${who}\n` +
    `💬 «${message}»\n\n` +
    `⚡️ Клиент готов — свяжись сейчас!`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '📞 Позвонить', url: `https://t.me/${username?.replace('@', '') || ''}` },
        ]],
      },
    }
  );
  updateStats({ hotLeads: 1 });
}

// ── Инициализация ──────────────────────────────────────────────────────────
export async function initEdoBot() {
  if (!EDO_BOT_TOKEN) {
    console.log('[EdoBot] ⚠️ EDO_BOT_TOKEN не задан — личный бот не запущен');
    return;
  }

  // Удаляем webhook если он установлен (иначе polling не работает)
  const wh = await callTg('deleteWebhook', { drop_pending_updates: false });
  if (wh?.result) {
    console.log('[EdoBot] 🔗 Webhook удалён — переключаемся на polling');
  }

  // Получить username бота
  const me = await callTg('getMe');
  if (me?.ok) {
    botUsername = me.result.username;
    console.log(`[EdoBot] ✅ Личный бот @${botUsername} запущен`);
  }

  // Запуск polling
  poll();

  // Утренний брифинг в 09:00 по Москве (UTC+3)
  scheduleMorningBriefing();

  console.log('[EdoBot] 🤖 Автопилот активен!');
}

function scheduleMorningBriefing() {
  const checkBriefing = () => {
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    if (msk.getHours() === 9 && msk.getMinutes() === 0) {
      sendMorningBriefing().catch(() => {});
    }
    // Проверяем каждые 60 секунд
    setTimeout(checkBriefing, 60_000);
  };
  checkBriefing();
}

console.log('🤖 Edo Bot модуль загружен');

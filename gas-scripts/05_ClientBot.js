/**
 * LEGALAUTO CORE v2.0
 * Файл: 05_ClientBot.gs
 *
 * @LegalAutoAssist_bot — публичный бот для клиентов
 *
 * Услуги:
 *   📄 СБКТС  — сбор данных авто → лид → уведомление владельцу
 *   🗂️ ЭПТС   — аналогично
 *   ♻️ Утильсбор
 *   🚢 Таможня
 *   💬 Написать менеджеру
 *
 * AI: Claude Sonnet — собирает инфо по одному параметру, отвечает на вопросы
 * Язык: RU/EN автоопределение по language_code
 * Состояние диалога: CacheService (10 минут на сессию)
 *
 * Webhook: ...exec?bot=client  (роутится из doPost в 02_AdminBot.js)
 */

// ─── СЕКРЕТЫ ────────────────────────────────────────────────────────────────

function clientSecret(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

// ─── СИСТЕМНЫЕ ПРОМПТЫ (Claude) ──────────────────────────────────────────────

var CLIENT_PROMPTS = {
  sbkts: {
    ru: "Ты консультант LegalAuto по оформлению СБКТС (Свидетельство безопасности конструкции транспортного средства). " +
        "СБКТС обязателен для постановки на учёт в ГИБДД любого ввезённого авто. " +
        "Твоя задача: собрать у клиента необходимые данные по одному параметру за раз: " +
        "1) марка авто, 2) модель, 3) год выпуска, 4) VIN, 5) страна ввоза. " +
        "Когда все данные собраны — подтверди приём и скажи что менеджер свяжется. " +
        "Отвечай кратко, по-деловому. Не выдумывай цены и сроки.",
    en: "You are a LegalAuto consultant for SBKTS (Vehicle Safety Construction Certificate). " +
        "SBKTS is required to register any imported vehicle in Russia. " +
        "Collect the following one at a time: 1) make, 2) model, 3) year, 4) VIN, 5) country of import. " +
        "When all collected — confirm and say the manager will contact them. Be brief and professional."
  },
  epts: {
    ru: "Ты консультант LegalAuto по оформлению ЭПТС (Электронный паспорт транспортного средства). " +
        "ЭПТС — цифровой ПТС, обязателен для регистрации ввезённого авто в России. " +
        "Собери данные по одному: 1) марка, 2) модель, 3) год, 4) VIN, 5) есть ли СБКТС уже. " +
        "Когда собрал — подтверди и скажи что менеджер свяжется в ближайшее время. " +
        "Отвечай кратко. Если клиент спрашивает цену — скажи что менеджер озвучит точную стоимость.",
    en: "You are a LegalAuto consultant for EPTS (Electronic Vehicle Passport). " +
        "EPTS is a digital vehicle title required for registration in Russia. " +
        "Collect one at a time: 1) make, 2) model, 3) year, 4) VIN, 5) do they already have SBKTS. " +
        "When done — confirm and say manager will contact them. Keep it brief."
  },
  util: {
    ru: "Ты консультант LegalAuto по утилизационному сбору. " +
        "Помогаешь клиентам с расчётом и уплатой утилизационного сбора при ввозе авто. " +
        "Собери: 1) марка и модель, 2) год выпуска, 3) объём двигателя (в куб.см), 4) тип авто (физлицо/юрлицо), 5) дата ввоза. " +
        "Отвечай кратко. Не называй точные суммы — менеджер рассчитает индивидуально.",
    en: "You are a LegalAuto consultant for vehicle recycling fee (utilization fee). " +
        "Help clients with recycling fee calculation for imported vehicles. " +
        "Collect: 1) make and model, 2) year, 3) engine volume (cc), 4) individual or company, 5) import date. " +
        "Be brief. Don't quote exact amounts — the manager will calculate individually."
  },
  customs: {
    ru: "Ты консультант LegalAuto по таможенному сопровождению ввоза автомобилей. " +
        "Помогаешь клиентам разобраться в процессе таможенного оформления. " +
        "Собери: 1) откуда везут авто (страна), 2) марка и модель, 3) год, 4) примерная стоимость авто, " +
        "5) физлицо или юрлицо, 6) желаемые сроки. " +
        "Отвечай кратко. Не давай точных расчётов пошлин — менеджер рассчитает.",
    en: "You are a LegalAuto consultant for vehicle import customs support. " +
        "Collect: 1) origin country, 2) make and model, 3) year, 4) approximate vehicle cost, " +
        "5) individual or company, 6) desired timeline. " +
        "Be brief. Don't give exact duty calculations."
  }
};

// Текст интерфейса RU/EN
var UI = {
  welcome: {
    ru: "👋 Привет! Я помощник LegalAuto.\n\nПомогаю с оформлением документов на ввезённые автомобили. Выберите услугу:",
    en: "👋 Hi! I'm the LegalAuto assistant.\n\nI help with documentation for imported vehicles. Choose a service:"
  },
  menu: {
    ru: [
      [{ text: "📄 СБКТС", callback_data: "svc_sbkts" }],
      [{ text: "🗂️ ЭПТС", callback_data: "svc_epts" }],
      [{ text: "♻️ Утилизационный сбор", callback_data: "svc_util" }],
      [{ text: "🚢 Таможенное сопровождение", callback_data: "svc_customs" }],
      [{ text: "💬 Написать менеджеру", callback_data: "svc_manager" }]
    ],
    en: [
      [{ text: "📄 SBKTS Certificate", callback_data: "svc_sbkts" }],
      [{ text: "🗂️ EPTS (Vehicle Passport)", callback_data: "svc_epts" }],
      [{ text: "♻️ Recycling Fee", callback_data: "svc_util" }],
      [{ text: "🚢 Customs Support", callback_data: "svc_customs" }],
      [{ text: "💬 Contact Manager", callback_data: "svc_manager" }]
    ]
  },
  service_started: {
    sbkts: {
      ru: "📄 *СБКТС* — Свидетельство безопасности конструкции ТС\n\nОбязательный документ для постановки ввезённого авто на учёт в ГИБДД.\n\nДля оформления заявки задам несколько вопросов. Начнём?",
      en: "📄 *SBKTS* — Vehicle Safety Construction Certificate\n\nRequired to register an imported car with Russian traffic police.\n\nI'll ask a few questions to get your application started."
    },
    epts: {
      ru: "🗂️ *ЭПТС* — Электронный паспорт транспортного средства\n\nЦифровой ПТС, без которого нельзя зарегистрировать авто в ГИБДД.\n\nЗадам несколько вопросов для оформления.",
      en: "🗂️ *EPTS* — Electronic Vehicle Passport\n\nRequired for vehicle registration in Russia. Let me ask a few questions."
    },
    util: {
      ru: "♻️ *Утилизационный сбор*\n\nПомогаем рассчитать и оплатить утильсбор при ввозе авто.\n\nНесколько вопросов для расчёта:",
      en: "♻️ *Recycling Fee*\n\nWe help calculate and process the vehicle recycling fee.\n\nA few questions to get started:"
    },
    customs: {
      ru: "🚢 *Таможенное сопровождение*\n\nПолное сопровождение ввоза авто от документов до получения.\n\nРасскажите о вашем авто:",
      en: "🚢 *Customs Support*\n\nFull vehicle import support from documents to delivery.\n\nTell me about your vehicle:"
    }
  },
  lead_saved: {
    ru: "✅ Заявка принята! Менеджер свяжется с вами в ближайшее время.\n\n💬 Также можете написать напрямую: @LegalAutoAssist",
    en: "✅ Request received! Our manager will contact you shortly.\n\n💬 You can also reach us directly: @LegalAutoAssist"
  },
  error: {
    ru: "⚠️ Произошла ошибка. Попробуйте снова или напишите менеджеру: @LegalAutoAssist",
    en: "⚠️ Something went wrong. Please try again or contact us: @LegalAutoAssist"
  },
  menu_btn: {
    ru: "🏠 Главное меню",
    en: "🏠 Main menu"
  }
};

// ─── СОСТОЯНИЕ ДИАЛОГА (PropertiesService — надёжно, без TTL) ───────────────
// Автоочистка: состояния старше 2 часов игнорируются

function getState(chatId) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty("dlg_" + chatId);
    if (!raw) return null;
    const state = JSON.parse(raw);
    // Игнорируем состояние старше 2 часов
    if (state._ts && (Date.now() - state._ts) > 7200000) {
      clearState(chatId);
      return null;
    }
    return state;
  } catch (e) {
    return null;
  }
}

function setState(chatId, state) {
  state._ts = Date.now();
  PropertiesService.getScriptProperties().setProperty("dlg_" + chatId, JSON.stringify(state));
}

function clearState(chatId) {
  PropertiesService.getScriptProperties().deleteProperty("dlg_" + chatId);
}

// ─── ТОЧКА ВХОДА ─────────────────────────────────────────────────────────────

function clientBotWebhook(e) {
  try {
    const raw    = e && e.postData ? e.postData.contents : "";
    const update = JSON.parse(raw || "{}");

    // Callback query (нажатие inline-кнопки)
    if (update.callback_query) {
      return clientHandleCallback(update.callback_query);
    }

    if (!update.message) return laOk();

    const msg       = update.message;
    const chatId    = String(msg.chat.id);
    const firstName = String(msg.from && msg.from.first_name || msg.chat.first_name || "");
    const langCode  = String(msg.from && msg.from.language_code || "ru").toLowerCase();
    const lang      = langCode === "ru" ? "ru" : "en";
    const text      = String(msg.text || "").trim();

    if (!text) return laOk();

    laSafeLog("INFO", "CLIENT_BOT", "Message", { chat_id: chatId, text: text.substring(0, 50) });

    // /start или /menu → главное меню
    if (text === "/start" || text === "/menu" || text.toLowerCase() === "menu" || text === "🏠 Главное меню" || text === "🏠 Main menu") {
      clearState(chatId);
      return clientSendMenu(chatId, firstName, lang);
    }

    // Продолжение диалога по услуге
    const state = getState(chatId);
    if (state) {
      return clientContinueDialog(chatId, text, lang, state);
    }

    // Нет активного диалога — показываем меню
    return clientSendMenu(chatId, firstName, lang);

  } catch (err) {
    laSafeLog("ERROR", "CLIENT_BOT", "Webhook error", { error: String(err) });
    return laOk();
  }
}

// ─── ГЛАВНОЕ МЕНЮ ─────────────────────────────────────────────────────────────

function clientSendMenu(chatId, firstName, lang) {
  const greeting = firstName
    ? (lang === "ru" ? "👋 Привет, " + firstName + "!\n\n" : "👋 Hi, " + firstName + "!\n\n")
    : "";
  const text = greeting + UI.welcome[lang];

  clientSendInline(chatId, text, UI.menu[lang]);
  return laOk();
}

// ─── CALLBACK QUERY (нажатие кнопки) ─────────────────────────────────────────

function clientHandleCallback(cb) {
  const chatId = String(cb.message.chat.id);
  const data   = String(cb.data || "");
  const langCode = String(cb.from && cb.from.language_code || "ru").toLowerCase();
  const lang   = langCode === "ru" ? "ru" : "en";

  // Подтверждение нажатия (убирает "часики")
  clientAnswerCallback(cb.id);

  if (data === "svc_manager") {
    clearState(chatId);
    clientSend(chatId, lang === "ru"
      ? "💬 Написать менеджеру напрямую: @LegalAutoAssist"
      : "💬 Contact manager directly: @LegalAutoAssist");
    return laOk();
  }

  const svcMap = { svc_sbkts: "sbkts", svc_epts: "epts", svc_util: "util", svc_customs: "customs" };
  const svc = svcMap[data];
  if (!svc) return laOk();

  // Инициализируем диалог
  const state = {
    service: svc,
    lang: lang,
    history: [],
    chatId: chatId,
    firstName: String(cb.from && cb.from.first_name || "")
  };
  setState(chatId, state);

  // Отправляем приветствие по услуге
  const intro = UI.service_started[svc][lang];
  clientSend(chatId, intro);

  // Первый вопрос от AI — добавляем в историю чтобы не терять контекст
  const initMsg = lang === "ru" ? "Привет, хочу оформить." : "Hi, I need this service.";
  const firstQuestion = clientAskAI(state, initMsg, true);
  if (firstQuestion) {
    clientSend(chatId, firstQuestion);
    // Сохраняем первый обмен в историю
    state.history.push({ role: "user",      content: initMsg });
    state.history.push({ role: "assistant", content: firstQuestion });
    setState(chatId, state); // перезаписываем с историей
  }

  return laOk();
}

// ─── ПРОДОЛЖЕНИЕ ДИАЛОГА ──────────────────────────────────────────────────────

function clientContinueDialog(chatId, userText, lang, state) {
  // Добавляем сообщение пользователя в историю
  state.history.push({ role: "user", content: userText });
  if (state.history.length > 20) state.history = state.history.slice(-20); // ограничиваем историю

  // Спрашиваем AI
  const aiReply = clientAskAI(state, null, false);

  if (!aiReply) {
    clientSend(chatId, UI.error[lang]);
    return laOk();
  }

  // Добавляем ответ AI в историю
  state.history.push({ role: "assistant", content: aiReply });

  // Проверяем: собраны ли все данные (AI должен написать "LEAD_READY" в конце)
  const leadReady = aiReply.indexOf("LEAD_READY") !== -1;
  const cleanReply = aiReply.replace("LEAD_READY", "").trim();

  clientSend(chatId, cleanReply);

  if (leadReady) {
    // Сохраняем лид и уведомляем
    clientSaveLead(state, userText);
    clientNotifyManager(state);
    clientSend(chatId, UI.lead_saved[lang]);
    // Показываем кнопку возврата в меню
    clientSendInline(chatId, lang === "ru" ? "Чем ещё могу помочь?" : "Anything else?",
      [[{ text: UI.menu_btn[lang], callback_data: "menu" }]]);
    clearState(chatId);
  } else {
    setState(chatId, state);
  }

  return laOk();
}

// ─── AI ДИАЛОГ ────────────────────────────────────────────────────────────────

function clientAskAI(state, overrideUserMsg, isFirst) {
  const svc  = state.service;
  const lang = state.lang || "ru";

  const systemBase = CLIENT_PROMPTS[svc] && CLIENT_PROMPTS[svc][lang]
    ? CLIENT_PROMPTS[svc][lang]
    : CLIENT_PROMPTS[svc]["ru"];

  // Добавляем инструкцию о LEAD_READY
  const system = systemBase + "\n\n" +
    "ВАЖНО: когда все необходимые данные собраны, добавь в конец ответа слово LEAD_READY. " +
    "Не добавляй LEAD_READY пока не собраны все данные.";

  const history = isFirst
    ? [{ role: "user", content: overrideUserMsg || "Начнём" }]
    : state.history;

  const reply = laAskClaudeDialog(system, history, 600);
  return reply;
}

// ─── СОХРАНЕНИЕ ЛИДА ─────────────────────────────────────────────────────────

function clientSaveLead(state, lastMessage) {
  try {
    const sheet = laSheet("CLIENTS", [
      "created_at", "service", "client_name", "chat_id", "lang",
      "dialog_summary", "status"
    ]);

    // Формируем краткое резюме диалога
    const summary = state.history
      .map(function(m) { return (m.role === "user" ? "👤 " : "🤖 ") + m.content; })
      .join("\n").substring(0, 800);

    sheet.appendRow([
      new Date(),
      state.service.toUpperCase(),
      state.firstName || "",
      state.chatId,
      state.lang,
      summary,
      "NEW"
    ]);
  } catch (err) {
    laSafeLog("WARN", "CLIENT_BOT", "Не удалось сохранить лид", { error: String(err) });
  }
}

// ─── УВЕДОМЛЕНИЕ МЕНЕДЖЕРУ ───────────────────────────────────────────────────

function clientNotifyManager(state) {
  const managerChatId = clientSecret("MANAGER_CHAT_ID");
  if (!managerChatId) return;

  const svcNames = {
    sbkts:   "📄 СБКТС",
    epts:    "🗂️ ЭПТС",
    util:    "♻️ Утилизационный сбор",
    customs: "🚢 Таможня"
  };

  const dialog = state.history
    .filter(function(m) { return m.role === "user"; })
    .map(function(m) { return "• " + m.content; })
    .join("\n").substring(0, 500);

  const text =
    "🔥 НОВАЯ ЗАЯВКА — " + (svcNames[state.service] || state.service.toUpperCase()) + "\n\n" +
    "👤 " + (state.firstName || "Клиент") + " (chat_id: " + state.chatId + ")\n" +
    "🌐 Язык: " + (state.lang || "ru") + "\n\n" +
    "📋 Данные клиента:\n" + dialog + "\n\n" +
    "💬 Ответить клиенту: t.me/" + state.chatId;

  // Отправляем через ADMIN бот (ему доступен ADMIN_BOT_TOKEN)
  var adminToken;
  try { adminToken = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN); }
  catch(e) { return; }

  UrlFetchApp.fetch("https://api.telegram.org/bot" + adminToken + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: managerChatId,
      text: text,
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
}

// ─── ОТПРАВКА СООБЩЕНИЙ ───────────────────────────────────────────────────────

function clientSend(chatId, text) {
  var token = clientSecret("CLIENT_BOT_TOKEN");
  if (!token) return;

  var chunks = String(text || "").match(/[\s\S]{1,3500}/g) || [""];
  chunks.forEach(function(chunk) {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: String(chatId),
        text: chunk,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
  });
}

function clientSendInline(chatId, text, keyboard) {
  var token = clientSecret("CLIENT_BOT_TOKEN");
  if (!token) return;

  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: String(chatId),
      text: text,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
}

function clientAnswerCallback(callbackId) {
  var token = clientSecret("CLIENT_BOT_TOKEN");
  if (!token) return;
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ callback_query_id: callbackId }),
    muteHttpExceptions: true
  });
}

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────

function SETUP_CLIENT_BOT_1_секреты() {
  // Запусти один раз, потом очисти значения!
  PropertiesService.getScriptProperties().setProperties({
    CLIENT_BOT_TOKEN:  "8690294033:AAG0A-B4j93JDadbY2nDg3MWVPyTFbwldYU",
    MANAGER_CHAT_ID:   "8280654557",
    MANAGER_USERNAME:  "LegalAutoAssist",
    CLIENT_SHEET_NAME: "Parts"
  });
  Logger.log("✅ Секреты клиентского бота сохранены.");
}

function SETUP_CLIENT_BOT_2_webhook() {
  var WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwt7fGJNDnmrIStVS-YgQEDnIkuDQHYFe1NrlcwPWqT4L2YFk2JNQTD3Xqyc-54L8EU/exec?bot=client";
  var token = clientSecret("CLIENT_BOT_TOKEN");
  if (!token) { Logger.log("❌ CLIENT_BOT_TOKEN не задан. Сначала запусти SETUP_CLIENT_BOT_1"); return; }
  var url = "https://api.telegram.org/bot" + token + "/setWebhook?drop_pending_updates=true&url=" + encodeURIComponent(WEBHOOK_URL);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(res.getContentText());
}

function SETUP_CLIENT_BOT_3_проверка() {
  Logger.log("Token: " + (clientSecret("CLIENT_BOT_TOKEN") ? "✅ есть" : "❌ нет"));
  Logger.log("Manager chat_id: " + (clientSecret("MANAGER_CHAT_ID") || "❌ нет"));
  // Тест AI
  var testReply = laAskClaudeDialog(
    CLIENT_PROMPTS.sbkts.ru + "\nВАЖНО: добавь LEAD_READY когда все данные собраны.",
    [{ role: "user", content: "Привет, хочу оформить СБКТС" }],
    300
  );
  Logger.log("AI тест: " + (testReply || "❌ нет ответа"));
}

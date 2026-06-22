/**
 * LEGALAUTO CORE v1
 * Файл: 03_Setup.gs
 */

function SETUP_1_сохранить_секреты() {
  /**
   * ШАГ 1: Вставь свои токены ниже, запусти функцию ОДИН РАЗ, затем удали значения.
   * НИКОГДА не коммить реальные токены в Git!
   *
   * Где взять:
   * - ADMIN_BOT_TOKEN  → @BotFather в Telegram → /newbot или /mybots
   * - ADMIN_CHAT_ID    → напиши боту, потом зайди на https://api.telegram.org/bot<TOKEN>/getUpdates
   * - GEMINI_API_KEY   → https://aistudio.google.com/app/apikey  (начинается с AIza...)
   * - SPREADSHEET_ID   → из URL таблицы: docs.google.com/spreadsheets/d/<ID>/edit
   */

  laSetSecret(LA.SECRETS.ADMIN_BOT_TOKEN, "8934120774:AAE_a2AnIwa31JmyQL0EAYsRx5FyLJ7dTvY");
  laSetSecret(LA.SECRETS.ADMIN_CHAT_ID,   "8280654557");
  laSetSecret(LA.SECRETS.GEMINI_API_KEY,  "AQ.Ab8RN6LCsoe6pox4K9K3kpXr80lMK6zB7ffaFZcDxye-UtDE-w");
  laSetSecret(LA.SECRETS.CLAUDE_API_KEY,  "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");

  /**
   * Если скрипт открыт прямо из Google Таблицы — оставь пустым "".
   * Если отдельный проект — вставь ID таблицы (другой аккаунт — дай боту доступ через "Поделиться").
   */
  laSetSecret(LA.SECRETS.SPREADSHEET_ID, "1oxJ1wdyjReC6fCarq0PsmO-T1TSW9FqqLeksQyKRZE8");

  Logger.log("✅ Секреты сохранены.");
}

function SETUP_2_создать_листы() {
  laInitSheets();
  Logger.log("✅ Служебные листы созданы.");
}

function SETUP_3_подключить_webhook() {
  const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwt7fGJNDnmrIStVS-YgQEDnIkuDQHYFe1NrlcwPWqT4L2YFk2JNQTD3Xqyc-54L8EU/exec";

  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
  const url =
    "https://api.telegram.org/bot" +
    token +
    "/setWebhook?drop_pending_updates=true&url=" +
    encodeURIComponent(WEBHOOK_URL);

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}

function SETUP_4_проверить_webhook() {
  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
  const url = "https://api.telegram.org/bot" + token + "/getWebhookInfo";

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}

function SETUP_5_отключить_webhook() {
  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
  const url =
    "https://api.telegram.org/bot" +
    token +
    "/deleteWebhook?drop_pending_updates=true";

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}

function SETUP_6_меню_команд() {
  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
  const url = "https://api.telegram.org/bot" + token + "/setMyCommands";

  const commands = [
    { command: "menu", description: "Открыть меню" },
    { command: "ping", description: "Проверка связи" },
    { command: "status", description: "Проверить систему" },
    { command: "products", description: "Статистика товаров" },
    { command: "leads", description: "Заявки клиентов" },
    { command: "tasks", description: "Задачи агентов" },
    { command: "ai", description: "Проверить AI" }
  ];

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ commands: commands }),
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}

function TEST_симуляция_сообщения() {
  const chatId = laSecret(LA.SECRETS.ADMIN_CHAT_ID);

  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        message: {
          chat: { id: Number(chatId) },
          text: "/status"
        }
      })
    }
  };

  doPost(fakeEvent);
  Logger.log("✅ Симуляция отправлена. Проверь Telegram.");
}

function SETUP_0_жесткий_сброс_webhook() {
  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);

  const url =
    "https://api.telegram.org/bot" +
    token +
    "/deleteWebhook?drop_pending_updates=true";

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  Logger.log(response.getContentText());
}

function SETUP_7_запустить_polling() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "BOT_pollUpdates") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("BOT_pollUpdates")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("✅ Polling включён. Бот будет проверять команды каждую минуту.");
}

function SETUP_8_сбросить_очередь_polling() {
  const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);

  UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + token + "/deleteWebhook?drop_pending_updates=true",
    { muteHttpExceptions: true }
  );

  PropertiesService.getScriptProperties().deleteProperty("LAST_UPDATE_ID");

  Logger.log("✅ Webhook отключён, очередь сброшена.");
}

function SETUP_9_удалить_polling_triggers() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "BOT_pollUpdates") {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  Logger.log("✅ Удалено polling-триггеров: " + count);
}

/**
 * LEGALAUTO CORE v1.6
 * Файл: 00_Config.gs
 *
 * Общие утилиты — доступны из всех файлов GAS проекта:
 *   laPartsSheet() — лист Parts (имя содержит кавычки, ищем по индексу)
 *   laSafeLog()    — безопасное логирование (не крашит при ошибке)
 *   apiJsonResp()  — стандартный JSON-ответ для doGet
 */

const LA = {
  VERSION: "LegalAuto Core v1.4",
  AI_PROVIDER: "gemini",
  GEMINI_MODEL: "gemini-2.5-flash",
  SHEETS: {
    SETTINGS:   "SETTINGS",
    CHANNELS:   "CHANNELS",
    LEADS:      "LEADS",
    CLIENTS:    "CLIENTS",
    CARS:       "CARS",
    PARTS:      "Parts",
    TASKS:      "AGENT_TASKS",
    LOG:        "SYSTEM_LOG",
    POST_QUEUE: "POST_QUEUE"
  },
  SECRETS: {
    ADMIN_BOT_TOKEN:  "ADMIN_BOT_TOKEN",
    ADMIN_CHAT_ID:    "ADMIN_CHAT_ID",
    GEMINI_API_KEY:   "GEMINI_API_KEY",
    SPREADSHEET_ID:   "SPREADSHEET_ID",
    CLIENT_BOT_TOKEN: "CLIENT_BOT_TOKEN",
    MANAGER_CHAT_ID:  "MANAGER_CHAT_ID",
    MANAGER_USERNAME: "MANAGER_USERNAME",
    CLAUDE_API_KEY:   "CLAUDE_API_KEY"
  }
};

function laSecret(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error("Не найден секрет: " + key);
  return value;
}

function laSetSecret(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value).trim());
}

function laSS() {
  const id = PropertiesService.getScriptProperties().getProperty(LA.SECRETS.SPREADSHEET_ID);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function laSheet(name, headers) {
  const ss = laSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (headers && sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function laLog(level, module, message, data) {
  const sheet = laSheet(LA.SHEETS.LOG, [
    "created_at", "level", "module", "message", "data"
  ]);

  sheet.appendRow([
    new Date(),
    level,
    module,
    message,
    data ? JSON.stringify(data) : ""
  ]);
}

/** Лист Parts — имя содержит кавычки, поэтому ищем по индексу 0 */
function laPartsSheet() {
  return laSS().getSheets()[0];
}

/** Безопасное логирование — не выбрасывает исключение если лист недоступен */
function laSafeLog(level, module, message, data) {
  try {
    laLog(level, module, message, data);
  } catch (e) {
    Logger.log("[" + level + "] " + module + ": " + message + (data ? " | " + JSON.stringify(data) : ""));
  }
}

/** Стандартный JSON-ответ для doGet */
function apiJsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function laInitSheets() {
  laSheet(LA.SHEETS.SETTINGS,   ["key", "value", "description"]);
  laSheet(LA.SHEETS.CHANNELS,   ["channel_key", "title", "chat_id", "username", "enabled", "type"]);
  laSheet(LA.SHEETS.LEADS,      ["created_at", "source", "client_name", "chat_id", "phone", "request", "status", "comment"]);
  laSheet(LA.SHEETS.CLIENTS,    ["created_at", "source", "chat_id", "username", "car", "client", "phone", "stage", "data", "status"]);
  laSheet(LA.SHEETS.CARS,       ["created_at", "chat_id", "car", "client", "phone", "stage", "note", "date"]);
  laSheet(LA.SHEETS.TASKS,      ["created_at", "task", "agent", "status", "priority", "result"]);
  laSheet(LA.SHEETS.POST_QUEUE, ["created_at", "platform", "channel_key", "text", "status", "approved", "published_at"]);
  laSheet(LA.SHEETS.LOG,        ["created_at", "level", "module", "message", "data"]);

  Logger.log("✅ Все листы созданы/проверены. Версия: " + LA.VERSION);
  laLog("INFO", "CORE", "Sheets initialized", { version: LA.VERSION });
}
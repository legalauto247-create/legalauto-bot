/**
 * LEGALAUTO — Авито XML Автофид
 * Файл: 09_AvitoFeed.js
 *
 * Генерирует XML в формате Авито Автозагрузка из листа Parts
 * Публикует объявления автоматически через URL фида
 *
 * Запуск вручную: AVITO_generateFeed()
 * По расписанию:  AVITO_setupTrigger() — каждые 6 часов
 *
 * Доступ через URL деплоя: ?action=avito_feed
 */

// ── Настройки Авито ────────────────────────────────────────────────────────
var AVITO_CONFIG = {
  ContactPhone:   "+7XXXXXXXXXX",   // ← замени на свой номер
  ContactEmail:   "info@legalauto.ru",
  Address:        "Москва",
  AllowEmail:     false,
  ManagerName:    "LegalAuto",
  MaxAds:         200,              // максимум объявлений за раз
};

// ── Основная функция генерации XML ─────────────────────────────────────────
function AVITO_generateFeed() {
  try {
    const xml = buildAvitoXml();
    // Сохраняем XML в DriveApp для доступа по ссылке
    const fileName = "avito_feed_" + Utilities.formatDate(new Date(), "Europe/Moscow", "yyyyMMdd_HHmm") + ".xml";
    const folder   = getOrCreateFolder("LegalAuto_Avito");
    // Удаляем старые фиды
    const existing = folder.getFilesByName("avito_feed_latest.xml");
    while (existing.hasNext()) existing.next().setTrashed(true);
    // Создаём новый
    const file = folder.createFile("avito_feed_latest.xml", xml, "application/xml");
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = "https://drive.google.com/uc?export=download&id=" + file.getId();
    Logger.log("✅ Авито фид создан: " + url);
    Logger.log("   Товаров в фиде: " + (xml.match(/<Ad>/g) || []).length);
    laSafeLog("INFO", "AVITO", "Фид обновлён", { url: url });
    return url;
  } catch (err) {
    Logger.log("❌ Ошибка AVITO_generateFeed: " + err);
    return null;
  }
}

// ── Построение XML ──────────────────────────────────────────────────────────
function buildAvitoXml() {
  const ss    = laSS();
  const sheet = laPartsSheet();
  if (!sheet) throw new Error('Лист Parts не найден');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("Нет данных в Parts");

  const h = data[0].map(function(x) { return String(x).toLowerCase().trim(); });
  const col = {
    id:       h.indexOf("id"),
    brand:    h.indexOf("brand"),
    series:   h.indexOf("series"),
    category: h.indexOf("category"),
    name:     h.indexOf("name"),
    oem:      h.indexOf("oem"),
    compat:   h.indexOf("compatibility"),
    condition:h.indexOf("condition"),
    price:    h.indexOf("price"),
    qty:      h.indexOf("qty"),
    photo:    h.indexOf("photo_cover"),
    desc:     h.indexOf("description"),
    visible:  h.indexOf("avito_publish"),
    car:      h.indexOf("display_car"),
  };

  const rows = data.slice(1).filter(function(r) {
    // Публикуем только если avito_publish != FALSE и qty > 0
    if (col.visible >= 0 && String(r[col.visible] || "").toUpperCase() === "FALSE") return false;
    if (col.qty >= 0 && Number(r[col.qty] || 0) <= 0) return false;
    if (col.price >= 0 && Number(r[col.price] || 0) <= 0) return false;
    return true;
  }).slice(0, AVITO_CONFIG.MaxAds);

  var ads = rows.map(function(r, i) {
    const id       = col.id >= 0 ? String(r[col.id] || (i+1)) : String(i+1);
    const brand    = col.brand >= 0 ? String(r[col.brand] || "") : "";
    const series   = col.series >= 0 ? String(r[col.series] || "") : "";
    const name     = col.name >= 0 ? String(r[col.name] || "") : "";
    const oem      = col.oem >= 0 ? String(r[col.oem] || "") : "";
    const compat   = col.compat >= 0 ? String(r[col.compat] || "") : "";
    const cond     = col.condition >= 0 ? String(r[col.condition] || "Б/У") : "Б/У";
    const price    = col.price >= 0 ? Number(r[col.price] || 0) : 0;
    const photo    = col.photo >= 0 ? String(r[col.photo] || "") : "";
    const carLabel = col.car >= 0 ? String(r[col.car] || "") : brand + " " + series;

    // Формируем заголовок
    const title = (name + " " + brand + " " + series).trim().substring(0, 50);

    // Формируем описание
    var descParts = [name];
    if (brand)  descParts.push("Марка: " + brand);
    if (series) descParts.push("Серия: " + series);
    if (oem)    descParts.push("OEM: " + oem);
    if (compat) descParts.push("Совместимость: " + compat);
    descParts.push("Состояние: " + conditionLabel(cond));
    descParts.push("");
    descParts.push("✅ Оригинальные запчасти от LegalAuto");
    descParts.push("📦 Доставка по всей России");
    descParts.push("📋 СБКТС и ЭПТС — оформим под ключ");
    descParts.push("📞 Пишите в Telegram: @LegalAuto247");
    const desc = descParts.join("\n");

    // Категория Авито
    const avitoCategory = getAvitoCategory(name, brand);

    var photoXml = "";
    if (photo && photo.startsWith("http")) {
      photoXml = "<Images><Image url=" + xmlAttr(photo) + "/></Images>";
    }

    return [
      "<Ad>",
      "  <Id>" + xmlEsc(id) + "</Id>",
      "  <DateBegin>" + Utilities.formatDate(new Date(), "Europe/Moscow", "yyyy-MM-dd") + "</DateBegin>",
      "  <Category>" + xmlEsc(avitoCategory) + "</Category>",
      "  <AdType>Товар приобретён на продажу</AdType>",
      "  <Title>" + xmlEsc(title) + "</Title>",
      "  <Description>" + xmlEsc(desc) + "</Description>",
      "  <Price>" + Math.round(price) + "</Price>",
      "  <ContactPhone>" + xmlEsc(AVITO_CONFIG.ContactPhone) + "</ContactPhone>",
      "  <Address>" + xmlEsc(AVITO_CONFIG.Address) + "</Address>",
      "  <Condition>" + xmlEsc(conditionLabel(cond)) + "</Condition>",
      "  <OEM>" + xmlEsc(oem) + "</OEM>",
      photoXml,
      "</Ad>"
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Ads formatVersion="3" target="Avito.ru">',
    ads.join("\n\n"),
    '</Ads>'
  ].join("\n");
}

// ── Хелперы ────────────────────────────────────────────────────────────────
function conditionLabel(cond) {
  var c = String(cond || "").toLowerCase();
  if (c.includes("отл") || c.includes("new") || c.includes("нов")) return "Новое";
  if (c.includes("хор") || c.includes("good"))                      return "Хорошее";
  return "Б/У";
}

function getAvitoCategory(name, brand) {
  var n = String(name || "").toLowerCase();
  if (n.includes("двигател") || n.includes("мотор"))           return "Запчасти и аксессуары";
  if (n.includes("коробк") || n.includes("акпп") || n.includes("мкпп")) return "Запчасти и аксессуары";
  if (n.includes("фар") || n.includes("фон"))                  return "Запчасти и аксессуары";
  if (n.includes("бамп") || n.includes("капот") || n.includes("крыл")) return "Кузовные детали";
  if (n.includes("подвеск") || n.includes("рычаг") || n.includes("ступиц")) return "Запчасти и аксессуары";
  return "Запчасти и аксессуары";
}

function xmlEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlAttr(url) {
  return '"' + xmlEsc(url) + '"';
}

function getOrCreateFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ── Обработчик URL: ?action=avito_feed ────────────────────────────────────
// Добавь в doGet в 02_AdminBot.js:
// if (action === "avito_feed") return AVITO_doGetFeed();
function AVITO_doGetFeed() {
  try {
    const xml = buildAvitoXml();
    return ContentService
      .createTextOutput(xml)
      .setMimeType(ContentService.MimeType.XML);
  } catch (err) {
    return ContentService
      .createTextOutput("Error: " + String(err))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// ── Расписание: обновлять каждые 6 часов ──────────────────────────────────
function AVITO_setupTrigger() {
  // Удаляем старые триггеры
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "AVITO_generateFeed") {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Создаём новый
  ScriptApp.newTrigger("AVITO_generateFeed")
    .timeBased()
    .everyHours(6)
    .create();
  Logger.log("✅ Авито триггер установлен (каждые 6 часов)");
}

// ── Ручная отправка статистики в Telegram ─────────────────────────────────
function AVITO_sendStats() {
  try {
    const url  = AVITO_generateFeed();
    const count = laPartsSheet().getLastRow() - 1;
    const token = laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
    const chatId= laSecret(LA.SECRETS.ADMIN_CHAT_ID);
    const text  = "📊 *Авито фид обновлён*\n\nТоваров: " + count + "\nФид URL:\n" + (url || "ошибка");
    const apiUrl= "https://api.telegram.org/bot" + token + "/sendMessage";
    UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log("AVITO_sendStats error: " + e);
  }
}

// laSafeLog() и laPartsSheet() — определены в 00_Config.js

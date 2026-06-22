/**
 * LEGALAUTO CORE v1.2
 * Файл: 06_AutoPost.js
 *
 * AI-агент автопостинга.
 * Берёт следующий неопубликованный товар → AI пишет продающий текст
 * → публикует в Telegram канал → помечает опубликованным.
 *
 * Запуск: вручную или через триггер (SETUP_AUTOPOST_3_триггер).
 *
 * Нужно в PropertiesService:
 *   CHANNEL_ID        — chat_id канала (например -1003877661204)
 *   CHANNEL_USERNAME  — username канала без @ (например LegalAutoParts24)
 *   PUBLISHER_TOKEN   — токен бота-публикатора (может быть тот же ADMIN_BOT_TOKEN)
 */

// ─── Основная функция ─────────────────────────────────────────────────────────

function autoPostOne() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var item = autoPostPickNext();
    if (!item) {
      laSafeLog("INFO", "AUTOPOST", "Нет товаров для публикации");
      return;
    }

    laSafeLog("INFO", "AUTOPOST", "Публикую товар", { oem: item.oem, row: item.row });

    var text = autoPostGenerateText(item);
    var result = autoPostSend(item, text);

    if (result.ok) {
      autoPostMarkPublished(item.row, result.messageId);
      laSafeLog("INFO", "AUTOPOST", "Опубликовано", { oem: item.oem, message_id: result.messageId });
    } else {
      autoPostMarkError(item.row, result.error);
      laSafeLog("ERROR", "AUTOPOST", "Ошибка публикации", { oem: item.oem, error: result.error });
    }

  } finally {
    lock.releaseLock();
  }
}

// ─── Выбор следующего товара ──────────────────────────────────────────────────

function autoPostPickNext() {
  var sheet = laSS().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var ix = function(name) { return h.indexOf(name); };

  var iPublished    = ix("published");
  var iVisible      = ix("miniapp_visible");
  var iPrice        = ix("price");
  var iQty          = ix("qty");
  var iPhoto        = ix("photo_cover");
  var iPriority     = ix("priority");
  var iPostHash     = ix("post_hash");
  var iFeatured     = ix("featured");

  if (iPublished < 0) return null;

  // Сначала featured, потом по приоритету NORMAL
  var candidates = [];

  for (var i = 1; i < data.length; i++) {
    var published = String(data[i][iPublished] || "").trim().toUpperCase();
    if (published === "TRUE" || published === "SKIP" || published === "DUPLICATE" || published === "ERROR") continue;

    if (iVisible >= 0 && String(data[i][iVisible] || "").toUpperCase() === "FALSE") continue;
    if (iQty >= 0 && Number(data[i][iQty] || 0) <= 0) continue;
    if (iPrice >= 0 && Number(data[i][iPrice] || 0) <= 0) continue;
    if (iPhoto >= 0 && !String(data[i][iPhoto] || "").trim()) continue;

    // Проверка дубля по post_hash
    if (iPostHash >= 0) {
      var hash = String(data[i][iPostHash] || "");
      var isDupe = data.some(function(row, idx) {
        if (idx === 0 || idx === i) return false;
        return String(row[iPostHash] || "") === hash && String(row[iPublished] || "").toUpperCase() === "TRUE";
      });
      if (isDupe) {
        sheet.getRange(i + 1, iPublished + 1).setValue("DUPLICATE");
        continue;
      }
    }

    candidates.push({
      row:        i + 1,
      name:       data[i][ix("name")]         || "",
      brand:      data[i][ix("brand")]        || "",
      series:     data[i][ix("series")]       || "",
      body:       data[i][ix("body")]         || "",
      display_car: data[i][ix("display_car")] || "",
      oem:        data[i][ix("oem")]          || "",
      category:   data[i][ix("category")]     || "Запчасти",
      condition:  data[i][ix("condition")]    || "Оригинал Б/У",
      price:      Number(data[i][iPrice] || 0),
      qty:        Number(data[i][iQty]   || 1),
      photo:      iPhoto >= 0 ? data[i][iPhoto] : "",
      compatibility: data[i][ix("compatibility")] || "",
      description:   data[i][ix("description")]   || "",
      featured:   iFeatured >= 0 ? String(data[i][iFeatured] || "").toUpperCase() : "",
      priority:   iPriority >= 0 ? String(data[i][iPriority] || "NORMAL").toUpperCase() : "NORMAL",
      hash:       iPostHash >= 0 ? String(data[i][iPostHash] || "") : ""
    });
  }

  if (!candidates.length) return null;

  // Приоритет: featured → NORMAL сверху вниз
  candidates.sort(function(a, b) {
    if (a.featured === "TRUE" && b.featured !== "TRUE") return -1;
    if (b.featured === "TRUE" && a.featured !== "TRUE") return 1;
    return a.row - b.row;
  });

  return candidates[0];
}

// ─── AI генерация текста поста ────────────────────────────────────────────────

function autoPostGenerateText(item) {
  var systemPrompt =
    "Ты копирайтер магазина автозапчастей LegalAuto. Пишешь продающие посты для Telegram-канала.\n" +
    "Стиль: живой, конкретный, с эмодзи. Без воды и клише. Максимум 250 слов.\n" +
    "Структура поста:\n" +
    "1. Эмодзи + яркий заголовок (название запчасти + авто)\n" +
    "2. Короткое описание ценности (1-2 строки)\n" +
    "3. Характеристики списком\n" +
    "4. Призыв к действию\n" +
    "Не придумывай OEM, цену или наличие — используй только данные которые получил.";

  var userMessage =
    "Напиши пост для этого товара:\n\n" +
    "Авто: " + (item.display_car || item.brand + " " + item.series + " " + item.body) + "\n" +
    "Запчасть: " + item.name + "\n" +
    "OEM: " + (item.oem || "не указан") + "\n" +
    "Категория: " + item.category + "\n" +
    "Состояние: " + item.condition + "\n" +
    (item.compatibility ? "Совместимость: " + item.compatibility + "\n" : "") +
    (item.description ? "Описание: " + item.description + "\n" : "") +
    "Цена: " + Number(item.price).toLocaleString("ru-RU") + " ₽\n" +
    "Остаток: " + item.qty + " шт.\n\n" +
    "В конце добавь: «🚚 Отправка по всей России»";

  try {
    var aiText = laAskAI(systemPrompt, userMessage);
    // Добавляем ссылку на менеджера
    var managerUsername = PropertiesService.getScriptProperties().getProperty("MANAGER_USERNAME") || "LegalAuto247";
    return aiText + "\n\n📲 Заказать: @" + managerUsername;
  } catch (err) {
    // Fallback: стандартный шаблон
    return autoPostFallbackText(item);
  }
}

function autoPostFallbackText(item) {
  var car = item.display_car || (item.brand + " " + item.series + " " + item.body).trim();
  var managerUsername = PropertiesService.getScriptProperties().getProperty("MANAGER_USERNAME") || "LegalAuto247";
  return (
    "🔥 НОВОЕ ПОСТУПЛЕНИЕ\n\n" +
    "🚘 " + car + "\n\n" +
    "📦 " + item.name + "\n\n" +
    "🏷 Категория: " + item.category + "\n" +
    "⚙️ Состояние: " + item.condition + "\n" +
    (item.oem ? "🔧 OEM: " + item.oem + "\n" : "") +
    (item.compatibility ? "🔗 Совместимость: " + item.compatibility + "\n" : "") +
    "\n💰 Цена: " + Number(item.price).toLocaleString("ru-RU") + " ₽\n" +
    "📦 Остаток: " + item.qty + " шт.\n\n" +
    "🚚 Отправка по всей России\n\n" +
    "📲 Заказать: @" + managerUsername
  );
}

// ─── Публикация в Telegram ────────────────────────────────────────────────────

function autoPostSend(item, text) {
  var token = PropertiesService.getScriptProperties().getProperty("PUBLISHER_TOKEN")
    || laSecret(LA.SECRETS.ADMIN_BOT_TOKEN);
  var channelId = PropertiesService.getScriptProperties().getProperty("CHANNEL_ID");

  if (!channelId) return { ok: false, error: "CHANNEL_ID не задан" };

  var url, payload;

  if (item.photo) {
    // Есть фото — sendPhoto
    url = "https://api.telegram.org/bot" + token + "/sendPhoto";
    payload = {
      chat_id: channelId,
      photo: item.photo,
      caption: text
    };
  } else {
    // Нет фото — sendMessage
    url = "https://api.telegram.org/bot" + token + "/sendMessage";
    payload = {
      chat_id: channelId,
      text: text,
      disable_web_page_preview: true
    };
  }

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());

  if (!result.ok) {
    return { ok: false, error: JSON.stringify(result) };
  }

  return { ok: true, messageId: result.result.message_id };
}

// ─── Обновление строки в таблице ─────────────────────────────────────────────

function autoPostMarkPublished(rowNumber, messageId) {
  var sheet = laSS().getSheets()[0];
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ix = function(name) { return h.indexOf(name); };

  var channelUsername = PropertiesService.getScriptProperties().getProperty("CHANNEL_USERNAME") || "";
  var postLink = channelUsername && messageId
    ? "https://t.me/" + channelUsername + "/" + messageId
    : "";

  var updates = [
    { col: ix("published"),           val: "TRUE"     },
    { col: ix("published_at"),        val: new Date() },
    { col: ix("telegram_post"),       val: postLink   },
    { col: ix("telegram_message_id"), val: messageId  }
  ];

  updates.forEach(function(u) {
    if (u.col >= 0) sheet.getRange(rowNumber, u.col + 1).setValue(u.val);
  });
}

function autoPostMarkError(rowNumber, error) {
  var sheet = laSS().getSheets()[0];
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = h.indexOf("published");
  if (col >= 0) sheet.getRange(rowNumber, col + 1).setValue("ERROR");
  laSafeLog("ERROR", "AUTOPOST", "Ошибка публикации строки " + rowNumber, { error: error });
}

// ─── Публикация нескольких товаров подряд ────────────────────────────────────

function autoPostBatch(count) {
  count = count || 3;
  for (var i = 0; i < count; i++) {
    autoPostOne();
    if (i < count - 1) Utilities.sleep(3000); // пауза 3 сек между постами
  }
}

// ─── Настройка ───────────────────────────────────────────────────────────────

function SETUP_AUTOPOST_1_секреты() {
  /**
   * Запусти один раз — потом удали значения!
   */
  PropertiesService.getScriptProperties().setProperties({
    CHANNEL_ID:        "-1003877661204",         // chat_id канала (оставь свой)
    CHANNEL_USERNAME:  "LegalAutoParts24",        // username без @
    PUBLISHER_TOKEN:   "ВСТАВЬ_ТОКЕН_БОТА",       // токен бота который постит в канал
    MANAGER_USERNAME:  "LegalAuto247"             // username менеджера без @
  });
  Logger.log("✅ Секреты автопостинга сохранены.");
}

function SETUP_AUTOPOST_2_тест() {
  /**
   * Тест: берёт следующий товар и публикует.
   * Проверь канал после запуска.
   */
  autoPostOne();
  Logger.log("✅ Тест автопостинга завершён. Проверь канал.");
}

function SETUP_AUTOPOST_3_триггер() {
  /**
   * Автозапуск каждые N минут. По умолчанию — каждые 30 минут.
   * Измени everyMinutes() на нужный интервал.
   */

  // Удаляем старые триггеры autoPostOne
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "autoPostOne") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("autoPostOne")
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log("✅ Триггер автопостинга установлен: каждые 30 минут.");
}

function SETUP_AUTOPOST_4_стоп() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "autoPostOne") ScriptApp.deleteTrigger(t);
  });
  Logger.log("✅ Автопостинг остановлен.");
}

function SETUP_AUTOPOST_5_тест_AI() {
  /**
   * Тест AI генерации текста без реальной публикации.
   */
  var item = autoPostPickNext();
  if (!item) {
    Logger.log("❌ Нет доступных товаров для теста");
    return;
  }
  var text = autoPostGenerateText(item);
  Logger.log("=== AI ТЕКСТ ПОСТА ===\n\n" + text + "\n\n=== КОНЕЦ ===");
}

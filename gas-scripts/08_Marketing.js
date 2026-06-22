/**
 * LEGALAUTO CORE v1.2
 * Файл: 08_Marketing.js
 *
 * AI-агент маркетинга.
 * Генерирует контент-план, рекламные тексты, идеи акций.
 * Присылает план тебе в Telegram. Можно запрашивать прямо из бота.
 */

// ─── Контент-план на неделю ───────────────────────────────────────────────────

function marketingWeeklyPlan() {
  var catalog = marketingGetCatalogSummary();

  var systemPrompt =
    "Ты SMM-менеджер магазина автозапчастей LegalAuto в Telegram. " +
    "Магазин продаёт оригинальные б/у запчасти для BMW, Geely, Li Auto и других марок. " +
    "Аудитория: автовладельцы, СТО, перекупщики авто. " +
    "Составь конкретный контент-план на 7 дней для Telegram-канала. " +
    "Для каждого дня: тема поста + ключевая идея (2-3 строки). " +
    "Чередуй: товарные посты, полезный контент, вовлечение, акции. " +
    "Не пиши шаблонно — конкретные темы под этот магазин.";

  var userMessage =
    "Сделай контент-план на неделю. Данные о каталоге:\n" + catalog;

  try {
    var plan = laAskAI(systemPrompt, userMessage);
    var text = "📅 КОНТЕНТ-ПЛАН НА НЕДЕЛЮ\n\n" + plan;
    laSend(laSecret(LA.SECRETS.ADMIN_CHAT_ID), text);
    laSafeLog("INFO", "MARKETING", "Контент-план отправлен");
    return text;
  } catch (err) {
    var fallback = marketingFallbackPlan();
    laSend(laSecret(LA.SECRETS.ADMIN_CHAT_ID), fallback);
    return fallback;
  }
}

function marketingFallbackPlan() {
  return (
    "📅 КОНТЕНТ-ПЛАН НА НЕДЕЛЮ (шаблон)\n\n" +
    "Пн — Новое поступление: публикуй топовый товар\n" +
    "Вт — Полезно: «Как проверить запчасть при покупке»\n" +
    "Ср — Товар недели: лучшая цена из каталога\n" +
    "Чт — Вопрос-ответ: ответь на частые вопросы клиентов\n" +
    "Пт — Акция: скидка на категорию или бесплатная доставка\n" +
    "Сб — До/после: фото запчасти до и после установки\n" +
    "Вс — Розыгрыш или опрос: вовлечение аудитории"
  );
}

// ─── Рекламный текст под конкретный товар ────────────────────────────────────

function marketingAdText(params) {
  params = params || {};
  var name    = params.name    || "Запчасть";
  var car     = params.car     || "BMW";
  var oem     = params.oem     || "";
  var price   = params.price   || "";
  var format  = params.format  || "post"; // post | story | caption

  var systemPrompt = (
    format === "story"
      ? "Пиши короткий цепляющий текст для Stories в Telegram (до 3 строк, с эмодзи, призыв к действию)."
      : format === "caption"
      ? "Пиши подпись к фото товара (до 5 строк, конкретно: что, для кого, цена, как заказать)."
      : "Пиши продающий пост для Telegram-канала автозапчастей (до 10 строк, с эмодзи, конкретная ценность)."
  );

  var userMessage =
    "Товар: " + name + "\n" +
    "Авто: " + car + "\n" +
    (oem   ? "OEM: " + oem   + "\n" : "") +
    (price ? "Цена: " + price + " ₽\n" : "") +
    "Магазин: LegalAuto — оригинальные б/у запчасти, доставка по России.";

  try {
    return laAskAI(systemPrompt, userMessage);
  } catch (err) {
    return (
      "🔥 " + name + " для " + car + "\n\n" +
      "⚙️ Состояние: Оригинал Б/У\n" +
      (price ? "💰 Цена: " + price + " ₽\n" : "") +
      "🚚 Доставка по всей России\n\n" +
      "📲 Написать менеджеру"
    );
  }
}

// ─── Идея акции ───────────────────────────────────────────────────────────────

function marketingPromoIdea() {
  var catalog = marketingGetCatalogSummary();

  var prompt =
    "Ты маркетолог магазина автозапчастей. Придумай 3 конкретных акции которые можно запустить прямо сейчас " +
    "в Telegram-канале. Акции должны быть реалистичными, простыми в исполнении и направленными на продажу. " +
    "Для каждой: название, механика, призыв к действию. Без воды.";

  try {
    var ideas = laAskAI(prompt, "Данные каталога:\n" + catalog);
    var text = "💡 ИДЕИ АКЦИЙ\n\n" + ideas;
    laSend(laSecret(LA.SECRETS.ADMIN_CHAT_ID), text);
    return text;
  } catch (err) {
    var fallback =
      "💡 ИДЕИ АКЦИЙ\n\n" +
      "1. «Запчасть дня» — каждый день один товар со скидкой 10%. Ограничен временем.\n\n" +
      "2. «Подписчику скидка» — кто делает репост канала, получает -5% на заказ. Показывает скриншот.\n\n" +
      "3. «Найди дешевле — скинем разницу» — если клиент найдёт дешевле, возвращаем разницу.";
    laSend(laSecret(LA.SECRETS.ADMIN_CHAT_ID), fallback);
    return fallback;
  }
}

// ─── Анализ конкурентов (по запросу) ─────────────────────────────────────────

function marketingCompetitorAnalysis(competitor) {
  competitor = competitor || "авторазборка в Telegram";

  var prompt =
    "Ты маркетолог. Дай краткий анализ того чем LegalAuto (оригинальные б/у запчасти BMW, Geely, Li Auto, " +
    "доставка по России, Telegram Mini App, честные цены) отличается от конкурента: " + competitor + ". " +
    "Выдели 3 ключевых преимущества и 1 слабое место. Конкретно и коротко.";

  try {
    var result = laAskAI("Отвечай как опытный маркетолог. Кратко и по делу.", prompt);
    return "🔍 АНАЛИЗ vs " + competitor.toUpperCase() + "\n\n" + result;
  } catch (err) {
    return "❌ AI временно недоступен. Попробуй позже.";
  }
}

// ─── Обработка команд маркетинга из бота ─────────────────────────────────────

function marketingHandleCommand(text) {
  var lower = String(text || "").toLowerCase();

  if (lower.includes("контент-план") || lower.includes("контент план") || lower.includes("план на неделю")) {
    return marketingWeeklyPlan();
  }

  if (lower.includes("идею акции") || lower.includes("акцию") || lower.includes("акция")) {
    return marketingPromoIdea();
  }

  if (lower.includes("рекламный текст") || lower.includes("напиши пост")) {
    return "Напиши: «пост для [название товара] [авто] [цена]» и я сделаю текст.";
  }

  if (lower.startsWith("пост для ")) {
    var parts = text.slice(9).trim().split(" ");
    return marketingAdText({
      name: parts.slice(0, 2).join(" "),
      car:  parts.slice(2, 4).join(" "),
      format: "post"
    });
  }

  return null; // не наше — пусть обрабатывает другой агент
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

function marketingGetCatalogSummary() {
  try {
    var sheet = laSS().getSheets()[0];
    var data  = sheet.getDataRange().getValues();
    var h     = data[0].map(function(x) { return String(x).toLowerCase(); });

    var total    = data.length - 1;
    var catCol   = h.indexOf("category");
    var brandCol = h.indexOf("brand");

    var cats   = {};
    var brands = {};

    for (var i = 1; i < data.length; i++) {
      var cat   = catCol   >= 0 ? String(data[i][catCol]   || "Прочее") : "Прочее";
      var brand = brandCol >= 0 ? String(data[i][brandCol] || "")       : "";
      cats[cat]     = (cats[cat]     || 0) + 1;
      if (brand) brands[brand] = (brands[brand] || 0) + 1;
    }

    var topCats   = Object.keys(cats).sort(function(a, b) { return cats[b] - cats[a]; }).slice(0, 5);
    var topBrands = Object.keys(brands).sort(function(a, b) { return brands[b] - brands[a]; }).slice(0, 5);

    return (
      "Товаров в каталоге: " + total + "\n" +
      "Топ категорий: " + topCats.map(function(c) { return c + " (" + cats[c] + ")"; }).join(", ") + "\n" +
      "Марки: " + topBrands.map(function(b) { return b + " (" + brands[b] + ")"; }).join(", ")
    );
  } catch (err) {
    return "Данные каталога недоступны.";
  }
}

// ─── Настройка ───────────────────────────────────────────────────────────────

function SETUP_MARKETING_контент_план() {
  marketingWeeklyPlan();
  Logger.log("✅ Контент-план отправлен в Telegram.");
}

function SETUP_MARKETING_акция() {
  marketingPromoIdea();
  Logger.log("✅ Идеи акций отправлены в Telegram.");
}

function SETUP_MARKETING_триггер_план() {
  // Каждую пятницу в 10:00 — план на следующую неделю
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "marketingWeeklyPlan") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("marketingWeeklyPlan")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(10)
    .create();

  Logger.log("✅ Контент-план будет приходить каждую пятницу в 10:00.");
}

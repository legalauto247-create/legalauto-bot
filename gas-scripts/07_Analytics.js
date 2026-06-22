/**
 * LEGALAUTO CORE v1.2
 * Файл: 07_Analytics.js
 *
 * Агент аналитики продаж.
 * Считает статистику по каталогу, лидам, публикациям.
 * Отправляет отчёт тебе в Telegram каждую неделю.
 *
 * Запуск: вручную или триггер SETUP_ANALYTICS_триггер (каждый понедельник).
 */

// ─── Главный отчёт ────────────────────────────────────────────────────────────

function analyticsWeeklyReport() {
  var report = [];
  report.push("📊 ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ LEGALAUTO");
  report.push("📅 " + formatDate(new Date()));
  report.push("");

  // 1. Каталог
  try {
    var catalog = analyticsCatalog();
    report.push("━━━ КАТАЛОГ ━━━");
    report.push("📦 Всего товаров: " + catalog.total);
    report.push("✅ В наличии: " + catalog.inStock);
    report.push("👁 Видно в Mini App: " + catalog.visible);
    report.push("✅ Опубликовано в Telegram: " + catalog.published);
    report.push("📭 Не опубликовано: " + catalog.notPublished);
    report.push("🖼 Без фото: " + catalog.noPhoto);
    report.push("💰 Без цены: " + catalog.noPrice);
    if (catalog.totalValue > 0) {
      report.push("💎 Общая стоимость склада: " + catalog.totalValue.toLocaleString("ru-RU") + " ₽");
    }
    report.push("");
  } catch (err) {
    report.push("⚠️ Каталог: ошибка (" + err.message + ")");
    report.push("");
  }

  // 2. Топ категорий
  try {
    var cats = analyticsCategories();
    if (cats.length) {
      report.push("━━━ ТОП КАТЕГОРИЙ ━━━");
      cats.slice(0, 5).forEach(function(c, i) {
        report.push((i + 1) + ". " + c.name + " — " + c.count + " шт.");
      });
      report.push("");
    }
  } catch (err) {}

  // 3. Лиды за неделю
  try {
    var leads = analyticsLeads();
    report.push("━━━ ЗАЯВКИ (7 дней) ━━━");
    report.push("📥 Всего заявок: " + leads.total);
    report.push("✅ Найдено в каталоге: " + leads.found);
    report.push("📨 Передано менеджеру: " + leads.forwarded);
    if (leads.topRequests.length) {
      report.push("🔍 Частые запросы:");
      leads.topRequests.slice(0, 3).forEach(function(r) {
        report.push("  • " + r.text + " (" + r.count + "x)");
      });
    }
    report.push("");
  } catch (err) {
    report.push("📥 Заявки: нет данных");
    report.push("");
  }

  // 4. Качество каталога
  try {
    var quality = analyticsQuality();
    report.push("━━━ КАЧЕСТВО КАРТОЧЕК ━━━");
    report.push("🟢 Готово к продаже: " + quality.ready);
    report.push("🟡 Нужно доработать: " + quality.needFix);
    report.push("🔴 Черновики: " + quality.draft);
    report.push("");
  } catch (err) {}

  // 5. AI рекомендации
  try {
    var aiRec = analyticsAIRecommendations(report.join("\n"));
    report.push("━━━ AI РЕКОМЕНДУЕТ ━━━");
    report.push(aiRec);
    report.push("");
  } catch (err) {
    report.push("━━━ РЕКОМЕНДАЦИИ ━━━");
    report.push("• Заполни цены на все товары");
    report.push("• Добавь фото к позициям без фото");
    report.push("• Опубликуй неопубликованные товары");
    report.push("");
  }

  var fullReport = report.join("\n");
  laSend(laSecret(LA.SECRETS.ADMIN_CHAT_ID), fullReport);
  laSafeLog("INFO", "ANALYTICS", "Отчёт отправлен", { length: fullReport.length });
  return fullReport;
}

// ─── Анализ каталога ──────────────────────────────────────────────────────────

function analyticsCatalog() {
  var sheet = laSS().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x) { return String(x).toLowerCase(); });

  var col = {
    published:       h.indexOf("published"),
    miniapp_visible: h.indexOf("miniapp_visible"),
    qty:             h.indexOf("qty"),
    price:           h.indexOf("price"),
    photo_cover:     h.indexOf("photo_cover"),
    quality_status:  h.indexOf("quality_status")
  };

  var result = { total: 0, inStock: 0, visible: 0, published: 0, notPublished: 0, noPhoto: 0, noPrice: 0, totalValue: 0 };

  for (var i = 1; i < data.length; i++) {
    result.total++;
    var qty   = col.qty   >= 0 ? Number(data[i][col.qty]   || 0) : 1;
    var price = col.price >= 0 ? Number(data[i][col.price] || 0) : 0;

    if (qty > 0) result.inStock++;
    if (col.miniapp_visible >= 0 && String(data[i][col.miniapp_visible] || "").toUpperCase() !== "FALSE") result.visible++;
    if (col.published >= 0 && String(data[i][col.published] || "").toUpperCase() === "TRUE") result.published++;
    else result.notPublished++;
    if (col.photo_cover >= 0 && !String(data[i][col.photo_cover] || "").trim()) result.noPhoto++;
    if (price <= 0) result.noPrice++;
    result.totalValue += price * Math.max(qty, 1);
  }

  return result;
}

function analyticsCategories() {
  var sheet = laSS().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x) { return String(x).toLowerCase(); });
  var catCol = h.indexOf("category");
  if (catCol < 0) return [];

  var counts = {};
  for (var i = 1; i < data.length; i++) {
    var cat = String(data[i][catCol] || "Прочее").trim();
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return Object.keys(counts)
    .map(function(k) { return { name: k, count: counts[k] }; })
    .sort(function(a, b) { return b.count - a.count; });
}

function analyticsQuality() {
  var sheet = laSS().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x) { return String(x).toLowerCase(); });

  var scoreCol  = h.indexOf("catalog_score");
  var statusCol = h.indexOf("quality_status");
  var result = { ready: 0, needFix: 0, draft: 0 };

  for (var i = 1; i < data.length; i++) {
    var status = statusCol >= 0 ? String(data[i][statusCol] || "").toUpperCase() : "";
    var score  = scoreCol  >= 0 ? Number(data[i][scoreCol]  || 0) : 0;

    if (status === "READY" || score >= 100) result.ready++;
    else if (status === "NEED_FIX" || (score >= 60 && score < 100)) result.needFix++;
    else result.draft++;
  }

  return result;
}

// ─── Анализ лидов ─────────────────────────────────────────────────────────────

function analyticsLeads() {
  var ss = laSS();
  var sheet = ss.getSheetByName(LA.SHEETS.LEADS);
  var result = { total: 0, found: 0, forwarded: 0, topRequests: [] };

  if (!sheet || sheet.getLastRow() < 2) return result;

  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x) { return String(x).toLowerCase(); });

  var statusCol  = h.indexOf("status");
  var requestCol = h.indexOf("request");
  var dateCol    = h.indexOf("created_at");

  var weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  var requestCounts = {};

  for (var i = 1; i < data.length; i++) {
    var created = dateCol >= 0 ? new Date(data[i][dateCol]) : new Date();
    if (created < weekAgo) continue;

    result.total++;
    var status = statusCol >= 0 ? String(data[i][statusCol] || "").toUpperCase() : "";
    if (status === "FOUND") result.found++;
    if (status === "FORWARDED") result.forwarded++;

    if (requestCol >= 0) {
      var req = String(data[i][requestCol] || "").trim().toLowerCase().slice(0, 40);
      if (req) requestCounts[req] = (requestCounts[req] || 0) + 1;
    }
  }

  result.topRequests = Object.keys(requestCounts)
    .map(function(k) { return { text: k, count: requestCounts[k] }; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 5);

  return result;
}

// ─── AI рекомендации ─────────────────────────────────────────────────────────

function analyticsAIRecommendations(reportText) {
  var prompt =
    "Ты аналитик магазина автозапчастей. На основе этой статистики дай 3 конкретных рекомендации " +
    "что сделать на этой неделе чтобы увеличить продажи. Каждая рекомендация — 1-2 строки, конкретно и без воды.";

  return laAskAI(prompt, "Статистика магазина:\n\n" + reportText);
}

// ─── Быстрый отчёт по каталогу (для команды /analytics в боте) ───────────────

function analyticsQuickReport() {
  try {
    var c = analyticsCatalog();
    var q = analyticsQuality();
    return (
      "📊 Быстрая аналитика:\n\n" +
      "📦 Товаров: " + c.total + " (в наличии: " + c.inStock + ")\n" +
      "👁 В Mini App: " + c.visible + "\n" +
      "✅ Опубликовано: " + c.published + " / не опубликовано: " + c.notPublished + "\n" +
      "🖼 Без фото: " + c.noPhoto + " | без цены: " + c.noPrice + "\n\n" +
      "🟢 Готово: " + q.ready + " | 🟡 Доработать: " + q.needFix + " | 🔴 Черновики: " + q.draft
    );
  } catch (err) {
    return "❌ Ошибка аналитики: " + err.message;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
}

// ─── Настройка ───────────────────────────────────────────────────────────────

function SETUP_ANALYTICS_тест() {
  var report = analyticsWeeklyReport();
  Logger.log(report);
}

function SETUP_ANALYTICS_триггер() {
  // Удаляем старые
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "analyticsWeeklyReport") ScriptApp.deleteTrigger(t);
  });

  // Каждый понедельник в 9:00
  ScriptApp.newTrigger("analyticsWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  Logger.log("✅ Аналитика будет приходить каждый понедельник в 9:00.");
}

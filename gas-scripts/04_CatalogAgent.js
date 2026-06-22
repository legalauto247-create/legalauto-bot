/**
 * LEGALAUTO CORE v1.4
 * Файл: 04_CatalogAgent.js
 */

// ── Mini App / Website API — ?action=catalog ───────────────────────────────
function doGetCatalog(e) {
  try {
    const p      = (e && e.parameter) || {};
    const ss     = laSS();
    const sheet  = ss.getSheetByName("Parts") || ss.getSheets()[0];
    const data   = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return apiJsonResp({ ok: true, products: [], total: 0 });
    }

    // Строим маппинг заголовков
    const h = data[0].map(function(x) { return String(x).toLowerCase().trim(); });
    function col(name) { return h.indexOf(name); }

    // Фильтры из query params
    const filterBrand    = String(p.brand    || "").toLowerCase();
    const filterCategory = String(p.category || "").toLowerCase();
    const filterSearch   = String(p.search   || "").toLowerCase();
    const limitN         = Math.min(Number(p.limit || 200), 500);

    var products = [];

    for (var i = 1; i < data.length; i++) {
      var r = data[i];

      // Пропускаем строки без цены или нулевые
      var price = Number(r[col("price")] || 0);
      if (price <= 0) continue;

      // Фильтр miniapp_visible != FALSE
      var vis = String(r[col("miniapp_visible")] || "").toUpperCase();
      if (vis === "FALSE") continue;

      var brand = String(r[col("brand")] || "");
      var name  = String(r[col("name")]  || "");

      // Применяем фильтры
      if (filterBrand    && brand.toLowerCase() !== filterBrand) continue;
      if (filterCategory && String(r[col("category")] || "").toLowerCase().indexOf(filterCategory) < 0) continue;
      if (filterSearch) {
        var st = String(r[col("search_text")] || (brand + " " + name + " " + String(r[col("oem")] || ""))).toLowerCase();
        if (st.indexOf(filterSearch) < 0) continue;
      }

      products.push({
        id:            String(r[col("id")]            || (i)),
        brand:         brand,
        series:        String(r[col("series")]        || ""),
        category:      String(r[col("category")]      || ""),
        name:          name,
        oem:           String(r[col("oem")]           || ""),
        compatibility: String(r[col("compatibility")] || ""),
        condition:     String(r[col("condition")]     || "Б/У"),
        price:         price,
        qty:           Number(r[col("qty")]           || 0),
        photo_cover:   String(r[col("photo_cover")]   || r[col("photo")] || ""),
        photo_1:       String(r[col("photo_1")]       || ""),
        photo_2:       String(r[col("photo_2")]       || ""),
        photo_3:       String(r[col("photo_3")]       || ""),
        display_car:   String(r[col("display_car")]   || (brand + " " + String(r[col("series")] || "")).trim()),
        description:   String(r[col("description")]   || ""),
        search_text:   String(r[col("search_text")]   || ""),
        miniapp_visible: vis !== "FALSE",
      });

      if (products.length >= limitN) break;
    }

    // CORS header
    var output = ContentService
      .createTextOutput(JSON.stringify({ ok: true, products: products, total: products.length, version: LA.VERSION }))
      .setMimeType(ContentService.MimeType.JSON);
    return output;

  } catch (err) {
    return apiJsonResp({ ok: false, error: String(err), products: [] });
  }
}

// ── Аналитика каталога через AI ────────────────────────────────────────────
function catalogAgentAnswer(question) {
  const q = String(question || "").toLowerCase();
  const limit = extractLimit(q, 20);

  if (q.indexOf("без фото") !== -1 || q.indexOf("нет фото") !== -1 || q.indexOf("фото отсутств") !== -1) {
    return catalogNoPhoto(limit);
  }

  if (q.indexOf("не опублик") !== -1 || q.indexOf("не выстав") !== -1 || q.indexOf("не вылож") !== -1) {
    return catalogNotPublished(limit);
  }

  if (
    q.indexOf("маржин") !== -1 ||
    q.indexOf("прибыл") !== -1 ||
    q.indexOf("топ") !== -1 ||
    q.indexOf("самые дорог") !== -1 ||
    q.indexOf("дорогие") !== -1 ||
    q.indexOf("выбери") !== -1 ||
    q.indexOf("позици") !== -1
  ) {
    return catalogTopMargin(limit);
  }

  return null;
}

function extractLimit(text, defaultLimit) {
  const match = String(text || "").match(/\d+/);
  if (!match) return defaultLimit || 20;
  const n = Number(match[0]);
  if (!n || n < 1) return defaultLimit || 20;
  return Math.min(n, 100);
}

function catalogTopMargin(limit) {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);

  const nameCol = findCol(headers, ["name"]);
  const brandCol = findCol(headers, ["brand"]);
  const modelCol = findCol(headers, ["model"]);
  const oemCol = findCol(headers, ["oem"]);
  const priceCol = findCol(headers, ["price"]);
  const purchaseCol = findCol(headers, ["purchase_price"]);
  const marginCol = findCol(headers, ["margin"]);
  const qtyCol = findCol(headers, ["qty"]);
  const scoreCol = findCol(headers, ["catalog_score", "ready_score"]);

  if (priceCol < 0) return "❌ Не нашёл колонку price.";
  if (purchaseCol < 0) return catalogTopByPrice(limit);

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const price = toNumber(data[i][priceCol]);
    const purchase = toNumber(data[i][purchaseCol]);
    const qty = qtyCol >= 0 ? toNumber(data[i][qtyCol]) : 1;
    if (!price || !purchase || price <= purchase) continue;
    if (qtyCol >= 0 && qty <= 0) continue;

    const profit = price - purchase;
    const marginPercent = marginCol >= 0 && data[i][marginCol]
      ? toNumber(data[i][marginCol])
      : Math.round((profit / price) * 100);

    rows.push({
      name: nameCol >= 0 ? data[i][nameCol] : "Без названия",
      brand: brandCol >= 0 ? data[i][brandCol] : "",
      model: modelCol >= 0 ? data[i][modelCol] : "",
      oem: oemCol >= 0 ? data[i][oemCol] : "",
      price: price,
      purchase: purchase,
      profit: profit,
      margin: marginPercent,
      score: scoreCol >= 0 ? toNumber(data[i][scoreCol]) : 0
    });
  }

  rows.sort(function(a, b) { return b.profit - a.profit; });
  const top = rows.slice(0, limit || 20);
  if (!top.length) return catalogTopByPrice(limit);

  let text = "💰 Топ маржинальных позиций:\n\n";
  top.forEach(function(item, index) {
    text += formatCatalogLine(index, item) +
      "Закуп: " + item.purchase + " ₽ / Продажа: " + item.price + " ₽\n" +
      "Прибыль: " + item.profit + " ₽ / Маржа: " + item.margin + "%\n" +
      (item.score ? "Оценка карточки: " + item.score + "\n" : "") +
      "\n";
  });
  return text;
}

function catalogTopByPrice(limit) {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);

  const nameCol = findCol(headers, ["name"]);
  const brandCol = findCol(headers, ["brand"]);
  const modelCol = findCol(headers, ["model"]);
  const oemCol = findCol(headers, ["oem"]);
  const priceCol = findCol(headers, ["price"]);
  const qtyCol = findCol(headers, ["qty"]);
  const scoreCol = findCol(headers, ["catalog_score", "ready_score"]);

  if (priceCol < 0) return "❌ Не нашёл колонку price.";

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const price = toNumber(data[i][priceCol]);
    const qty = qtyCol >= 0 ? toNumber(data[i][qtyCol]) : 1;
    if (!price) continue;
    if (qtyCol >= 0 && qty <= 0) continue;
    rows.push({
      name: nameCol >= 0 ? data[i][nameCol] : "Без названия",
      brand: brandCol >= 0 ? data[i][brandCol] : "",
      model: modelCol >= 0 ? data[i][modelCol] : "",
      oem: oemCol >= 0 ? data[i][oemCol] : "",
      price: price,
      score: scoreCol >= 0 ? toNumber(data[i][scoreCol]) : 0
    });
  }

  rows.sort(function(a, b) { return b.price - a.price; });
  const top = rows.slice(0, limit || 20);
  if (!top.length) return "⚠️ Не нашёл товаров с ценой продажи.";

  let text = "⚠️ В таблице нет закупочной цены, поэтому реальную маржу посчитать нельзя.\n\n💰 Показываю топ по цене продажи:\n\n";
  top.forEach(function(item, index) {
    text += formatCatalogLine(index, item) +
      "Цена продажи: " + item.price + " ₽\n" +
      (item.score ? "Оценка карточки: " + item.score + "\n" : "") +
      "\n";
  });
  return text;
}

function catalogNoPhoto(limit) {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const nameCol = findCol(headers, ["name", "название", "наименование", "title"]);
  const oemCol = findCol(headers, ["oem", "артикул", "номер"]);
  const photoCol = findCol(headers, ["photo", "photo_cover", "фото", "image", "images", "ссылка"]);
  if (photoCol < 0) return "❌ Не нашёл колонку с фото.";
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!String(data[i][photoCol] || "").trim()) {
      rows.push({ name: nameCol >= 0 ? data[i][nameCol] : "Без названия", oem: oemCol >= 0 ? data[i][oemCol] : "" });
    }
  }
  return formatSimpleList("🖼 Позиции без фото", rows, limit || 20);
}

function catalogNotPublished(limit) {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const nameCol = findCol(headers, ["name", "название", "наименование", "title"]);
  const oemCol = findCol(headers, ["oem", "артикул", "номер"]);
  const pubCol = findCol(headers, ["published", "опубликовано", "telegram", "tg"]);
  if (pubCol < 0) return "❌ Не нашёл колонку публикации.";
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const value = String(data[i][pubCol] || "").toLowerCase();
    if (value !== "true" && value !== "да" && value !== "опубликовано") {
      rows.push({ name: nameCol >= 0 ? data[i][nameCol] : "Без названия", oem: oemCol >= 0 ? data[i][oemCol] : "" });
    }
  }
  return formatSimpleList("📭 Не опубликовано", rows, limit || 20);
}

function formatCatalogLine(index, item) {
  return (index + 1) + ". " + [item.brand, item.model, item.name].filter(Boolean).join(" ") + "\n" +
    (item.oem ? "OEM: " + item.oem + "\n" : "");
}

function findCol(headers, variants) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).toLowerCase().trim();
    for (let j = 0; j < variants.length; j++) {
      if (h === String(variants[j]).toLowerCase() || h.indexOf(String(variants[j]).toLowerCase()) !== -1) return i;
    }
  }
  return -1;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/\s/g, "").replace("₽", "").replace(",", ".").replace(/[^\d.]/g, "");
  return Number(cleaned || 0);
}

function formatSimpleList(title, rows, limit) {
  const top = rows.slice(0, limit || 20);
  if (!top.length) return title + ":\n\n✅ Не найдено.";
  let text = title + ":\n\n";
  top.forEach(function(item, index) {
    text += (index + 1) + ". " + item.name + "\n" + (item.oem ? "OEM: " + item.oem + "\n" : "") + "\n";
  });
  return text;
}

function TEST_показать_колонки() {
  const sheet = laSS().getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Колонки:");
  headers.forEach(function(h, i) { Logger.log((i + 1) + ": " + h); });
}

function TEST_маржа() {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  Logger.log("Всего строк: " + data.length);
  for (let i = 1; i < Math.min(15, data.length); i++) {
    Logger.log("Строка " + i + " | name=" + data[i][4] + " | price=" + data[i][6] + " | purchase=" + data[i][47] + " | margin=" + data[i][48]);
  }
}

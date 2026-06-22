/**
 * LEGALAUTO APPS SCRIPT API
 * Файл: 05_Api.js
 * Добавьте этот файл в проект Apps Script через VS Code и выполните clasp push.
 */

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || "health");
    const limit = Math.min(Number((e && e.parameter && e.parameter.limit) || 20), 100);

    if (action === "health") return apiJson({ ok: true, text: "LegalAuto API alive — " + LA.VERSION });
    if (action === "status") return apiJson({ ok: true, text: apiStatusText() });
    if (action === "products") return apiJson({ ok: true, text: apiProductsText() });
    if (action === "top_price") return apiJson({ ok: true, text: apiTopByPrice(limit) });
    if (action === "no_photo") return apiJson({ ok: true, text: apiNoPhoto(limit) });
    if (action === "not_published") return apiJson({ ok: true, text: apiNotPublished(limit) });

    return apiJson({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return apiJson({ ok: false, error: String(err), stack: err && err.stack ? err.stack : "" });
  }
}

function apiJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiSheetData() {
  const sheet = laSS().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  return { sheet: sheet, data: data, headers: headers };
}

function apiFindCol(headers, variants) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).toLowerCase().trim();
    for (let j = 0; j < variants.length; j++) {
      if (h === String(variants[j]).toLowerCase() || h.indexOf(String(variants[j]).toLowerCase()) !== -1) {
        return i;
      }
    }
  }
  return -1;
}

function apiToNumber(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "")
    .replace(/\s/g, "")
    .replace("₽", "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  return Number(cleaned || 0);
}

function apiStatusText() {
  const ss = laSS();
  return [
    "🔍 Статус LegalAuto:",
    "",
    "✅ Node Bot: работает",
    "✅ Apps Script API: работает",
    "✅ Google Sheets: работает",
    "📄 Таблица: " + ss.getName(),
    "Версия: " + LA.VERSION
  ].join("\n");
}

function apiProductsText() {
  const sheet = laSS().getSheets()[0];
  const rows = Math.max(sheet.getLastRow() - 1, 0);
  return [
    "📦 Товары:",
    "",
    "Основной лист: " + sheet.getName(),
    "Строк товаров: " + rows
  ].join("\n");
}

function apiTopByPrice(limit) {
  const ctx = apiSheetData();
  const data = ctx.data;
  const headers = ctx.headers;

  const nameCol = apiFindCol(headers, ["name"]);
  const brandCol = apiFindCol(headers, ["brand"]);
  const modelCol = apiFindCol(headers, ["model"]);
  const oemCol = apiFindCol(headers, ["oem"]);
  const priceCol = apiFindCol(headers, ["price"]);
  const qtyCol = apiFindCol(headers, ["qty"]);
  const scoreCol = apiFindCol(headers, ["catalog_score", "ready_score"]);

  if (priceCol < 0) return "❌ Не нашёл колонку price.";

  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const price = apiToNumber(data[i][priceCol]);
    const qty = qtyCol >= 0 ? apiToNumber(data[i][qtyCol]) : 1;
    if (!price) continue;
    if (qtyCol >= 0 && qty <= 0) continue;

    rows.push({
      name: nameCol >= 0 ? data[i][nameCol] : "Без названия",
      brand: brandCol >= 0 ? data[i][brandCol] : "",
      model: modelCol >= 0 ? data[i][modelCol] : "",
      oem: oemCol >= 0 ? data[i][oemCol] : "",
      price: price,
      score: scoreCol >= 0 ? apiToNumber(data[i][scoreCol]) : 0
    });
  }

  rows.sort(function(a, b) { return b.price - a.price; });

  const top = rows.slice(0, limit || 20);
  if (!top.length) return "⚠️ Не нашёл товаров с ценой.";

  let text =
    "⚠️ В таблице нет закупочной цены, поэтому реальную маржу посчитать нельзя.\n\n" +
    "💰 Показываю топ по цене продажи:\n\n";

  top.forEach(function(item, index) {
    text +=
      (index + 1) + ". " + [item.brand, item.model, item.name].filter(Boolean).join(" ") + "\n" +
      (item.oem ? "OEM: " + item.oem + "\n" : "") +
      "Цена продажи: " + item.price + " ₽\n" +
      (item.score ? "Оценка карточки: " + item.score + "\n" : "") +
      "\n";
  });

  return text;
}

function apiNoPhoto(limit) {
  const ctx = apiSheetData();
  const data = ctx.data;
  const headers = ctx.headers;

  const nameCol = apiFindCol(headers, ["name"]);
  const oemCol = apiFindCol(headers, ["oem"]);
  const photoCol = apiFindCol(headers, ["photo_cover", "photo", "фото"]);

  if (photoCol < 0) return "❌ Не нашёл колонку фото.";

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!String(data[i][photoCol] || "").trim()) {
      rows.push({
        name: nameCol >= 0 ? data[i][nameCol] : "Без названия",
        oem: oemCol >= 0 ? data[i][oemCol] : ""
      });
    }
  }

  return apiSimpleList("🖼 Товары без фото", rows, limit);
}

function apiNotPublished(limit) {
  const ctx = apiSheetData();
  const data = ctx.data;
  const headers = ctx.headers;

  const nameCol = apiFindCol(headers, ["name"]);
  const oemCol = apiFindCol(headers, ["oem"]);
  const publishedCol = apiFindCol(headers, ["published"]);

  if (publishedCol < 0) return "❌ Не нашёл колонку published.";

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const value = String(data[i][publishedCol] || "").toLowerCase();
    if (value !== "true" && value !== "да" && value !== "опубликовано") {
      rows.push({
        name: nameCol >= 0 ? data[i][nameCol] : "Без названия",
        oem: oemCol >= 0 ? data[i][oemCol] : ""
      });
    }
  }

  return apiSimpleList("📭 Не опубликовано", rows, limit);
}

function apiSimpleList(title, rows, limit) {
  const top = rows.slice(0, limit || 20);
  if (!top.length) return title + ":\n\n✅ Не найдено.";

  let text = title + ":\n\n";
  top.forEach(function(item, index) {
    text +=
      (index + 1) + ". " + item.name + "\n" +
      (item.oem ? "OEM: " + item.oem + "\n" : "") +
      "\n";
  });

  return text;
}

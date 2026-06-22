/**
 * LEGALAUTO CORE v1.8
 * Файл: 02_AdminBot.gs
 *
 * doGet — REST API для Node.js бота (Railway)
 * Поддерживаемые action:
 *   status, health, save_lead, leads, update_lead,
 *   cars, save_car, catalog, unpublished, mark_published,
 *   add_part, analytics, tasks, avito_feed, miniapp,
 *   search_oem, save_alert, get_alerts, delete_alerts
 */

/** Возвращает первый лист (Parts) */
function laPartsSheet() {
  return laSS().getSheets()[0];
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action ? e.parameter.action : "";
  const p = e && e.parameter ? e.parameter : {};

  // ── Статус / health check ─────────────────────────────────────────────────
  if (action === "status" || action === "health") {
    try {
      const ss           = laSS();
      const partsSheet   = laPartsSheet();
      const clientsSheet = ss.getSheetByName("CLIENTS");
      const partsCount   = partsSheet ? Math.max(0, partsSheet.getLastRow() - 1) : 0;
      const leadsCount   = clientsSheet ? Math.max(0, clientsSheet.getLastRow() - 1) : 0;
      const pubCount = (function() {
        if (!partsSheet || partsSheet.getLastRow() < 2) return 0;
        const vals    = partsSheet.getDataRange().getValues();
        const headers = vals[0].map(function(h) { return String(h).toLowerCase(); });
        const pubCol  = headers.indexOf("published");
        if (pubCol < 0) return 0;
        return vals.slice(1).filter(function(r) {
          return String(r[pubCol] || "").toUpperCase() === "TRUE";
        }).length;
      })();
      return apiJsonResp({
        ok: true,
        version: LA.VERSION,
        parts_total:     partsCount,
        parts_published: pubCount,
        leads_total:     leadsCount
      });
    } catch (err) {
      return apiJsonResp({ ok: true, parts_total: 0, parts_published: 0, leads_total: 0, error: String(err) });
    }
  }

  // ── Сохранить заявку клиента ──────────────────────────────────────────────
  if (action === "save_lead") {
    try {
      const sheet = laSheet("CLIENTS", [
        "created_at","source","chat_id","username","car","client","phone","stage","data","status"
      ]);
      sheet.appendRow([
        new Date(),
        String(p.source   || ""),
        String(p.chat_id  || ""),
        String(p.username || ""),
        String(p.car      || ""),
        String(p.client   || ""),
        String(p.phone    || ""),
        String(p.stage    || ""),
        String(p.data     || "").substring(0, 1000),
        "new"
      ]);
      laSafeLog("INFO", "CLIENT_BOT", "Новая заявка", { source: p.source, chat_id: p.chat_id });
      return apiJsonResp({ ok: true });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Последние заявки ──────────────────────────────────────────────────────
  if (action === "leads") {
    try {
      const sheet = laSS().getSheetByName("CLIENTS");
      if (!sheet || sheet.getLastRow() < 2) return apiJsonResp({ ok: true, leads: [] });
      const rows    = sheet.getDataRange().getValues();
      const headers = rows[0];
      const leads   = rows.slice(1).reverse().slice(0, 50).map(function(r) {
        var obj = {};
        headers.forEach(function(h, i) {
          obj[h] = (r[i] instanceof Date) ? r[i].toISOString() : r[i];
        });
        return obj;
      });
      return apiJsonResp({ ok: true, leads: leads });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Обновить статус заявки ────────────────────────────────────────────────
  if (action === "update_lead") {
    try {
      const sheet = laSS().getSheetByName("CLIENTS");
      if (!sheet || sheet.getLastRow() < 2) return apiJsonResp({ ok: false, error: "Нет заявок" });
      const rows    = sheet.getDataRange().getValues();
      const headers = rows[0];
      const chatCol = headers.indexOf("chat_id");
      const stCol   = headers.indexOf("status");
      if (chatCol < 0 || stCol < 0) return apiJsonResp({ ok: false, error: "Колонки не найдены" });
      const chatId    = String(p.chat_id  || "").trim();
      const newStatus = String(p.status   || "work").trim();
      var updated = 0;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][chatCol]).trim() === chatId) {
          sheet.getRange(i + 1, stCol + 1).setValue(newStatus);
          updated++;
        }
      }
      return apiJsonResp({ ok: true, updated: updated });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── CRM: авто в работе ────────────────────────────────────────────────────
  if (action === "cars") {
    try {
      const sheet = laSS().getSheetByName("CARS");
      if (!sheet || sheet.getLastRow() < 2) return apiJsonResp({ ok: true, cars: [] });
      const rows    = sheet.getDataRange().getValues();
      const headers = rows[0];
      const cars    = rows.slice(1).reverse().slice(0, 30).map(function(r) {
        var obj = {};
        headers.forEach(function(h, i) {
          obj[h] = (r[i] instanceof Date) ? r[i].toISOString() : r[i];
        });
        return obj;
      });
      return apiJsonResp({ ok: true, cars: cars });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── CRM: сохранить авто ───────────────────────────────────────────────────
  if (action === "save_car") {
    try {
      const sheet = laSheet("CARS", [
        "created_at","chat_id","car","client","phone","stage","note","date"
      ]);
      sheet.appendRow([
        new Date(),
        String(p.chat_id || ""),
        String(p.car     || ""),
        String(p.client  || ""),
        String(p.phone   || ""),
        String(p.stage   || ""),
        String(p.note    || "").substring(0, 500),
        String(p.date    || "")
      ]);
      laSafeLog("INFO", "CRM", "Авто добавлено", { car: p.car, chat_id: p.chat_id });
      return apiJsonResp({ ok: true });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Задачи агентов ────────────────────────────────────────────────────────
  if (action === "tasks") {
    try {
      const sheet = laSS().getSheetByName("AGENT_TASKS");
      if (!sheet || sheet.getLastRow() < 2) return apiJsonResp({ ok: true, tasks: [] });
      const rows    = sheet.getDataRange().getValues();
      const headers = rows[0];
      const tasks   = rows.slice(1).reverse().slice(0, 20).map(function(r) {
        var obj = {};
        headers.forEach(function(h, i) {
          obj[h] = (r[i] instanceof Date) ? r[i].toISOString() : r[i];
        });
        return obj;
      });
      return apiJsonResp({ ok: true, tasks: tasks });
    } catch (err) {
      return apiJsonResp({ ok: true, tasks: [], error: String(err) });
    }
  }

  // ── Неопубликованные запчасти ─────────────────────────────────────────────
  if (action === "unpublished") {
    try {
      const sheet = laPartsSheet();
      if (!sheet) return apiJsonResp({ ok: false, error: "Лист Parts не найден" });
      const rows    = sheet.getDataRange().getValues();
      if (rows.length < 2) return apiJsonResp({ ok: true, parts: [], total: 0 });
      // toLowerCase чтобы не зависеть от регистра заголовков в таблице
      const headers = rows[0].map(function(h) { return String(h).toLowerCase().trim(); });
      const colIdx  = function(name) { return headers.indexOf(name.toLowerCase()); };
      // Собираем post_hash всех уже опубликованных (дубль-проверка как в TelegramPublisher.gs)
      var publishedHashes = {};
      for (var j = 1; j < rows.length; j++) {
        var pubJ = String(rows[j][colIdx("published")] || "").trim().toUpperCase();
        if (pubJ !== "TRUE") continue;
        var hashJ = String(rows[j][colIdx("post_hash")] || "").trim();
        if (hashJ) publishedHashes[hashJ] = true;
      }
      var parts = [];
      for (var i = 1; i < rows.length; i++) {
        var pub = String(rows[i][colIdx("published")] || "").trim().toUpperCase();
        if (pub === "TRUE" || pub === "SKIP" || pub === "DUPLICATE" || pub === "ERROR" || pub === "PROCESSING") continue;
        var vis = String(rows[i][colIdx("miniapp_visible")] || "").toUpperCase();
        if (vis === "FALSE") continue;
        var price = Number(rows[i][colIdx("price")] || 0);
        if (price <= 0) continue;
        var qty = Number(rows[i][colIdx("qty")] || 0);
        if (qty <= 0) continue;
        // Дубль-проверка по post_hash (как в оригинальном TelegramPublisher.gs)
        var rowCar  = String(rows[i][colIdx("display_car")] || "").trim();
        var rowOem  = String(rows[i][colIdx("oem")] || "").trim();
        var rowHash = String(rows[i][colIdx("post_hash")] || "").trim() || (rowCar + "|" + rowOem);
        if (rowHash && publishedHashes[rowHash]) {
          var dupCol = colIdx("published");
          if (dupCol >= 0) sheet.getRange(i + 1, dupCol + 1).setValue("DUPLICATE");
          continue;
        }
        var part = {};
        headers.forEach(function(h, idx) {
          var v = rows[i][idx];
          part[h] = (v instanceof Date) ? v.toISOString() : v;
        });
        part._row = i + 1;
        parts.push(part);
        var limit = Number(p.limit || 200);
        if (parts.length >= limit) break;
      }
      return apiJsonResp({ ok: true, parts: parts, total: parts.length });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Отметить запчасть опубликованной ─────────────────────────────────────
  if (action === "mark_published") {
    try {
      const sheet   = laPartsSheet();
      if (!sheet) return apiJsonResp({ ok: false, error: "Лист Parts не найден" });
      const rows    = sheet.getDataRange().getValues();
      const headers = rows[0].map(function(h) { return String(h).toLowerCase().trim(); });
      const col     = function(name) { return headers.indexOf(name.toLowerCase()); };
      var rowNum    = Number(p.row || 0);
      var oem       = String(p.oem || "").trim().toUpperCase();
      if (!rowNum && oem) {
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][col("oem")] || "").trim().toUpperCase() === oem) {
            rowNum = i + 1; break;
          }
        }
      }
      if (!rowNum) return apiJsonResp({ ok: false, error: "Строка не найдена" });
      var setCell = function(colName, value) {
        var c = col(colName); if (c >= 0) sheet.getRange(rowNum, c + 1).setValue(value);
      };
      // Поддержка status: TRUE / ERROR / PROCESSING (для антидублей)
      var pubStatus = String(p.status || "TRUE").trim().toUpperCase();
      if (pubStatus !== "TRUE" && pubStatus !== "ERROR" && pubStatus !== "PROCESSING") pubStatus = "TRUE";
      setCell("published",           pubStatus);
      setCell("published_at",        new Date());
      setCell("telegram_post",       String(p.post_link  || ""));
      setCell("telegram_message_id", String(p.message_id || ""));
      // Пишем post_hash при успешной публикации (для дубль-детекции в следующих запросах)
      if (pubStatus === "TRUE" && p.post_hash) {
        setCell("post_hash", String(p.post_hash));
      }
      return apiJsonResp({ ok: true, row: rowNum });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Добавить запчасть ─────────────────────────────────────────────────────
  if (action === "add_part") {
    try {
      const sheet   = laPartsSheet();
      if (!sheet) return apiJsonResp({ ok: false, error: "Лист Parts не найден" });
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const col     = function(name) { return headers.indexOf(name); };
      var newRow    = new Array(headers.length).fill("");
      var set       = function(name, val) { var c = col(name); if (c >= 0) newRow[c] = val; };
      set("created_at",      new Date());
      set("brand",           String(p.brand       || ""));
      set("series",          String(p.series      || ""));
      set("name",            String(p.name        || ""));
      set("category",        String(p.category    || ""));
      set("oem",             String(p.oem         || ""));
      set("price",           Number(p.price       || 0));
      set("qty",             Number(p.qty         || 1));
      set("condition",       String(p.condition   || "Оригинал Б/У"));
      set("description",     String(p.description || ""));
      set("compatibility",   String(p.compat      || ""));
      set("photo_cover",     String(p.photo_1     || ""));
      set("photo_1",         String(p.photo_1     || ""));
      set("photo_2",         String(p.photo_2     || ""));
      set("photo_3",         String(p.photo_3     || ""));
      set("published",       "FALSE");
      set("miniapp_visible", "TRUE");
      sheet.appendRow(newRow);
      return apiJsonResp({ ok: true, brand: p.brand, name: p.name });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Статистика аналитики ──────────────────────────────────────────────────
  if (action === "analytics") {
    return doGetAnalytics(p);
  }

  // ── Каталог для Mini App и Node.js ────────────────────────────────────────
  if (action === "catalog") {
    return doGetCatalog(e);
  }

  // ── Поиск по OEM артикулу ─────────────────────────────────────────────────
  if (action === "search_oem") {
    try {
      var rawOem = String(p.oem || "").replace(/[\s\-\.]/g, "").toUpperCase();
      if (!rawOem) return apiJsonResp({ ok: false, error: "OEM не указан" });

      var sheet   = laPartsSheet();
      if (!sheet) return apiJsonResp({ ok: false, error: "Лист Parts не найден" });
      var rows    = sheet.getDataRange().getValues();
      if (rows.length < 2) return apiJsonResp({ ok: true, products: [], total: 0 });

      var headers = rows[0].map(function(h) { return String(h).toLowerCase().trim(); });
      var col     = function(name) { return headers.indexOf(name); };

      var oemCol   = col("oem");
      var nameCol  = col("name");
      var brandCol = col("brand");
      var priceCol = col("price");
      var condCol  = col("condition");
      var qtyCol   = col("qty");
      var photoCol = col("photo_cover");

      var found = [];
      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        // Нормализуем OEM из таблицы: убираем пробелы, дефисы, точки → uppercase
        var cellOem = String(r[oemCol >= 0 ? oemCol : -1] || "")
          .replace(/[\s\-\.]/g, "").toUpperCase();
        if (!cellOem) continue;
        // Совпадение: точное или подстрока
        if (cellOem !== rawOem && cellOem.indexOf(rawOem) < 0 && rawOem.indexOf(cellOem) < 0) continue;

        var price = Number(r[priceCol >= 0 ? priceCol : -1] || 0);
        var obj   = {
          id:        String(i + 1),
          name:      nameCol  >= 0 ? String(r[nameCol]  || "") : "",
          brand:     brandCol >= 0 ? String(r[brandCol] || "") : "",
          oem:       String(r[oemCol >= 0 ? oemCol : 0]  || ""),
          price:     price,
          condition: condCol  >= 0 ? String(r[condCol]  || "") : "",
          qty:       qtyCol   >= 0 ? Number(r[qtyCol]   || 0)  : 0,
          photo:     photoCol >= 0 ? String(r[photoCol] || "") : "",
        };
        found.push(obj);
        if (found.length >= 20) break;
      }
      return apiJsonResp({ ok: true, products: found, total: found.length, oem: rawOem });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err), products: [] });
    }
  }

  // ── Alert subscriptions ───────────────────────────────────────────────────
  if (action === "save_alert") {
    try {
      var ss = laSS();
      var alertSheet = ss.getSheetByName("ALERTS");
      if (!alertSheet) {
        alertSheet = ss.insertSheet("ALERTS");
        alertSheet.appendRow(["chat_id","query","keywords","created_at"]);
      }
      var chatId   = String(p.chat_id   || "").trim();
      var query    = String(p.query     || "").trim();
      var keywords = String(p.keywords  || "").trim();
      if (!chatId || !query) return apiJsonResp({ ok: false, error: "chat_id and query required" });
      alertSheet.appendRow([chatId, query, keywords, new Date().toISOString()]);
      return apiJsonResp({ ok: true });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  if (action === "get_alerts") {
    try {
      var ss2 = laSS();
      var aSheet = ss2.getSheetByName("ALERTS");
      if (!aSheet || aSheet.getLastRow() < 2) return apiJsonResp({ ok: true, alerts: [] });
      var aRows = aSheet.getDataRange().getValues();
      var aHdr  = aRows[0].map(function(h){ return String(h).toLowerCase(); });
      var alerts = aRows.slice(1).map(function(r) {
        var obj = {};
        aHdr.forEach(function(h, i){ obj[h] = r[i]; });
        return obj;
      });
      return apiJsonResp({ ok: true, alerts: alerts });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  if (action === "delete_alerts") {
    try {
      var ss3 = laSS();
      var dSheet = ss3.getSheetByName("ALERTS");
      if (!dSheet || dSheet.getLastRow() < 2) return apiJsonResp({ ok: true, deleted: 0 });
      var chatIdDel = String(p.chat_id || "").trim();
      if (!chatIdDel) return apiJsonResp({ ok: false, error: "chat_id required" });
      var dRows = dSheet.getDataRange().getValues();
      var dHdr  = dRows[0].map(function(h){ return String(h).toLowerCase(); });
      var cidCol = dHdr.indexOf("chat_id");
      var deleted = 0;
      // Delete bottom-up to preserve row indices
      for (var di = dRows.length - 1; di >= 1; di--) {
        if (String(dRows[di][cidCol]).trim() === chatIdDel) {
          dSheet.deleteRow(di + 1);
          deleted++;
        }
      }
      return apiJsonResp({ ok: true, deleted: deleted });
    } catch (err) {
      return apiJsonResp({ ok: false, error: String(err) });
    }
  }

  // ── Реферальная система ───────────────────────────────────────────────────
  if (action === "save_referral") {
    try {
      var refSheet = laSheet("REFERRALS", ["ref_code","inviter_id","friend_id","joined_at","lead_created","rewarded"]);
      // Проверяем нет ли уже такого кода
      var rRows = refSheet.getLastRow() > 1 ? refSheet.getDataRange().getValues() : [["ref_code"]];
      for (var ri = 1; ri < rRows.length; ri++) {
        if (String(rRows[ri][0]) === String(p.ref_code)) return apiJsonResp({ ok: true, existed: true });
      }
      refSheet.appendRow([p.ref_code || "", p.inviter_id || "", "", new Date().toISOString(), "", ""]);
      return apiJsonResp({ ok: true });
    } catch (err) { return apiJsonResp({ ok: false, error: String(err) }); }
  }

  if (action === "save_referral_friend") {
    try {
      var rfSheet = laSS().getSheetByName("REFERRALS");
      if (!rfSheet) return apiJsonResp({ ok: false, error: "no sheet" });
      var rfRows = rfSheet.getDataRange().getValues();
      for (var rfi = 1; rfi < rfRows.length; rfi++) {
        if (String(rfRows[rfi][0]) === String(p.ref_code)) {
          rfSheet.getRange(rfi + 1, 3).setValue(p.friend_id || "");
          rfSheet.getRange(rfi + 1, 4).setValue(new Date().toISOString());
          return apiJsonResp({ ok: true });
        }
      }
      return apiJsonResp({ ok: false, error: "code not found" });
    } catch (err) { return apiJsonResp({ ok: false, error: String(err) }); }
  }

  if (action === "mark_referral_rewarded") {
    try {
      var mrSheet = laSS().getSheetByName("REFERRALS");
      if (!mrSheet) return apiJsonResp({ ok: false });
      var mrRows = mrSheet.getDataRange().getValues();
      for (var mri = 1; mri < mrRows.length; mri++) {
        if (String(mrRows[mri][0]) === String(p.ref_code)) {
          mrSheet.getRange(mri + 1, 5).setValue("TRUE");
          mrSheet.getRange(mri + 1, 6).setValue("TRUE");
          return apiJsonResp({ ok: true });
        }
      }
      return apiJsonResp({ ok: false });
    } catch (err) { return apiJsonResp({ ok: false, error: String(err) }); }
  }

  if (action === "get_referral") {
    try {
      var grSheet = laSS().getSheetByName("REFERRALS");
      if (!grSheet || grSheet.getLastRow() < 2) return apiJsonResp({});
      var grRows = grSheet.getDataRange().getValues();
      var grHdr  = grRows[0];
      for (var gri = 1; gri < grRows.length; gri++) {
        if (String(grRows[gri][0]) === String(p.ref_code)) {
          var obj = {};
          grHdr.forEach(function(h, i) { obj[h] = grRows[gri][i]; });
          return apiJsonResp(obj);
        }
      }
      return apiJsonResp({});
    } catch (err) { return apiJsonResp({ error: String(err) }); }
  }

  if (action === "get_referral_code") {
    try {
      var gcSheet = laSS().getSheetByName("REFERRALS");
      if (!gcSheet || gcSheet.getLastRow() < 2) return apiJsonResp({});
      var gcRows = gcSheet.getDataRange().getValues();
      for (var gci = 1; gci < gcRows.length; gci++) {
        if (String(gcRows[gci][1]) === String(p.inviter_id) && !gcRows[gci][2]) {
          return apiJsonResp({ code: gcRows[gci][0] });
        }
      }
      return apiJsonResp({});
    } catch (err) { return apiJsonResp({}); }
  }

  if (action === "get_all_referrals") {
    try {
      var gaSheet = laSS().getSheetByName("REFERRALS");
      if (!gaSheet || gaSheet.getLastRow() < 2) return apiJsonResp({ referrals: [] });
      var gaRows = gaSheet.getDataRange().getValues();
      var gaHdr  = gaRows[0];
      var refs   = gaRows.slice(1).map(function(r) {
        var o = {}; gaHdr.forEach(function(h, i) { o[h] = r[i]; }); return o;
      });
      return apiJsonResp({ referrals: refs });
    } catch (err) { return apiJsonResp({ referrals: [], error: String(err) }); }
  }

  if (action === "get_user_referrals") {
    try {
      var guSheet = laSS().getSheetByName("REFERRALS");
      if (!guSheet || guSheet.getLastRow() < 2) return apiJsonResp({ total: 0, leads: 0, rewarded: 0 });
      var guRows  = guSheet.getDataRange().getValues().slice(1);
      var myRefs  = guRows.filter(function(r) { return String(r[1]) === String(p.inviter_id); });
      var leads   = myRefs.filter(function(r) { return String(r[4]) === "TRUE"; }).length;
      var rewarded= myRefs.filter(function(r) { return String(r[5]) === "TRUE"; }).length;
      return apiJsonResp({ total: myRefs.length, leads: leads, rewarded: rewarded });
    } catch (err) { return apiJsonResp({ total: 0 }); }
  }

  if (action === "get_referral_stats") {
    try {
      var gsSheet = laSS().getSheetByName("REFERRALS");
      if (!gsSheet || gsSheet.getLastRow() < 2) return apiJsonResp({ total: 0 });
      var gsRows = gsSheet.getDataRange().getValues().slice(1);
      // Топ-5 рефереров
      var counts = {};
      gsRows.forEach(function(r) {
        var inv = String(r[1]);
        if (inv) counts[inv] = (counts[inv] || 0) + 1;
      });
      var top = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
      return apiJsonResp({
        total:    gsRows.filter(function(r) { return r[2]; }).length,
        rewarded: gsRows.filter(function(r) { return String(r[5]) === "TRUE"; }).length,
        top:      top.map(function(t) { return { inviter_id: t[0], count: t[1] }; }),
      });
    } catch (err) { return apiJsonResp({ total: 0 }); }
  }

  // ── Авито (деактивировано) ────────────────────────────────────────────────
  if (action === "avito_feed") {
    return apiJsonResp({ ok: false, error: "Авито временно деактивировано" });
  }

  // ── Mini App HTML ─────────────────────────────────────────────────────────
  if (action === "miniapp" || action === "") {
    try {
      return HtmlService.createHtmlOutputFromFile("MiniApp")
        .setTitle("LegalAuto — Каталог запчастей")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err) {
      return ContentService.createTextOutput("LegalAuto Core v1.8 OK").setMimeType(ContentService.MimeType.TEXT);
    }
  }

  return apiJsonResp({ ok: false, error: "Unknown action: " + action });
}


// ── Analytics ─────────────────────────────────────────────────────────────────
function doGetAnalytics(p) {
  try {
    const ss         = laSS();
    const partsSheet = laPartsSheet();
    const rows       = partsSheet.getDataRange().getValues();
    const headers    = rows[0].map(function(h) { return String(h).toLowerCase(); });
    const col        = function(name) { return headers.indexOf(name); };

    var brandsSet = {}, catsSet = {}, pubCount = 0, totalPrice = 0, priceCount = 0;
    rows.slice(1).forEach(function(r) {
      var brand = String(r[col("brand")] || "").trim();
      var cat   = String(r[col("category")] || "").trim();
      var pub   = String(r[col("published")] || "").toUpperCase();
      var price = Number(r[col("price")] || 0);
      if (brand) brandsSet[brand] = (brandsSet[brand] || 0) + 1;
      if (cat)   catsSet[cat]     = (catsSet[cat]   || 0) + 1;
      if (pub === "TRUE") pubCount++;
      if (price > 0) { totalPrice += price; priceCount++; }
    });

    const clientsSheet = ss.getSheetByName("CLIENTS");
    const leadsCount   = clientsSheet ? Math.max(0, clientsSheet.getLastRow() - 1) : 0;

    return apiJsonResp({
      ok: true,
      parts_total:     rows.length - 1,
      parts_published: pubCount,
      leads_total:     leadsCount,
      avg_price:       priceCount ? Math.round(totalPrice / priceCount) : 0,
      brands:          brandsSet,
      categories:      catsSet
    });
  } catch (err) {
    return apiJsonResp({ ok: false, error: String(err) });
  }
}


// ── doGetCatalog (используется из 04_CatalogAgent.gs или определена здесь) ───
// Если 04_CatalogAgent.gs есть в проекте — эта функция уже определена там.
// Если нет — раскомментируй и используй:
/*
function doGetCatalog(e) {
  try {
    const p      = (e && e.parameter) || {};
    const sheet  = laPartsSheet();
    const data   = sheet.getDataRange().getValues();
    if (data.length < 2) return apiJsonResp({ ok: true, products: [], total: 0 });
    const h = data[0].map(function(x) { return String(x).toLowerCase().trim(); });
    function col(name) { return h.indexOf(name); }
    const limitN = Math.min(Number(p.limit || 200), 500);
    var products = [];
    for (var i = 1; i < data.length; i++) {
      var price = Number(data[i][col("price")] || 0);
      if (price <= 0) continue;
      var vis = String(data[i][col("miniapp_visible")] || "").toUpperCase();
      if (vis === "FALSE") continue;
      var brand = String(data[i][col("brand")] || "");
      var filterBrand = String(p.brand || "").toLowerCase();
      if (filterBrand && brand.toLowerCase() !== filterBrand) continue;
      products.push({
        id:          String(data[i][col("id")] || i),
        brand:       brand,
        series:      String(data[i][col("series")]      || ""),
        category:    String(data[i][col("category")]    || ""),
        name:        String(data[i][col("name")]        || ""),
        oem:         String(data[i][col("oem")]         || ""),
        condition:   String(data[i][col("condition")]   || "Б/У"),
        price:       price,
        qty:         Number(data[i][col("qty")]         || 0),
        photo_cover: String(data[i][col("photo_cover")] || data[i][col("photo")] || ""),
        photo_1:     String(data[i][col("photo_1")]     || ""),
        photo_2:     String(data[i][col("photo_2")]     || ""),
        display_car: String(data[i][col("display_car")] || (brand + " " + String(data[i][col("series")] || "")).trim()),
        description: String(data[i][col("description")] || ""),
        miniapp_visible: vis !== "FALSE"
      });
      if (products.length >= limitN) break;
    }
    return apiJsonResp({ ok: true, products: products, total: products.length });
  } catch (err) {
    return apiJsonResp({ ok: false, error: String(err), products: [] });
  }
}
*/


// ── Legacy doPost ─────────────────────────────────────────────────────────────
function doPost(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function laSend(chatId, text) {
  const token = PropertiesService.getScriptProperties().getProperty(LA.SECRETS.ADMIN_BOT_TOKEN);
  if (!token) return;
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ chat_id: String(chatId), text: String(text || ""), disable_web_page_preview: true }),
    muteHttpExceptions: true
  });
}

function laOk() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

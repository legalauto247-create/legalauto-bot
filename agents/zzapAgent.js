/**
 * LegalAuto — ZZap.ru Search Agent (Puppeteer)
 *
 * ZZap — AJAX-сайт на DevExpress ASP.NET: данные грузятся через XHR после загрузки страницы.
 * Используем Puppeteer для рендеринга JS и извлечения DOM.
 *
 * Клиент видит: топ-10 результатов с наценкой +25% («Наша цена»)
 * Менеджер видит: реальные цены + ссылки на ZZap
 */

import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

// ── AI: найти OEM номер по описанию запчасти ─────────────────────────────────
async function findOemByAI(partName, make, model, year) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content:
            `Найди OEM номер запчасти для поиска на zzap.ru.\n` +
            `Отвечай ТОЛЬКО номером (цифры/буквы/дефисы), без пояснений.\n` +
            `Если знаешь несколько — перечисли через запятую (макс 3).\n` +
            `Если не знаешь точно — ответь "unknown".\n\n` +
            `Запчасть: ${partName}\n` +
            (make  ? `Марка: ${make}\n`   : '') +
            (model ? `Модель: ${model}\n` : '') +
            (year  ? `Год: ${year}\n`     : '') +
            `\nOEM:`
        }]
      })
    });
    const data = await resp.json();
    const raw  = data.content?.[0]?.text?.trim() || '';
    if (!raw || raw.toLowerCase() === 'unknown') return null;
    // Берём первый номер (самый вероятный)
    const oems = raw.split(',').map(s => s.trim()).filter(s => s.length >= 5);
    return oems[0] || null;
  } catch {
    return null;
  }
}

// Найти путь к Chromium (Nix / apt / Google Chrome)
function findChromium() {
  // 1. Явная переменная окружения (приоритет)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_PATH)               return process.env.CHROME_PATH;
  if (process.env.CHROMIUM_PATH)             return process.env.CHROMIUM_PATH;

  // 2. which chromium / google-chrome
  for (const cmd of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      const p = execSync(`which ${cmd} 2>/dev/null`).toString().trim();
      if (p) return p;
    } catch (_) {}
  }

  // 3. Nix store — Railway nixpacks ставит chromium сюда
  try {
    const p = execSync(
      'find /nix/store -maxdepth 4 -name "chromium" -type f 2>/dev/null | head -1'
    ).toString().trim();
    if (p) return p;
  } catch (_) {}

  // 4. Известные пути
  for (const p of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/local/bin/chromium',
  ]) {
    try {
      execSync(`test -x "${p}"`);
      // Проверяем что это не snap-заглушка
      const info = execSync(`file "${p}" 2>/dev/null`).toString();
      if (!info.includes('shell script') && !info.includes('ASCII text')) return p;
    } catch (_) {}
  }

  return null;
}

// ── Построить URL для поиска на ZZap ──────────────────────────────────────────
export function buildZzapUrls({ make, model, year, partName, oem, vin }) {
  const urls = [];

  if (oem) {
    urls.push({
      label: `🔢 OEM: ${oem}`,
      url:   `https://www.zzap.ru/public/search.aspx#rawdata=${encodeURIComponent(oem)}`
    });
  }

  const phrase = [partName, make, model, year].filter(Boolean).join(' ');
  if (phrase) {
    // Текстовый поиск через exist.ru (работает без OEM)
    urls.push({
      label: `🔍 Exist: ${(partName || '').substring(0, 20)}`,
      url:   `https://exist.ru/?q=${encodeURIComponent(phrase)}`
    });
    // Также ZZap через поисковый хэш
    urls.push({
      label: `🔍 ZZap: ${(partName || '').substring(0, 20)}`,
      url:   `https://www.zzap.ru/public/search.aspx#phrase=${encodeURIComponent(phrase)}`
    });
  }

  if (vin) {
    urls.push({
      label: `🚗 VIN: ${vin.substring(0, 8)}...`,
      url:   `https://www.zzap.ru/catalog/vin/${encodeURIComponent(vin)}`
    });
  }

  return urls;
}

// ── Основная функция поиска через Puppeteer ───────────────────────────────────
export async function searchZzap({ make, model, year, partName, oem }) {
  // Если нет OEM — спрашиваем AI
  let resolvedOem = oem || null;
  let aiOem = null;
  if (!resolvedOem && partName) {
    aiOem = await findOemByAI(partName, make, model, year);
    if (aiOem) {
      resolvedOem = aiOem;
      console.log(`[ZZap] AI нашёл OEM для "${partName}": ${aiOem}`);
    } else {
      console.log(`[ZZap] AI не знает OEM для "${partName}" — возвращаем ссылки`);
      return { ok: true, results: [], searchUrl: null, noResults: true, textSearchOnly: true };
    }
  }

  const searchUrl = `https://www.zzap.ru/public/search.aspx#rawdata=${encodeURIComponent(resolvedOem)}`;

  let browser;
  try {
    const executablePath = findChromium();
    if (!executablePath) throw new Error('Chromium не найден на сервере');

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
      timeout: 30_000,
    });

    const page = await browser.newPage();

    // Имитируем реальный браузер
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Блокируем картинки и шрифты для ускорения
    await page.setRequestInterception(true);
    page.on('request', req => {
      const rt = req.resourceType();
      if (['image', 'font', 'media'].includes(rt)) req.abort();
      else req.continue();
    });

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Ждём появления строк результатов (или таймаут 15 сек)
    try {
      await page.waitForSelector('tr.dxgvDataRow_ZZapAqua', { timeout: 15_000 });
    } catch {
      // Результатов нет или страница не загрузилась
      return { ok: true, results: [], searchUrl, noResults: true };
    }

    // Извлекаем данные из DOM
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr.dxgvDataRow_ZZapAqua');
      const items = [];
      const seen = new Set();

      rows.forEach(row => {
        // Только видимые DX-ячейки
        const cells = Array.from(row.querySelectorAll('td.dx-wrap.dxgv'));
        if (cells.length < 4) return;

        // Название запчасти — 4-я ячейка (индекс 3), первая строка
        const partName = cells[3]?.innerText?.split('\n')[0]?.trim();
        if (!partName || partName.length < 3) return;

        // Цена — ячейка с «р.» или «₽»
        const priceCell = cells.find(c => /\d[\d\s]{1,6}р\./.test(c.innerText));
        const priceMatch = priceCell?.innerText?.match(/(\d[\d\s]{1,6})р\./);
        if (!priceMatch) return;

        const price = parseInt(priceMatch[1].replace(/\s/g, ''), 10);
        // Фильтруем: реальная цена запчасти 300–500 000 ₽
        if (price < 300 || price > 500_000) return;

        // Дедупликация по имени + цене
        const key = `${partName}|${price}`;
        if (seen.has(key)) return;
        seen.add(key);

        items.push({ name: partName, price });
      });

      return items;
    });

    return { ok: true, results: results.slice(0, 10), searchUrl, aiOem };

  } catch (e) {
    return { ok: false, error: e.message, results: [], searchUrl };
  } finally {
    if (browser) await browser.close();
  }
}

// ── RESALE: наценка + форматирование для клиента ─────────────────────────────
const MARKUP_MIN = 0.25;  // +25%
const MARKUP_MAX = 0.35;  // +35%

/**
 * Добавить наценку к результатам ZZap и отформатировать для клиента.
 * Клиент видит "нашу" цену, не знает откуда берём.
 */
export function applyMarkupAndFormat(zzapResults, partName, car) {
  if (!zzapResults?.length) return null;

  // Берём топ-5 уникальных по цене
  const sorted = [...zzapResults]
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);

  const offers = sorted.map((r, i) => {
    // Разная наценка: самый дешёвый +35%, остальные +25–30%
    const markup = i === 0 ? MARKUP_MAX : MARKUP_MIN + Math.random() * 0.05;
    const ourPrice = Math.ceil(r.price * (1 + markup) / 100) * 100; // округл до сотни
    return {
      name:      r.name,
      realPrice: r.price,
      ourPrice,
      markup:    Math.round(markup * 100),
      label:     i === 0 ? '⭐ Лучшая цена' : i === 1 ? '✅ Популярный' : '📦 В наличии',
    };
  });

  return offers;
}

/**
 * Текст для клиента: нашли под заказ, показываем варианты
 */
export function formatClientResaleMsg(offers, partName, car) {
  if (!offers?.length) return null;

  let text = `🔍 *Нашли под заказ: ${partName}*`;
  if (car) text += ` для ${car}`;
  text += `\n\n`;

  offers.forEach((o, i) => {
    text += `${o.label}\n`;
    text += `📦 ${o.name}\n`;
    text += `💰 *${o.ourPrice.toLocaleString('ru-RU')} ₽*\n`;
    text += `🚚 Доставка 2–5 дней\n`;
    if (i < offers.length - 1) text += `\n`;
  });

  text += `\n\n_Все варианты — оригинальные детали от проверенных поставщиков._`;
  return text;
}

/**
 * Inline-кнопки выбора варианта для клиента
 */
export function buildResaleKeyboard(offers, chatId) {
  const buttons = offers.map((o, i) => ([{
    text:          `${o.label} — ${o.ourPrice.toLocaleString('ru-RU')} ₽`,
    callback_data: `resale_pick_${chatId}_${i}`,
  }]));
  buttons.push([
    { text: '📲 Написать менеджеру', callback_data: 'svc_manager' },
    { text: '🔄 Искать ещё',         callback_data: 'svc_buy'     },
  ]);
  return { inline_keyboard: buttons };
}

// ── In-memory: хранить варианты пока клиент выбирает ─────────────────────────
const pendingResale = new Map(); // chatId → { offers, partName, car }

export function saveResaleOffers(chatId, offers, partName, car) {
  pendingResale.set(String(chatId), { offers, partName, car, ts: Date.now() });
}

export function getResaleOffer(chatId, index) {
  const d = pendingResale.get(String(chatId));
  if (!d) return null;
  return { ...d.offers[index], partName: d.partName, car: d.car };
}

// ── Форматировать сообщение для менеджера ─────────────────────────────────────
export function formatManagerZzapMsg({ vin, make, model, year, partName, oem,
                                       partsInStock, topStockParts,
                                       zzapResult, username, chatId, resaleOffers }) {
  const car      = [make, model, year].filter(Boolean).join(' ') || 'Неизвестно';
  const zzapUrls = buildZzapUrls({ make, model, year, partName, oem, vin });

  let msg = `🔔 *Новый запрос запчасти*\n\n`;
  msg    += `👤 ${username ? `@${username}` : `ID: ${chatId}`}\n`;
  msg    += `🚗 *${car}*\n`;
  if (vin) msg += `🔑 VIN: \`${vin}\`\n`;
  msg    += `🔩 Запчасть: *${partName}*${oem ? ` (OEM: \`${oem}\`)` : zzapResult?.aiOem ? ` (AI OEM: \`${zzapResult.aiOem}\`)` : ''}\n\n`;

  // Наш каталог
  if (partsInStock > 0) {
    msg += `✅ *В нашем каталоге: ${partsInStock} позиций*\n`;
    (topStockParts || []).slice(0, 3).forEach(p => {
      const price = Number(p.price || 0).toLocaleString('ru-RU');
      const oemStr = p.oem ? ` \`${p.oem}\`` : '';
      msg += `  • ${p.name}${oemStr} — *${price} ₽*\n`;
    });
  } else {
    msg += `❌ *В нашем каталоге: не найдено*\n`;
  }

  // Наценённые варианты — прибыль менеджера
  if (resaleOffers?.length) {
    msg += `\n💸 *Варианты под заказ (наша маржа):*\n`;
    resaleOffers.forEach((o, i) => {
      const margin = o.ourPrice - o.realPrice;
      msg += `${i + 1}. ${o.name}\n`;
      msg += `   ZZap: ${o.realPrice.toLocaleString('ru-RU')} ₽ → Клиент: *${o.ourPrice.toLocaleString('ru-RU')} ₽* (+${margin.toLocaleString('ru-RU')} ₽ / +${o.markup}%)\n`;
    });
  }

  if (zzapResult?.ok && zzapResult.results?.length > 0) {
    msg += `\n📦 *Реальные цены ZZap (себестоимость):*\n`;
    zzapResult.results.slice(0, 5).forEach((r, i) => {
      msg += `${i + 1}. ${r.name} — ${r.price.toLocaleString('ru-RU')} ₽\n`;
    });
  } else if (zzapResult?.textSearchOnly) {
    msg += `\n🔍 *Нет OEM — поищите вручную:*\n`;
  } else {
    msg += `\n🔍 *ZZap не нашёл — поищите вручную:*\n`;
  }

  msg += zzapUrls.map(u => `• [${u.label}](${u.url})`).join('\n');

  return { text: msg, zzapUrl: zzapUrls[0]?.url };
}

/**
 * LegalAuto — Supplier Agent
 * Параллельный поиск у нескольких поставщиков:
 *   1. ZZap.ru  — через Puppeteer (уже реализован в zzapAgent.js)
 *   2. Exist.ru — через fetch (JSON API)
 *
 * Менеджер получает: лучшую цену, источник, нашу маржу.
 */

import { searchZzap } from './zzapAgent.js';

// ── Exist.ru API ──────────────────────────────────────────────────────────────
// Exist.ru имеет публичный endpoint поиска по артикулу
async function searchExist(oem) {
  if (!oem) return { ok: false, results: [] };
  try {
    const url = `https://exist.ru/api/v1/search?article=${encodeURIComponent(oem)}&brand=&with_analogs=1`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      // Fallback: попробуем страницу поиска через простой запрос
      return await searchExistPage(oem);
    }

    const data = await resp.json();
    const items = (data?.data || data?.results || data || []);
    if (!Array.isArray(items) || !items.length) return await searchExistPage(oem);

    const results = items.slice(0, 10).map(item => ({
      name:    item.name || item.description || oem,
      price:   Number(item.price || item.cost || 0),
      source:  'exist',
      brand:   item.brand || item.manufacturer || '',
      stock:   item.quantity > 0 || item.in_stock,
    })).filter(r => r.price > 100);

    return { ok: true, results };
  } catch {
    return await searchExistPage(oem);
  }
}

// Fallback: простой fetch HTML-страницы Exist и парсим цены regex
async function searchExistPage(oem) {
  try {
    const url = `https://exist.ru/?q=${encodeURIComponent(oem)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return { ok: false, results: [] };

    const html = await resp.text();

    // Ищем цены в HTML: числа с разделителями типа "15 000" или "15000" перед "руб" или "₽"
    const priceMatches = [...html.matchAll(/(\d[\d\s]{2,8})\s*(?:руб|₽|р\.)/gi)];
    const nameMatches  = [...html.matchAll(/class="[^"]*(?:name|title|descr)[^"]*"[^>]*>([^<]{5,80})</gi)];

    const results = priceMatches.slice(0, 5).map((m, i) => ({
      name:   nameMatches[i]?.[1]?.trim() || `Позиция ${i + 1}`,
      price:  parseInt(m[1].replace(/\s/g, ''), 10),
      source: 'exist',
    })).filter(r => r.price >= 300 && r.price <= 1_000_000);

    return { ok: results.length > 0, results };
  } catch {
    return { ok: false, results: [] };
  }
}

// ── Основная функция: параллельный поиск ──────────────────────────────────────
export async function searchAllSuppliers({ oem, partName, make, model, year }) {
  const [zzapResult, existResult] = await Promise.allSettled([
    searchZzap({ oem, partName, make, model, year }),
    oem ? searchExist(oem) : Promise.resolve({ ok: false, results: [] }),
  ]);

  const zzap  = zzapResult.status  === 'fulfilled' ? zzapResult.value  : { ok: false, results: [] };
  const exist = existResult.status === 'fulfilled' ? existResult.value : { ok: false, results: [] };

  // Объединяем и сортируем по цене
  const allResults = [
    ...(zzap.results  || []).map(r => ({ ...r, source: 'zzap'  })),
    ...(exist.results || []).map(r => ({ ...r, source: 'exist' })),
  ].filter(r => r.price > 0).sort((a, b) => a.price - b.price);

  const best = allResults[0] || null;

  return {
    ok:         allResults.length > 0,
    allResults,
    best,
    zzap,
    exist,
    aiOem:      zzap.aiOem || null,
  };
}

// ── Форматирование отчёта для менеджера ───────────────────────────────────────
const MARKUP = 0.28; // +28% наша маржа

export function formatSupplierReport({ result, partName, car, username, chatId }) {
  const who = username ? `@${username}` : `id: ${chatId}`;
  const carStr = car || 'не указано';

  let msg = `🏪 *Отчёт поставщиков: ${partName}*\n`;
  msg    += `🚗 ${carStr} | 👤 ${who}\n\n`;

  if (!result.ok || !result.allResults.length) {
    msg += `❌ Ни один поставщик не нашёл деталь.\n`;
    msg += `🔍 Поищите вручную:\n`;
    msg += `• [Exist.ru](https://exist.ru/?q=${encodeURIComponent(partName)})\n`;
    msg += `• [ZZap.ru](https://www.zzap.ru/public/search.aspx#phrase=${encodeURIComponent(partName)})\n`;
    return msg;
  }

  // Лучшее предложение
  const best = result.best;
  const bestOurPrice = Math.ceil(best.price * (1 + MARKUP) / 100) * 100;
  const bestMargin   = bestOurPrice - best.price;
  const sourceLabel  = best.source === 'zzap' ? 'ZZap.ru' : 'Exist.ru';

  msg += `⭐ *Лучшее: ${sourceLabel}*\n`;
  msg += `📦 ${best.name}\n`;
  msg += `💰 Себестоимость: *${best.price.toLocaleString('ru-RU')} ₽*\n`;
  msg += `💵 Клиенту: *${bestOurPrice.toLocaleString('ru-RU')} ₽* (+${bestMargin.toLocaleString('ru-RU')} ₽ / +${Math.round(MARKUP * 100)}%)\n\n`;

  // Все варианты
  if (result.allResults.length > 1) {
    msg += `📋 *Все варианты (${result.allResults.length}):*\n`;
    result.allResults.slice(0, 6).forEach((r, i) => {
      const ourP   = Math.ceil(r.price * (1 + MARKUP) / 100) * 100;
      const srcIcon = r.source === 'zzap' ? '🔵' : '🟢';
      msg += `${i + 1}. ${srcIcon} ${r.name.substring(0, 40)} — ${r.price.toLocaleString('ru-RU')} ₽ → *${ourP.toLocaleString('ru-RU')} ₽*\n`;
    });
    msg += '\n';
  }

  // По источникам
  msg += `📊 *Итого:*\n`;
  msg += `🔵 ZZap: ${result.zzap.results?.length || 0} предложений\n`;
  msg += `🟢 Exist: ${result.exist.results?.length || 0} предложений\n`;

  if (result.aiOem) msg += `\n🤖 AI определил OEM: \`${result.aiOem}\`\n`;

  return msg;
}

// ── Инлайн-кнопки для менеджера ──────────────────────────────────────────────
export function supplierButtons({ oem, partName, clientUsername }) {
  const q = oem || partName;
  return {
    inline_keyboard: [
      [
        { text: '🔵 ZZap',   url: `https://www.zzap.ru/public/search.aspx#${oem ? 'rawdata' : 'phrase'}=${encodeURIComponent(q)}` },
        { text: '🟢 Exist',  url: `https://exist.ru/?q=${encodeURIComponent(q)}` },
      ],
      clientUsername ? [
        { text: '📲 Написать клиенту', url: `https://t.me/${clientUsername}` },
      ] : [],
    ].filter(row => row.length > 0),
  };
}

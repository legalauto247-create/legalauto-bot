/**
 * LegalAuto — Price Monitor Agent
 * Еженедельно сравнивает цены нашего каталога с Exist.ru.
 * Если мы дороже — сигнализирует менеджеру.
 *
 * Запуск: setupPriceMonitor(bot) → каждый понедельник в 10:00 МСК.
 */

const GAS_URL       = process.env.APPS_SCRIPT_API_URL || '';
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN   || '';
const ADMIN_CHAT_ID   = process.env.ADMIN_CHAT_ID     || '';
const MARKUP          = 0.25; // наша наценка (+25%)

// ── Получить наш каталог из GAS ──────────────────────────────────────────────
async function getCatalogSample(limit = 10) {
  if (!GAS_URL) return [];
  try {
    const resp = await fetch(`${GAS_URL}?action=catalog&limit=${limit}`, { signal: AbortSignal.timeout(10_000) });
    const data = await resp.json();
    return (data?.products || []).filter(p => p.oem && p.price);
  } catch {
    return [];
  }
}

// ── Получить цену на Exist.ru по OEM ─────────────────────────────────────────
async function getExistPrice(oem) {
  try {
    const url  = `https://exist.ru/?q=${encodeURIComponent(oem)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Парсим первую цену из страницы
    const match = html.match(/(\d[\d\s]{2,8})\s*(?:руб|₽|р\.)/i);
    if (!match) return null;
    return parseInt(match[1].replace(/\s/g, ''), 10);
  } catch {
    return null;
  }
}

// ── Основная проверка ─────────────────────────────────────────────────────────
export async function runPriceMonitor(bot) {
  console.log('[PriceMonitor] Запуск проверки цен...');

  const catalog = await getCatalogSample(15);
  if (!catalog.length) {
    console.log('[PriceMonitor] Каталог пуст или недоступен');
    return;
  }

  const issues   = [];
  const checked  = [];

  for (const item of catalog) {
    const ourPrice    = Number(item.price);
    const existPrice  = await getExistPrice(item.oem);
    if (!existPrice || existPrice <= 0) continue;

    // Считаем "рыночную" цену с нашей наценкой от Exist
    const marketWithMarkup = Math.ceil(existPrice * (1 + MARKUP) / 100) * 100;

    checked.push({ name: item.name, oem: item.oem, ourPrice, existPrice, marketWithMarkup });

    // Если мы дороже рынка + наценка на 10% — проблема
    if (ourPrice > marketWithMarkup * 1.10) {
      issues.push({ name: item.name, oem: item.oem, ourPrice, existPrice, diff: ourPrice - marketWithMarkup });
    }

    // Небольшая пауза чтобы не банили
    await new Promise(r => setTimeout(r, 1500));
  }

  // Формируем отчёт
  let msg = `📊 *Мониторинг цен — еженедельный отчёт*\n`;
  msg    += `Проверено: ${checked.length} позиций\n\n`;

  if (!issues.length) {
    msg += `✅ *Все цены в рынке!* Конкурентоспособны по всем проверенным позициям.`;
  } else {
    msg += `⚠️ *${issues.length} позиций дороже рынка:*\n\n`;
    issues.forEach((it, i) => {
      msg += `${i + 1}. *${it.name.substring(0, 40)}*\n`;
      msg += `   OEM: \`${it.oem}\`\n`;
      msg += `   Наша: *${it.ourPrice.toLocaleString('ru-RU')} ₽* | Рынок+наценка: ${(it.ourPrice - it.diff).toLocaleString('ru-RU')} ₽\n`;
      msg += `   Переплата: +${it.diff.toLocaleString('ru-RU')} ₽\n\n`;
    });
    msg += `_Рекомендуем снизить цены на эти позиции для конкурентоспособности._`;
  }

  // Отправляем менеджеру
  if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    ADMIN_CHAT_ID,
        text:       msg,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '📋 Открыть каталог', url: 'https://docs.google.com/spreadsheets/d/' + (process.env.SPREADSHEET_ID || '') },
        ]]}
      })
    }).catch(() => {});
  }

  console.log(`[PriceMonitor] Отчёт отправлен. Проверено: ${checked.length}, проблем: ${issues.length}`);
}

// ── Запуск расписания ─────────────────────────────────────────────────────────
export function setupPriceMonitor(bot) {
  // Проверяем каждый понедельник в 10:00 МСК (UTC+3 = 07:00 UTC)
  const checkSchedule = () => {
    const now  = new Date();
    const utcH = now.getUTCHours();
    const utcD = now.getUTCDay(); // 1 = понедельник

    if (utcD === 1 && utcH === 7) {
      runPriceMonitor(bot).catch(e => console.error('[PriceMonitor] Ошибка:', e.message));
    }
  };

  setInterval(checkSchedule, 60 * 60 * 1000); // проверяем каждый час
  console.log('📊 Price monitor запущен (каждый пн 10:00 МСК)');
}

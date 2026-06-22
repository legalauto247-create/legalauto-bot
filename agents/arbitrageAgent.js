/**
 * LegalAuto — Arbitrage Agent
 *
 * Ищет возможности для перепродажи с прибылью:
 *  1. Каждые 2 часа берёт популярные запчасти из нашего каталога
 *  2. Ищет их цены на Exist.ru (оптовый поставщик)
 *  3. Считает: можем купить за X → продать за Y → прибыль Z
 *  4. Отправляет менеджеру топ-5 возможностей прямо в Telegram
 *
 * Логика прибыли:
 *  - Exist цена = цена у поставщика (что они продают клиентам)
 *  - Реальная закупка = Exist * 0.7 (оптовая скидка ~30%)
 *  - Наша продажа = закупка * 1.5 (наценка 50%)
 *  - Минимальная маржа для сигнала: 35%+
 *
 * Railway env:
 *   ARBITRAGE_ENABLED = "true"
 *   ARBITRAGE_MIN_MARGIN = "35"   (минимальная маржа в %, по умолчанию 35)
 *   ARBITRAGE_MIN_PROFIT = "500"  (минимальная прибыль в рублях)
 */

import fetch from 'node-fetch';

const ADMIN_BOT_TOKEN   = process.env.ADMIN_BOT_TOKEN   || '';
const ADMIN_CHAT_ID     = process.env.ADMIN_CHAT_ID     || '';
const APPS_SCRIPT_URL   = process.env.APPS_SCRIPT_API_URL || '';
const MIN_MARGIN        = Number(process.env.ARBITRAGE_MIN_MARGIN || 35);
const MIN_PROFIT        = Number(process.env.ARBITRAGE_MIN_PROFIT || 500);
const WHOLESALE_DISC    = 0.70; // наш доступ к оптовой цене = 70% от Exist розницы
const OUR_MARKUP        = 1.50; // продаём с наценкой 50% от закупки

// ── Известные высокомаржинальные запчасти (стартовый список) ─────────────────
const HOT_PARTS = [
  { name: 'Турбина BMW N57',        oem: '11657823258', make: 'BMW' },
  { name: 'ТНВД BMW N47',           oem: '13517800196', make: 'BMW' },
  { name: 'Насос ГУР BMW E60',      oem: '32416769887', make: 'BMW' },
  { name: 'Компрессор кондиционера BMW X5', oem: '64529185146', make: 'BMW' },
  { name: 'Генератор BMW F10',      oem: '12317535117', make: 'BMW' },
  { name: 'Рулевая рейка Geely Atlas', oem: '3401100200', make: 'Geely' },
  { name: 'АКПП Geely Coolray',     oem: '3400100400',  make: 'Geely' },
  { name: 'Редуктор задний Geely Atlas', oem: '2402100400', make: 'Geely' },
  { name: 'Стартер Mercedes W211',  oem: 'A0051513401', make: 'Mercedes' },
  { name: 'Форсунка Mercedes OM642', oem: 'A6420700987', make: 'Mercedes' },
  { name: 'Турбина Audi A6 C6',     oem: '059145701G',  make: 'Audi' },
  { name: 'Коробка передач Audi Q5', oem: '0B5300012',  make: 'Audi' },
  { name: 'Насос масляный Toyota',  oem: '1510028020',  make: 'Toyota' },
  { name: 'Блок управления АКПП Li Auto L9', oem: 'L900241000', make: 'Li Auto' },
];

// ── Получить цену с Exist.ru ──────────────────────────────────────────────────
async function getExistPrice(oem, partName) {
  try {
    const query = oem || partName;
    const url   = `https://exist.ru/?q=${encodeURIComponent(query)}`;
    const resp  = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Извлекаем первую встреченную цену
    const patterns = [
      /class="[^"]*price[^"]*"[^>]*>[\s\S]{0,30}?([\d\s]{4,8})\s*(?:руб|₽)/i,
      /"price"[^>]*>[\s\S]{0,20}?([\d\s]{4,8})/i,
      /([\d\s]{4,8})\s*(?:руб|₽|р\.)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/\s/g, ''), 10);
        if (price >= 100 && price <= 5_000_000) return price;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Получить нашу цену из каталога ───────────────────────────────────────────
async function getOurCatalogPrice(oem, partName, make) {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const url = `${APPS_SCRIPT_URL}?action=catalog&brand=${encodeURIComponent(make)}&search=${encodeURIComponent(oem || partName)}&limit=3`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = await resp.json();
    const products = data?.products || [];
    if (!products.length) return null;
    // Берём минимальную нашу цену (наиболее конкурентную)
    const prices = products.map(p => Number(p.price)).filter(p => p > 0);
    return prices.length ? Math.min(...prices) : null;
  } catch {
    return null;
  }
}

// ── Считаем арбитраж ──────────────────────────────────────────────────────────
function calcArbitrage(existPrice) {
  const buyPrice  = Math.ceil(existPrice * WHOLESALE_DISC / 100) * 100; // оптовая закупка
  const sellPrice = Math.ceil(buyPrice   * OUR_MARKUP    / 100) * 100; // наша продажа
  const profit    = sellPrice - buyPrice;
  const margin    = ((profit / sellPrice) * 100).toFixed(0);
  return { buyPrice, sellPrice, profit, margin: Number(margin) };
}

// ── Основная проверка ─────────────────────────────────────────────────────────
export async function runArbitrageCheck() {
  if (process.env.ARBITRAGE_ENABLED !== 'true') {
    console.log('[ArbitrageAgent] Выключено. Установи ARBITRAGE_ENABLED=true');
    return;
  }

  console.log('[ArbitrageAgent] 🔍 Сканирую возможности...');

  const opportunities = [];
  const checked = [];

  for (const part of HOT_PARTS) {
    try {
      const existPrice = await getExistPrice(part.oem, part.name);
      if (!existPrice) {
        checked.push({ ...part, status: 'no_price' });
        continue;
      }

      const arb = calcArbitrage(existPrice);

      // Также проверяем есть ли у нас уже в каталоге
      const ourPrice = await getOurCatalogPrice(part.oem, part.name, part.make);

      checked.push({ ...part, existPrice, ...arb, ourPrice });

      // Фильтр: только реально выгодные
      if (arb.margin >= MIN_MARGIN && arb.profit >= MIN_PROFIT) {
        opportunities.push({ ...part, existPrice, ...arb, ourPrice });
      }
    } catch (e) {
      console.error(`[ArbitrageAgent] Ошибка для ${part.name}:`, e.message);
    }

    // Пауза между запросами
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Сортируем по прибыли
  opportunities.sort((a, b) => b.profit - a.profit);

  console.log(`[ArbitrageAgent] Проверено: ${checked.length}, возможностей: ${opportunities.length}`);

  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;

  // Формируем сообщение
  if (!opportunities.length) {
    // Тихо — не шумим если нет возможностей
    console.log('[ArbitrageAgent] Нет выгодных возможностей сейчас');
    return;
  }

  let msg = `💰 *Арбитраж: ${opportunities.length} возможностей*\n`;
  msg    += `_Маржа >${MIN_MARGIN}%, прибыль >${MIN_PROFIT.toLocaleString('ru-RU')} ₽_\n\n`;

  const top5 = opportunities.slice(0, 5);
  top5.forEach((op, i) => {
    const inStock = op.ourPrice ? `✅ У нас есть (${op.ourPrice.toLocaleString('ru-RU')} ₽)` : `❌ Нет в каталоге — найти на разборке!`;
    msg += `${i + 1}. *${op.name}*\n`;
    msg += `   🛒 Купить: ~${op.buyPrice.toLocaleString('ru-RU')} ₽\n`;
    msg += `   💵 Продать: ${op.sellPrice.toLocaleString('ru-RU')} ₽\n`;
    msg += `   🎯 Прибыль: *+${op.profit.toLocaleString('ru-RU')} ₽* (${op.margin}%)\n`;
    msg += `   ${inStock}\n\n`;
  });

  msg += `_🔄 Обновляется каждые 2 часа_`;

  const buttons = top5.map(op => ([{
    text: `🔍 ${op.name.substring(0, 30)}`,
    url: `https://exist.ru/?q=${encodeURIComponent(op.oem || op.name)}`,
  }]));

  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:                  ADMIN_CHAT_ID,
      text:                     msg,
      parse_mode:               'Markdown',
      disable_web_page_preview: true,
      reply_markup:             { inline_keyboard: buttons },
    }),
  }).catch(e => console.error('[ArbitrageAgent] Send error:', e.message));
}

// ── Добавить запчасть в мониторинг ───────────────────────────────────────────
export function addToArbitrageWatch(oem, name, make) {
  if (!HOT_PARTS.find(p => p.oem === oem)) {
    HOT_PARTS.push({ oem, name, make });
    console.log(`[ArbitrageAgent] Добавлен в мониторинг: ${name} (${oem})`);
  }
}

// ── Планировщик: каждые 2 часа ───────────────────────────────────────────────
export function setupArbitrageMonitor() {
  if (process.env.ARBITRAGE_ENABLED !== 'true') {
    console.log('💰 [ArbitrageAgent] Выключено. Установи ARBITRAGE_ENABLED=true в Railway');
    return;
  }

  // Первый запуск через 5 минут после старта
  setTimeout(() => {
    runArbitrageCheck().catch(e => console.error('[ArbitrageAgent] Ошибка:', e.message));
  }, 5 * 60 * 1000);

  // Затем каждые 2 часа
  setInterval(() => {
    runArbitrageCheck().catch(e => console.error('[ArbitrageAgent] Ошибка:', e.message));
  }, 2 * 60 * 60 * 1000);

  console.log('💰 [ArbitrageAgent] Запущен — сканирую каждые 2ч (ARBITRAGE_ENABLED=true)');
}

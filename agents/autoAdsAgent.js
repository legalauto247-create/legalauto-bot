/**
 * LegalAuto — Auto Ads Agent
 *
 * Берёт объявления о продаже авто с drom.ru и auto.ru,
 * переписывает через Claude под аудиторию группы,
 * отправляет на одобрение в adminBot → публикует в AUTO_ADS_CHANNEL.
 *
 * Railway env:
 *   AUTO_ADS_CHANNEL     = ID или @username канала/группы для авто объявлений
 *   AUTO_ADS_ENABLED     = "true"
 *   AUTO_ADS_INTERVAL_H  = "3"  (каждые 3 часа, по умолчанию)
 *   AUTO_ADS_CITIES      = "Москва,Санкт-Петербург,Новосибирск"
 *   AUTO_ADS_BRANDS      = "BMW,Geely,Li Auto,Chery,Mercedes"
 */

import fetch     from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';

const {
  CLAUDE_API_KEY,
  ADMIN_BOT_TOKEN,
  ADMIN_CHAT_ID,
  AUTO_ADS_CHANNEL,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

const BRANDS   = (process.env.AUTO_ADS_BRANDS  || 'BMW,Geely,Li Auto,Chery,Mercedes,Audi').split(',').map(s => s.trim());
const INTERVAL = parseInt(process.env.AUTO_ADS_INTERVAL_H || '3', 10);

// Уже опубликованные URL — не дублируем
const postedUrls = new Set();

// ── Парсинг объявлений drom.ru ──────────────────────────────────────────────
async function fetchFromDrom(brand) {
  // drom.ru/used/list без авторизации — открытый доступ
  const query = encodeURIComponent(brand);
  const url   = `https://auto.drom.ru/all/?fuelId=&mileageMax=300000&minprice=300000&maxprice=10000000&unsold=1&q=${query}&ph=1`;

  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(15000),
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Accept':          'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseDromListings(html, brand);
  } catch (e) {
    console.error(`[AutoAds] drom fetch error (${brand}):`, e.message);
    return [];
  }
}

function parseDromListings(html, brand) {
  const items = [];

  // Ищем блоки объявлений: заголовок, цена, пробег, год, ссылка
  const cardRegex = /data-bull-id="(\d+)"[\s\S]*?<a[^>]+href="(https:\/\/auto\.drom\.ru[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = cardRegex.exec(html)) !== null && items.length < 5) {
    const id    = match[1];
    const link  = match[2];
    const title = match[3].replace(/<[^>]+>/g, '').trim();
    const price = match[4].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title && link && !postedUrls.has(link)) {
      items.push({ id, link, title, price, brand, source: 'drom' });
    }
  }

  // Фолбэк — ищем просто ссылки на объявления
  if (!items.length) {
    const linkRegex = /href="(https:\/\/auto\.drom\.ru\/[a-z]+\/used\/\d+\/[^"]+)"/gi;
    while ((match = linkRegex.exec(html)) !== null && items.length < 3) {
      const link = match[1];
      if (!postedUrls.has(link)) {
        items.push({ link, title: `${brand} на drom.ru`, price: '', brand, source: 'drom' });
      }
    }
  }

  return items;
}

// ── Парсинг auto.ru через открытый API ──────────────────────────────────────
async function fetchFromAutoRu(brand) {
  // auto.ru имеет полуоткрытый JSON API для листинга
  const mark = brand.toUpperCase().replace(/\s/g, '_');
  const url  = `https://auto.ru/-/ajax/desktop/listing/?mark=${mark}&state=USED&price_from=300000&price_to=10000000&page=1&page_size=5`;

  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
        'x-client-app-version': '1.0.0',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return parseAutoRuListings(data, brand);
  } catch (e) {
    console.error(`[AutoAds] auto.ru fetch error (${brand}):`, e.message);
    return [];
  }
}

function parseAutoRuListings(data, brand) {
  const offers = data?.listing?.offers || data?.offers || [];
  return offers.slice(0, 5).map(offer => {
    const title = [
      offer?.vehicle_info?.mark_info?.name,
      offer?.vehicle_info?.model_info?.name,
      offer?.documents?.year,
    ].filter(Boolean).join(' ') || brand;

    const price   = offer?.price_info?.price ? `${offer.price_info.price.toLocaleString('ru-RU')} ₽` : '';
    const mileage = offer?.state?.mileage     ? `${offer.state.mileage.toLocaleString('ru-RU')} км`  : '';
    const city    = offer?.seller?.location?.region_info?.name || '';
    const id      = offer?.id || '';
    const link    = id ? `https://auto.ru/cars/used/sale/${id}/` : '';

    return { link, title, price, mileage, city, brand, source: 'auto.ru', year: offer?.documents?.year };
  }).filter(item => item.link && !postedUrls.has(item.link));
}

// ── Переписать объявление через Claude ──────────────────────────────────────
async function rewriteAd(item) {
  if (!claude) return buildStaticAd(item);

  const details = [
    item.title,
    item.year   ? `Год: ${item.year}`     : '',
    item.price  ? `Цена: ${item.price}`   : '',
    item.mileage ? `Пробег: ${item.mileage}` : '',
    item.city   ? `Город: ${item.city}`   : '',
  ].filter(Boolean).join(' | ');

  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content:
          `Ты ведёшь Telegram-канал о покупке и продаже авто в России.
Перепиши это объявление о продаже авто в живой пост для Telegram-канала/группы.
Стиль: дружелюбный, по делу, как опытный автоэксперт советует другу.
Эмодзи: 2-3 штуки.
Длина: 4-5 строк.
В конце: "🔗 Объявление: ${item.link}" и "💬 Помочь с документами → @LegalAuto247"

Объявление: ${details}
Источник: ${item.source}

НЕ пиши "на этом сайте", "перейдите по ссылке". Напиши как рекомендацию.`,
      }],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.error('[AutoAds] Claude error:', e.message);
    return buildStaticAd(item);
  }
}

function buildStaticAd(item) {
  const parts = [
    `🚗 ${item.title}`,
    item.price   ? `💰 Цена: ${item.price}`   : '',
    item.mileage ? `📍 Пробег: ${item.mileage}` : '',
    item.city    ? `📍 ${item.city}`            : '',
    '',
    `🔗 Объявление: ${item.link}`,
    `💬 Помочь с документами → @LegalAuto247`,
  ].filter(l => l !== null).join('\n');
  return parts;
}

// ── Отправить на одобрение в adminBot ───────────────────────────────────────
async function sendForApproval(text, item) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    return publishAd(text);
  }

  const id = `autoads_${Date.now()}`;
  pendingAds.set(id, { text, item });

  const preview = text.length > 300 ? text.substring(0, 300) + '...' : text;

  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    ADMIN_CHAT_ID,
        text:       `🚗 *Объявление авто* [${item.brand} · ${item.source}]\n\n${preview}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Опубликовать', callback_data: `autoads_approve_${id}` },
            { text: '❌ Пропустить',   callback_data: `autoads_reject_${id}`  },
          ]],
        },
      }),
    });
    const data = await res.json();
    if (data.ok) console.log(`[AutoAds] 📨 Отправлено на одобрение: ${item.title?.substring(0, 50)}`);
    return data.ok;
  } catch (e) {
    console.error('[AutoAds] sendForApproval error:', e.message);
    return false;
  }
}

// ── Хранилище объявлений ожидающих одобрения ─────────────────────────────────
export const pendingAds = new Map();

export function getPendingAd(id)   { return pendingAds.get(String(id)); }
export function clearPendingAd(id) { pendingAds.delete(String(id)); }

// ── Прямая публикация в канал ────────────────────────────────────────────────
export async function publishAd(text) {
  const channel = AUTO_ADS_CHANNEL;
  if (!channel || !ADMIN_BOT_TOKEN) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  channel,
        text,
        parse_mode:               'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (data.ok) console.log('[AutoAds] ✅ Объявление опубликовано в канал');
    return data.ok;
  } catch (e) {
    console.error('[AutoAds] publish error:', e.message);
    return false;
  }
}

// ── Основной запуск ──────────────────────────────────────────────────────────
export async function runAutoAds() {
  if (process.env.AUTO_ADS_ENABLED !== 'true') {
    console.log('[AutoAds] Выключено. Установи AUTO_ADS_ENABLED=true в Railway');
    return;
  }
  if (!AUTO_ADS_CHANNEL) {
    console.log('[AutoAds] AUTO_ADS_CHANNEL не задан — пропуск');
    return;
  }

  console.log(`[AutoAds] 🔍 Ищу объявления: ${BRANDS.join(', ')}`);

  const allItems = [];

  // Собираем с обоих источников
  for (const brand of BRANDS.slice(0, 4)) { // берём первые 4 бренда
    const [dromItems, autoRuItems] = await Promise.allSettled([
      fetchFromDrom(brand),
      fetchFromAutoRu(brand),
    ]);

    if (dromItems.status === 'fulfilled')   allItems.push(...dromItems.value);
    if (autoRuItems.status === 'fulfilled') allItems.push(...autoRuItems.value);
  }

  if (!allItems.length) {
    console.log('[AutoAds] Новых объявлений не найдено');
    return;
  }

  // Берём случайное объявление из найденных
  const item = allItems[Math.floor(Math.random() * allItems.length)];
  console.log(`[AutoAds] 📋 Выбрано: ${item.title?.substring(0, 60)} [${item.source}]`);

  const text = await rewriteAd(item);
  const ok   = await sendForApproval(text, item);

  if (ok) postedUrls.add(item.link);

  console.log(`[AutoAds] Готово. Источник: ${item.source}`);
}

// ── Планировщик ──────────────────────────────────────────────────────────────
export function startAutoAdsScheduler() {
  if (process.env.AUTO_ADS_ENABLED !== 'true') {
    console.log('⏰ [AutoAds] Выключено (AUTO_ADS_ENABLED≠true). Установи в Railway.');
    return;
  }

  console.log(`⏰ [AutoAds] Запуск каждые ${INTERVAL} часа(ов)`);

  // Первый запуск через 5 минут после старта
  setTimeout(() => {
    runAutoAds().catch(e => console.error('[AutoAds] Ошибка:', e.message));
  }, 5 * 60 * 1000);

  setInterval(() => {
    runAutoAds().catch(e => console.error('[AutoAds] Ошибка:', e.message));
  }, INTERVAL * 60 * 60 * 1000);
}

console.log('🚗 Auto Ads Agent загружен');

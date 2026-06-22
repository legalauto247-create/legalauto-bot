/**
 * LegalAuto — AI Post Agent v3
 *
 * Защита от дублей (как в оригинальном TelegramPublisher.gs):
 *  1. Глобальный лок isPublishing — только один пост за раз
 *  2. attemptedRows Map — помним какие строки уже пробовали (TTL 4ч)
 *  3. post_hash проверка — дубль по хэшу → DUPLICATE
 *  4. Перед постингом → mark_published status=PROCESSING
 *  5. После ошибки → mark_published status=ERROR (не попадёт снова в unpublished)
 */

import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';
import { checkAndNotify } from './alertAgent.js';

const {
  CLAUDE_API_KEY,
  APPS_SCRIPT_API_URL,
  PARTS_CHANNEL,
  ADMIN_CHAT_ID,
  CHANNEL_BOT_TOKEN,   // токен бота-публикатора (= PUBLISHER_TOKEN в GAS)
  CHANNEL_ID,          // числовой chat_id канала (-1003877661204)
} = process.env;

const claude       = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;
const CHANNEL      = CHANNEL_ID || PARTS_CHANNEL || '@LegalAutoParts24';
const MINI_APP_URL = 'https://legalauto.online/catalog.html';

// ── Глобальный лок — только один пост за раз ─────────────────────────────
let isPublishing = false;

// ── Антидубль: строки уже обработанные в этой сессии (TTL 4 часа) ────────
const attemptedRows = new Map(); // rowNum → timestamp
const ATTEMPTED_TTL = 4 * 60 * 60 * 1000; // 4 часа

function markAttempted(rowNum) {
  if (rowNum) attemptedRows.set(Number(rowNum), Date.now());
}

function wasAttempted(rowNum) {
  const t = attemptedRows.get(Number(rowNum));
  if (!t) return false;
  if (Date.now() - t > ATTEMPTED_TTL) { attemptedRows.delete(Number(rowNum)); return false; }
  return true;
}

// ── Память о последних N постах (для разнообразия) ────────────────────────
const recentPosts = []; // { brand, category, price }
const RECENT_MAX  = 8;

export function rememberPosted(part) {
  recentPosts.push({
    brand:    String(part.brand    || part.display_car || '').toUpperCase(),
    category: String(part.category || '').toLowerCase(),
    price:    Number(part.price    || 0),
  });
  if (recentPosts.length > RECENT_MAX) recentPosts.shift();
}

// ── Умный выбор запчасти ─────────────────────────────────────────────────
// Учитывает: время суток, разнообразие брендов/категорий, featured, фото, qty
function pickSmartPart(parts) {
  if (!parts.length) return null;

  // Текущий час по МСК (UTC+3)
  const mskHour = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();

  const rBrands = recentPosts.map(p => p.brand);
  const rCats   = recentPosts.map(p => p.category);

  const scored = parts.map(part => {
    let score = Math.random() * 12; // базовая случайность — чтобы не всегда одно

    const brand    = String(part.brand    || part.display_car || '').toUpperCase();
    const category = String(part.category || '').toLowerCase();
    const price    = Number(part.price    || 0);
    const featured = String(part.featured || '').toUpperCase() === 'TRUE';

    // ─ Featured → всегда в приоритете
    if (featured) score += 60;

    // ─ Разнообразие брендов: штраф если бренд постили недавно
    const brandRepeats = rBrands.filter(b => b === brand).length;
    score -= brandRepeats * 20;

    // ─ Разнообразие категорий: штраф за повтор категории
    const catRepeats = rCats.filter(c => c === category).length;
    score -= catRepeats * 12;

    // ─ Стратегия по времени суток
    if (mskHour >= 8 && mskHour <= 11) {
      // Утро → премиум, дорогие детали (BMW, высокая цена)
      if (price >= 15_000) score += 25;
      if (price >= 50_000) score += 20;
    } else if (mskHour >= 12 && mskHour <= 15) {
      // День → ходовые позиции, много в наличии
      if (Number(part.qty || 0) > 1) score += 20;
      if (price >= 3_000 && price <= 20_000) score += 10;
    } else if (mskHour >= 16 && mskHour <= 20) {
      // Вечер → новинки и featured
      if (featured) score += 20;
      if (Number(part.qty || 0) === 1) score += 8; // единственный экземпляр = срочность
    } else {
      // Ночь → доступные цены, бюджетные детали
      if (price > 0 && price <= 8_000) score += 18;
    }

    // ─ Бонус за наличие фото (лучше выглядит)
    const hasPhoto = ['photo_cover','photo_1','photo_2','photo'].some(
      k => part[k] && String(part[k]).startsWith('http')
    );
    if (hasPhoto) score += 10;

    // ─ Бонус за несколько фото (альбом привлекает внимание)
    const photoCount = ['photo_cover','photo_1','photo_2','photo_3','photo_4','photo_5']
      .filter(k => part[k] && String(part[k]).startsWith('http')).length;
    if (photoCount >= 3) score += 8;

    // ─ Бонус за qty > 1 (можно продать несколько)
    if (Number(part.qty || 0) > 1) score += 5;

    // ─ Бонус за совместимость / описание (AI напишет лучше)
    if (part.compatibility) score += 5;
    if (part.description)   score += 3;

    return { part, score };
  });

  // Сортируем по score
  scored.sort((a, b) => b.score - a.score);

  // Берём из топ-5 случайно — разнообразие без потери качества
  const topN = Math.min(5, scored.length);
  return scored[Math.floor(Math.random() * topN)].part;
}

// ── Прямой Telegram API вызов ─────────────────────────────────────────────
async function tgApiCall(token, method, body) {
  const res  = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || JSON.stringify(data)}`);
  return data.result;
}

// ── Хранилище превью (для /approve) ──────────────────────────────────────
const pendingPosts = new Map();

export function setPendingPost(id, post) { pendingPosts.set(String(id), post); }
export function getPendingPost(id)       { return pendingPosts.get(String(id)) || null; }
export function clearPendingPost(id)     { pendingPosts.delete(String(id)); }

// ── GAS API (node-fetch следует 302-редиректам) ───────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) throw new Error('APPS_SCRIPT_API_URL не задан');
  const url = new URL(APPS_SCRIPT_API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res  = await fetch(url.toString(), {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('GAS вернул не JSON: ' + text.slice(0, 100)); }
}

// ── Получить неопубликованные запчасти (до 200 для умного выбора) ─────────
async function fetchUnpublished() {
  try {
    const data = await gasGet('unpublished', { limit: 200 });
    const parts = data.parts || [];
    return parts.filter(p => !wasAttempted(p._row));
  } catch (e) {
    console.error('[PostAgent] fetchUnpublished error:', e.message);
    return [];
  }
}

// ── Отметить статус в таблице ─────────────────────────────────────────────
async function markStatus(row, oem, status, messageId, channelUsername, postHash) {
  try {
    const params = { row, oem, status };
    if (messageId) {
      const link = `https://t.me/${String(channelUsername || 'LegalAutoParts24').replace('@', '')}/${messageId}`;
      params.message_id = messageId;
      params.post_link  = link;
    }
    if (postHash) params.post_hash = postHash;
    const result = await gasGet('mark_published', params);
    console.log(`[PostAgent] markStatus: row=${row} oem=${oem} status=${status} ok=${result?.ok}`);
  } catch (e) {
    console.error('[PostAgent] markStatus error:', e.message);
  }
}

async function markPublished(row, oem, messageId, channelUsername, postHash) {
  return markStatus(row, oem, 'TRUE', messageId, channelUsername, postHash);
}

async function markError(row, oem) {
  return markStatus(row, oem, 'ERROR', null, null);
}

async function markProcessing(row, oem) {
  return markStatus(row, oem, 'PROCESSING', null, null);
}

// ── pickFirstEligible оставляем для ручного /testpost ────────────────────
function pickFirstEligible(parts) { return parts[0] || null; }

// ── Генерация текста поста (структурированный шаблон + 1 строка от Claude) ──
export async function generatePostText(part) {
  const price  = Number(part.price || 0).toLocaleString('ru-RU');
  const car    = part.display_car || `${part.brand || ''} ${part.series || ''}`.trim();
  const oem    = part.oem || '—';
  const name   = part.name || '';
  const cat    = part.category || 'Запчасти';
  const cond   = part.condition || 'Оригинал Б/У';
  const qty    = Number(part.qty || 1);
  const compat = part.compatibility || '';

  // ── Urgency-маркеры ────────────────────────────────────────────────────────
  const hour = new Date().getHours(); // MSK approx (UTC+3)
  const isEvening = hour >= 17 && hour <= 21;

  // Дефицит: сколько осталось
  let stockLine = `📦 Остаток: ${qty} шт.`;
  let stockUrgency = '';
  if (qty === 1) {
    stockLine   = `📦 Остаток: ⚠️ *1 шт. — последняя!*`;
    stockUrgency = 'Последняя единица на складе — следующая только под заказ';
  } else if (qty <= 3) {
    stockLine   = `📦 Остаток: ${qty} шт. (мало)`;
    stockUrgency = `Осталось всего ${qty} штуки — разбирают быстро`;
  }

  // Вечернее давление: "до конца дня"
  let timePressure = '';
  if (isEvening) {
    timePressure = 'Заказы принятые до 20:00 отправляем завтра';
  }

  // ── Шаблон поста ──────────────────────────────────────────────────────────
  function buildTemplate(hookLine) {
    // Заголовок — меняется при дефиците
    const header = qty === 1 ? `⚡ ПОСЛЕДНЯЯ ШТУКА` : (qty <= 3 ? `🔥 МАЛО ОСТАЛОСЬ` : `🔥 НОВОЕ ПОСТУПЛЕНИЕ`);

    const lines = [
      header,
      ``,
      `🚘 ${car}`,
      `📦 ${name}`,
      `🏷 Категория: ${cat}`,
      `⚙️ Состояние: ${cond}`,
      `🔧 OEM: ${oem}`,
      `💰 Цена: *${price} ₽*`,
      stockLine,
    ];
    if (hookLine) lines.push(``, `✨ ${hookLine}`);
    if (timePressure) lines.push(`⏰ ${timePressure}`);
    lines.push(``, `🚚 Доставка по всей России`, `📲 Написать: @LegalAuto247`);
    return lines.join('\n');
  }

  // ── Claude: технический + urgency хук ────────────────────────────────────
  if (claude) {
    try {
      const compatInfo = compat ? `\nСовместимость: ${compat}` : '';
      const descInfo   = part.description ? `\nОписание: ${part.description}` : '';
      const urgencyCtx = stockUrgency ? `\nКонтекст: ${stockUrgency}.` : '';

      const msg = await claude.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content:
            `Ты продавец-эксперт б/у запчастей. Пишешь для Telegram канала.${urgencyCtx}\n\n` +
            `Автомобиль: ${car} | Деталь: ${name} | OEM: ${oem}${compatInfo}${descInfo}\n\n` +
            `Напиши ОДНО предложение (10-18 слов) которое:\n` +
            `${stockUrgency ? '— Подчёркивает дефицит и срочность покупки\n' : '— Объясняет зачем эта деталь нужна именно СЕЙЧАС\n'}` +
            `— Конкретно (не "хорошее качество", а реальный факт/последствие)\n` +
            `— Без кавычек, без эмодзи, без точки в конце`,
        }],
      });
      const hook = msg.content[0].text.trim().replace(/^["«»]|["«»]$/g, '').replace(/\.$/, '');
      return buildTemplate(hook);
    } catch (e) {
      console.error('[PostAgent] Claude hook error:', e.message);
    }
  }

  return buildTemplate(stockUrgency || null);
}

// ── Главная: умный выбор + генерация + сохранить для превью ─────────────
export async function prepareAutoPost(chatId) {
  const parts = await fetchUnpublished();
  if (!parts.length) return { ok: false, error: 'Нет неопубликованных запчастей в таблице' };

  // Умный выбор: бренд/категория/время суток
  const part = (chatId === 'scheduler') ? pickSmartPart(parts) : pickFirstEligible(parts);
  if (!part) return { ok: false, error: 'Не удалось выбрать запчасть' };

  // Запоминаем бренд/категорию для антиповтора
  if (chatId === 'scheduler') rememberPosted(part);

  // Сразу помечаем как "попытка" — чтобы следующий цикл не взял тот же item
  markAttempted(part._row);

  const text  = await generatePostText(part);
  const photo = part.photo_cover || part.photo_1 || part.photo_2 || part.photo || null;
  const post  = { part, text, photo };
  setPendingPost(chatId, post);
  return { ok: true, post };
}

// ── По конкретному ID ─────────────────────────────────────────────────────
export async function preparePostById(chatId, partId) {
  const parts = await fetchUnpublished();
  let part = parts.find(p => String(p.id) === String(partId));
  if (!part) {
    const all = await gasGet('catalog', { limit: 500 }).catch(() => ({ products: [] }));
    part = (all.products || []).find(p => String(p.id) === String(partId));
  }
  if (!part) return { ok: false, error: `Запчасть ID ${partId} не найдена` };

  markAttempted(part._row);
  const text  = await generatePostText(part);
  const photo = part.photo_cover || part.photo_1 || part.photo || null;
  const post  = { part, text, photo };
  setPendingPost(chatId, post);
  return { ok: true, post };
}

// ── Собрать все фото запчасти ─────────────────────────────────────────────
function collectPhotos(part) {
  return [
    part.photo_cover,
    part.photo_1, part.photo_2, part.photo_3,
    part.photo_4, part.photo_5,
    part.photo,
  ].filter(u => u && String(u).startsWith('http'));
}

// ── Опубликовать в канал + записать в таблицу ────────────────────────────
export async function publishToChannel(telegram, post) {
  // Глобальный лок — один пост за раз
  if (isPublishing) {
    throw new Error('Публикация уже идёт, пропускаем');
  }
  isPublishing = true;

  const channelUsername = String(CHANNEL).replace('@', '').replace(/^-100/, '');
  const photos = collectPhotos(post.part);
  const row    = post.part?._row || 0;
  const oem    = post.part?.oem  || '';

  // URL-кнопки (web_app запрещён в каналах)
  const managerUrl = `https://t.me/${(process.env.MANAGER_USERNAME || 'LegalAuto247')}`;
  const catalogBtn = { inline_keyboard: [[
    { text: '🛒 Каталог запчастей',    url: MINI_APP_URL  },
    { text: '📲 Написать менеджеру',   url: managerUrl    },
  ]]};

  const useDirect = Boolean(CHANNEL_BOT_TOKEN);

  async function sendPhoto(photoUrl, caption) {
    if (useDirect) {
      const r = await tgApiCall(CHANNEL_BOT_TOKEN, 'sendPhoto', {
        chat_id: CHANNEL, photo: photoUrl, caption,
        parse_mode: 'HTML',
        reply_markup: catalogBtn,
      });
      return r.message_id;
    }
    const r = await telegram.sendPhoto(CHANNEL, photoUrl, {
      caption, parse_mode: 'HTML', reply_markup: catalogBtn,
    });
    return r.message_id;
  }

  // Кнопка каталога отдельным сообщением (для альбомов и текстовых постов)
  async function sendCatalogButton() {
    const text = '─────────────────\n📲 Написать @LegalAuto247';
    if (useDirect) {
      await tgApiCall(CHANNEL_BOT_TOKEN, 'sendMessage', {
        chat_id: CHANNEL,
        text,
        reply_markup: catalogBtn,
        disable_web_page_preview: true,
      });
    } else {
      await telegram.sendMessage(CHANNEL, text, { reply_markup: catalogBtn });
    }
  }

  async function sendText(text) {
    if (useDirect) {
      const r = await tgApiCall(CHANNEL_BOT_TOKEN, 'sendMessage', {
        chat_id: CHANNEL, text,
        reply_markup: catalogBtn,
        disable_web_page_preview: true,
      });
      return r.message_id;
    }
    const r = await telegram.sendMessage(CHANNEL, text, { reply_markup: catalogBtn });
    return r.message_id;
  }

  async function sendAlbum(photoUrls, caption) {
    const media = photoUrls.map((url, i) => ({
      type:  'photo',
      media: url,
      ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
    }));
    if (useDirect) {
      const r = await tgApiCall(CHANNEL_BOT_TOKEN, 'sendMediaGroup', {
        chat_id: CHANNEL, media,
      });
      return r[0]?.message_id;
    }
    const r = await telegram.sendMediaGroup(CHANNEL, media);
    return r[0]?.message_id;
  }

  let messageId = null;

  try {
    // Отмечаем PROCESSING в таблице — следующий цикл не возьмёт этот item
    if (row || oem) await markProcessing(row, oem);

    if (photos.length >= 2) {
      try {
        messageId = await sendAlbum(photos.slice(0, 10), post.text);
        // Кнопка каталога отдельным сообщением после альбома
        await sendCatalogButton()
          .catch(e => console.warn('[PostAgent] catalog btn msg failed:', e.message));
      } catch (e) {
        console.error('[PostAgent] sendMediaGroup failed, fallback to 1 photo:', e.message);
        messageId = await sendPhoto(photos[0], post.text);
      }
    } else if (photos.length === 1) {
      try {
        messageId = await sendPhoto(photos[0], post.text);
      } catch (e) {
        console.error('[PostAgent] sendPhoto failed, fallback to text:', e.message);
        messageId = await sendText(post.text);
      }
    } else {
      messageId = await sendText(post.text);
    }

    // Успех — отмечаем TRUE в таблице + записываем post_hash (как в TelegramPublisher.gs)
    if (row || oem) {
      const displayCar = post.part?.display_car || post.part?.brand || '';
      const postHash   = post.part?.post_hash || `${displayCar}|${oem}`;
      await markPublished(row, oem, messageId, channelUsername, postHash);
    }

    // Alert-агент: уведомляем подписчиков о новой запчасти
    checkAndNotify(post.part).catch(e =>
      console.error('[PostAgent] checkAndNotify error:', e.message)
    );

    return messageId;

  } catch (e) {
    console.error('[PostAgent] publishToChannel failed:', e.message);
    // Помечаем ERROR — не будет снова в unpublished (ERROR исключается)
    if (row || oem) await markError(row, oem);
    throw e;
  } finally {
    isPublishing = false;
  }
}

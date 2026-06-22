/**
 * LegalAuto — Alert Agent
 *
 * Клиент говорит «уведоми меня когда появится радиатор BMW X5»
 * → сохраняем подписку → когда Post Agent публикует новую деталь
 * → проверяем все подписки → если совпадение → пишем клиенту первым
 *
 * Хранение: в памяти (Map) + GAS лист ALERTS для персистентности
 */

import fetch from 'node-fetch';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;
const CLIENT_BOT_TOKEN    = process.env.CLIENT_BOT_TOKEN;

// ── Подписки в памяти (восстанавливаются из GAS при старте) ─────────────
// chatId → [{ query, keywords, created_at }]
const subscriptions = new Map();

// ── GAS helper ────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return {};
  const url = new URL(APPS_SCRIPT_API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  try {
    const res  = await fetch(url.toString(), {
      redirect: 'follow',
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch { return {}; }
}

// ── Telegram API для клиентского бота ────────────────────────────────────
async function tgSend(chatId, text, extra = {}) {
  if (!CLIENT_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${CLIENT_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'Markdown', ...extra }),
    });
  } catch (e) {
    console.error('[AlertAgent] tgSend error:', e.message);
  }
}

// ── Добавить подписку ─────────────────────────────────────────────────────
export function addSubscription(chatId, query) {
  const keywords = extractKeywords(query);
  if (!keywords.length) return false;

  const subs = subscriptions.get(String(chatId)) || [];

  // Не дублируем похожие подписки
  const exists = subs.some(s => s.query.toLowerCase() === query.toLowerCase());
  if (exists) return 'exists';

  subs.push({ query, keywords, created_at: Date.now() });
  if (subs.length > 10) subs.shift(); // максимум 10 подписок на клиента
  subscriptions.set(String(chatId), subs);

  // Сохраняем в GAS асинхронно
  gasGet('save_alert', { chat_id: chatId, query, keywords: keywords.join(',') })
    .catch(() => {});

  console.log(`[AlertAgent] New sub: chatId=${chatId} query="${query}" keywords=${keywords.join(',')}`);
  return true;
}

// ── Удалить подписки клиента ──────────────────────────────────────────────
export function removeSubscriptions(chatId) {
  subscriptions.delete(String(chatId));
  gasGet('delete_alerts', { chat_id: chatId }).catch(() => {});
}

// ── Получить подписки клиента ─────────────────────────────────────────────
export function getSubscriptions(chatId) {
  return subscriptions.get(String(chatId)) || [];
}

// ── Извлечь ключевые слова из запроса ────────────────────────────────────
function extractKeywords(query) {
  const text = query.toLowerCase()
    .replace(/[^\wа-яё\s]/gi, ' ')
    .trim();

  // Стоп-слова которые не несут смысла
  const stopWords = new Set([
    'уведоми','уведомить','уведомляй','хочу','найди','найти','ищу','ищет',
    'когда','появится','появятся','будет','мне','меня','для','на','под',
    'notify','alert','find','when','available','need','want','looking',
    'и','в','с','по','от','до','из','за',
  ]);

  return text
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w))
    .slice(0, 8); // максимум 8 ключевых слов
}

// ── Проверить совпадение запчасти с подпиской ────────────────────────────
function partMatchesSub(part, sub) {
  const haystack = [
    part.name        || '',
    part.brand       || '',
    part.display_car || '',
    part.series      || '',
    part.body        || '',
    part.category    || '',
    part.oem         || '',
    part.compatibility || '',
    part.description || '',
  ].join(' ').toLowerCase();

  // Считаем сколько ключевых слов совпало
  const matched = sub.keywords.filter(kw => haystack.includes(kw));
  // Требуем совпадение минимум половины ключевых слов (но не менее 1)
  const threshold = Math.max(1, Math.floor(sub.keywords.length * 0.5));
  return matched.length >= threshold;
}

// ── Главная: вызывается после публикации запчасти ────────────────────────
export async function checkAndNotify(part) {
  if (!part || !subscriptions.size) return;

  const notified = [];

  for (const [chatId, subs] of subscriptions.entries()) {
    for (const sub of subs) {
      if (!partMatchesSub(part, sub)) continue;

      // Нашли совпадение — уведомляем
      const price = Number(part.price || 0).toLocaleString('ru-RU');
      const car   = part.display_car || `${part.brand || ''} ${part.series || ''}`.trim();

      const text =
        `🔔 *Нашли запчасть по твоему запросу!*\n\n` +
        `Ты просил уведомить: «${sub.query}»\n\n` +
        `🚘 ${car}\n` +
        `📦 ${part.name}\n` +
        `🔧 OEM: ${part.oem || '—'}\n` +
        `💰 Цена: *${price} ₽*\n` +
        `📦 Остаток: ${part.qty || 1} шт.\n\n` +
        `Написать менеджеру: @${process.env.MANAGER_USERNAME || 'LegalAuto247'}`;

      await tgSend(chatId, text, {
        reply_markup: { inline_keyboard: [[
          { text: '📲 Написать менеджеру', url: `https://t.me/${process.env.MANAGER_USERNAME || 'LegalAuto247'}` },
        ]]}
      });

      notified.push({ chatId, query: sub.query });
      console.log(`[AlertAgent] Notified chatId=${chatId} for "${sub.query}" → part="${part.name}"`);

      // Небольшая пауза чтобы не флудить Telegram API
      await new Promise(r => setTimeout(r, 300));
      break; // одно уведомление на клиента за раз
    }
  }

  return notified;
}

// ── Загрузить подписки из GAS при старте ─────────────────────────────────
export async function loadSubscriptionsFromGas() {
  try {
    const data = await gasGet('get_alerts');
    const alerts = data.alerts || [];
    for (const a of alerts) {
      const chatId = String(a.chat_id || '');
      if (!chatId) continue;
      const subs = subscriptions.get(chatId) || [];
      subs.push({
        query:      a.query || '',
        keywords:   String(a.keywords || '').split(',').filter(Boolean),
        created_at: a.created_at ? new Date(a.created_at).getTime() : Date.now(),
      });
      subscriptions.set(chatId, subs);
    }
    console.log(`[AlertAgent] Loaded ${alerts.length} subscriptions from GAS`);
  } catch (e) {
    console.error('[AlertAgent] loadSubscriptionsFromGas error:', e.message);
  }
}

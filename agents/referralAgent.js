/**
 * LegalAuto — Referral Agent
 *
 * Механика:
 *  1. Клиент пишет /ref → получает личную ссылку t.me/LegalAutoAssist_bot?start=ref_XXXXX
 *  2. Друг переходит по ссылке → регистрируется как "приглашённый"
 *  3. Когда друг оставляет заявку → пригласившему пишем: "Твой друг купил — тебе скидка 500₽!"
 *  4. Топ рефереров видно в adminBot (/analytics)
 *
 * Хранение:
 *  - GAS лист REFERRALS: ref_code | inviter_id | friend_id | joined_at | lead_created | rewarded
 *  - in-memory cache для быстрых lookups
 */

import fetch from 'node-fetch';

const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;
const CLIENT_BOT_TOKEN    = process.env.CLIENT_BOT_TOKEN;
const BOT_USERNAME        = process.env.CLIENT_BOT_USERNAME || 'LegalAutoAssist_bot';

// in-memory: Map<refCode, inviterId>  и  Map<friendId, refCode>
const codeToInviter  = new Map();
const friendToCode   = new Map();

// ── GAS helper ────────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return {};
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal:   AbortSignal.timeout(12000),
      headers:  { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' },
    });
    return JSON.parse(await res.text());
  } catch { return {}; }
}

// ── Генерация реф-кода ────────────────────────────────────────────────────────
function makeCode(chatId) {
  return 'ref_' + String(chatId).slice(-5) + Math.random().toString(36).slice(2, 6);
}

// ── Получить или создать реф-ссылку ──────────────────────────────────────────
export async function getOrCreateRefLink(chatId) {
  const id  = String(chatId);
  // Проверяем в памяти
  for (const [code, inv] of codeToInviter) {
    if (inv === id) {
      return { code, link: `https://t.me/${BOT_USERNAME}?start=${code}` };
    }
  }
  // Проверяем в GAS
  const data = await gasGet('get_referral_code', { inviter_id: id });
  if (data.code) {
    codeToInviter.set(data.code, id);
    return { code: data.code, link: `https://t.me/${BOT_USERNAME}?start=${data.code}` };
  }
  // Создаём новый
  const code = makeCode(id);
  await gasGet('save_referral', { ref_code: code, inviter_id: id });
  codeToInviter.set(code, id);
  return { code, link: `https://t.me/${BOT_USERNAME}?start=${code}` };
}

// ── Обработка /start?ref_XXXXX ────────────────────────────────────────────────
export async function handleRefStart(friendId, refCode) {
  if (!refCode.startsWith('ref_')) return false;
  const fId = String(friendId);

  // Уже использовал реф-ссылку?
  if (friendToCode.has(fId)) return false;

  const inviterId = codeToInviter.get(refCode);
  if (!inviterId) {
    // Ищем в GAS
    const data = await gasGet('get_referral', { ref_code: refCode });
    if (!data.inviter_id) return false;
    codeToInviter.set(refCode, data.inviter_id);
    if (data.inviter_id === fId) return false; // сам себя пригласить нельзя
    friendToCode.set(fId, refCode);
    await gasGet('save_referral_friend', { ref_code: refCode, friend_id: fId });
    await notifyInviter(data.inviter_id, 'join', fId);
    return true;
  }

  if (inviterId === fId) return false; // себя нельзя
  friendToCode.set(fId, refCode);
  await gasGet('save_referral_friend', { ref_code: refCode, friend_id: fId });
  await notifyInviter(inviterId, 'join', fId);
  return true;
}

// ── Когда рефери оставил заявку → сообщаем пригласившему ─────────────────────
export async function onFriendCreatedLead(friendId) {
  const fId   = String(friendId);
  const code  = friendToCode.get(fId);
  if (!code) return;

  const inviterId = codeToInviter.get(code);
  if (!inviterId) return;

  // Уже наградили?
  const data = await gasGet('get_referral', { ref_code: code });
  if (data.rewarded === 'true' || data.rewarded === true) return;

  await gasGet('mark_referral_rewarded', { ref_code: code, friend_id: fId });
  await notifyInviter(inviterId, 'lead', fId);
}

// ── Уведомление пригласившего ─────────────────────────────────────────────────
async function notifyInviter(inviterId, event, friendId) {
  if (!CLIENT_BOT_TOKEN || !inviterId) return;
  let text;
  if (event === 'join') {
    text =
      `🎉 *Ваш друг присоединился!*\n\n` +
      `Кто-то перешёл по вашей реф-ссылке и начал пользоваться ботом.\n\n` +
      `Как только он оставит заявку — вы получите бонус 🎁`;
  } else {
    text =
      `✅ *Ваш друг оставил заявку!*\n\n` +
      `🎁 *Вам начислен бонус — скидка 500 ₽ на следующую покупку.*\n\n` +
      `Напомните менеджеру при следующем заказе: «у меня реферальный бонус»\n\n` +
      `📲 @${process.env.MANAGER_USERNAME || 'LegalAuto247'}`;
  }
  await fetch(`https://api.telegram.org/bot${CLIENT_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: inviterId, text, parse_mode: 'Markdown' }),
    signal:  AbortSignal.timeout(8000),
  }).catch(() => {});
}

// ── Статистика рефералов ──────────────────────────────────────────────────────
export async function getReferralStats() {
  const data = await gasGet('get_referral_stats');
  return data || {};
}

// ── Получить количество рефералов у конкретного пользователя ─────────────────
export async function getUserRefStats(chatId) {
  const data = await gasGet('get_user_referrals', { inviter_id: String(chatId) });
  return {
    total:    Number(data.total    || 0),
    leads:    Number(data.leads    || 0),
    rewarded: Number(data.rewarded || 0),
  };
}

// ── Загрузить все рефералы при старте ────────────────────────────────────────
export async function loadReferrals() {
  const data = await gasGet('get_all_referrals');
  const refs = data.referrals || [];
  for (const r of refs) {
    if (r.ref_code && r.inviter_id) codeToInviter.set(r.ref_code, String(r.inviter_id));
    if (r.ref_code && r.friend_id)  friendToCode.set(String(r.friend_id), r.ref_code);
  }
  console.log(`[Referral] Загружено рефералов: ${refs.length}`);
}

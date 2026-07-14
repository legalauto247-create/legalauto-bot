/**
 * LegalAuto — Mission Engine (ИИ-руководитель отдела маркетинга).
 *
 * Миссия: накачивать аудиторию и лиды самостоятельно.
 *  1. ОТБОР: боты следят за партнёрскими каналами (autoAdsAgent), сюда приходит
 *     каждый пост-кандидат — scorePost() оценивает ликвидность (0-10), в работу
 *     идут ТОЛЬКО лучшие (порог MIN_SCORE).
 *  2. НАБЛЮДЕНИЕ: раз в день замеряет подписчиков своих каналов (t.me scrape).
 *  3. ОТЧЁТ: каждый вечер Эдо получает сводку — посты, ролики, рост, лиды.
 */
import Anthropic from '@anthropic-ai/sdk';
import { FAST } from '../agents/models.js';
import { getSection, setSection, logEvent as stateEvent } from './stateService.js';

const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const GAS = process.env.APPS_SCRIPT_API_URL;

export const MIN_SCORE = 7;
const MY_CHANNELS = (process.env.MY_CHANNELS || '@LegalAutoStore,@LegalAutoParts24,@LegalAuto24').split(',').map(s => s.trim()).filter(Boolean);

// ── 1. Оценка поста партнёра: берём только лучшие ───────────────────────────
export async function scorePost(text) {
  if (!claude) return { score: 8, why: 'нет ключа — пропускаю всё' };
  try {
    const m = await claude.messages.create({ model: FAST, max_tokens: 120, messages: [{ role: 'user', content:
`Ты — байер автосалона (пригон Китай/Корея→РФ). Оцени объявление 0-10: насколько выгодно ПЕРЕПОСТИТЬ его нашей аудитории покупателей.
+ликвидная модель в РФ (кроссоверы, минивэны, BMW/Toyota/Geely/Li/Zeekr), адекватная цена, полные данные (год/пробег/цена), свежий год.
-редкая/неликвид, нет цены, битая, праворульная, цена завышена.
Верни ТОЛЬКО JSON: {"score":N,"why":"3-5 слов"}
Объявление: "${String(text).slice(0, 600)}"` }] });
    const r = JSON.parse(m.content[0].text.match(/\{[\s\S]*\}/)[0]);
    return { score: Number(r.score) || 0, why: String(r.why || '') };
  } catch (e) { return { score: MIN_SCORE, why: 'оценка не удалась — пропускаю' }; }
}

// ── 2. Подписчики каналов (публичная страница t.me) ─────────────────────────
export async function channelSubscribers(channel) {
  const handle = channel.replace(/^@/, '');
  for (const base of ['https://t.me/', 'https://telegram.me/']) {
    try {
      const r = await fetch(base + handle, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/([\d\s.,]+[KM]?)\s*(subscribers|подписчик)/i);
      if (m) {
        let n = m[1].replace(/[\s,]/g, '');
        if (/K$/i.test(n)) n = parseFloat(n) * 1000; else if (/M$/i.test(n)) n = parseFloat(n) * 1e6;
        return Math.round(Number(n)) || null;
      }
    } catch {}
  }
  return null;
}

// ── 3. Учёт событий дня (посты/ролики/оценки) ───────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
export function recordMission(kind, extra = {}) {
  const mission = getSection('mission') || {};
  const day = mission[today()] || {};
  day[kind] = (day[kind] || 0) + 1;
  mission[today()] = day;
  setSection('mission', mission);
  stateEvent('mission_' + kind, extra);
}

// ── 4. Вечерний отчёт Эдо ────────────────────────────────────────────────────
async function leadsToday() {
  try {
    const r = await fetch(`${GAS}?action=leads`, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' } });
    const d = JSON.parse(await r.text());
    const t = today();
    return (d.leads || []).filter(l => String(l.date || l.created_at || '').slice(0, 10) === t).length;
  } catch { return null; }
}

export async function dailyReport() {
  const mission = getSection('mission') || {};
  const day = mission[today()] || {};
  const prevSubs = mission.subs || {};
  const subs = {};
  const lines = [];
  for (const ch of MY_CHANNELS) {
    const n = await channelSubscribers(ch);
    if (n == null) continue;
    subs[ch] = n;
    const diff = prevSubs[ch] ? n - prevSubs[ch] : 0;
    lines.push(`${ch}: ${n}${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}`);
  }
  mission.subs = { ...prevSubs, ...subs };
  setSection('mission', mission);

  const leads = await leadsToday();
  const txt = [
    '🎯 Отчёт Mission Engine за сегодня',
    '',
    `📬 Постов у партнёров просмотрено: ${day.scanned || 0}`,
    `⭐ Отобрано лучших (score ≥ ${MIN_SCORE}): ${day.picked || 0}`,
    `📢 Опубликовано в каналах: ${day.published || 0}`,
    `🎬 Роликов сделано: ${day.video || 0}`,
    leads == null ? '📋 Лиды: нет данных' : `📋 Лидов за день: ${leads}`,
    '',
    '👥 Подписчики:',
    ...(lines.length ? lines : ['нет данных']),
  ].join('\n');

  if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: txt }),
    }).catch(() => {});
  }
  return txt;
}

// ── 5. Запуск: отчёт в 20:00 МСК ─────────────────────────────────────────────
let started = false;
export function startMissionEngine() {
  if (started) return; started = true;
  console.log(`[Mission] 🎯 Engine запущен: отбор score≥${MIN_SCORE}, отчёт в 20:00 МСК, каналы: ${MY_CHANNELS.join(', ')}`);
  let lastReport = '';
  setInterval(async () => {
    const msk = new Date(Date.now() + 3 * 3600e3);
    const hh = msk.getUTCHours(), key = msk.toISOString().slice(0, 10);
    if (hh === 20 && lastReport !== key) {
      lastReport = key;
      try { await dailyReport(); } catch (e) { console.error('[Mission] report:', e.message); }
    }
  }, 60_000);
}

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

// ── 1б. МАРШРУТИЗАТОР: куда пост относится и брать ли его вообще ─────────────
// Один пост из партнёрского канала → категория → НАШ канал. Чужую рекламу и оффтоп режем.
//   store — конкретное авто на продажу/пригон → @LegalAutoStore (рерайт + Shorts)
//   parts — конкретная запчасть на продажу     → @LegalAutoParts24
//   docs  — ПОЛЕЗНАЯ инфа по растаможке/СБКТС/ЭПТС/утилю/пошлинам (тренд/закон/разбор,
//           НЕ реклама конкурента) → @LegalAuto24 (тема для инфо-ролика)
//   skip  — чужая прямая реклама услуг, спам, приветствие, опрос, оффтоп
export const CHANNEL_BY_CAT = { store: '@LegalAutoStore', parts: '@LegalAutoParts24', docs: '@LegalAuto24' };
export async function classifyPost(text) {
  if (!claude) return { category: 'skip', why: 'нет ключа' };
  if (!text || text.length < 25) return { category: 'skip', why: 'слишком коротко' };
  try {
    const m = await claude.messages.create({ model: FAST, max_tokens: 60, messages: [{ role: 'user', content:
`Ты — контент-диспетчер автобизнеса LegalAuto (пригон авто, запчасти, документы). Определи, КУДА отнести пост из чужого Telegram-канала и брать ли его.
Категории:
- "store": конкретное АВТО на продажу/пригон (есть марка+модель, цена/год/пробег).
- "parts": конкретная ЗАПЧАСТЬ на продажу (деталь + авто).
- "docs": ПОЛЕЗНАЯ инфа по растаможке/СБКТС/ЭПТС/утильсбору/пошлинам/ввозу — новость, изменение закона, разбор, лайфхак. НЕ прямая реклама услуг брокера.
- "skip": прямая реклама УСЛУГ конкурента (с их ценами/контактами), спам, приветствие, опрос, оффтоп, мемы.
Верни ТОЛЬКО JSON: {"category":"store|parts|docs|skip","why":"3-5 слов"}
Пост: "${String(text).slice(0, 700)}"` }] });
    const r = JSON.parse(m.content[0].text.match(/\{[\s\S]*\}/)[0]);
    const category = ['store', 'parts', 'docs', 'skip'].includes(r.category) ? r.category : 'skip';
    return { category, why: String(r.why || ''), channel: CHANNEL_BY_CAT[category] };
  } catch { return { category: 'skip', why: 'ошибка классификации' }; }
}

// Очередь идей контента (docs/parts) — Эдо смотрит и превращает в ролик/пост
export function queueContentIdea(category, source, text, why) {
  const cur = getSection('content_ideas') || {};
  const list = Array.isArray(cur.list) ? cur.list : [];
  list.unshift({ at: new Date().toISOString(), category, source, why, text: String(text).slice(0, 400) });
  setSection('content_ideas', { list: list.slice(0, 60) });
  stateEvent('content_idea', { note: `${category}: ${why}` });
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

// ── 3б. ВОРОНКА ИСТОЧНИКОВ: клик по ссылке (?start=yt_...) → лид ─────────────
// Показывает, КАКОЙ ролик/пост реально приводит клиентов.
export function recordSource(source, kind /* 'click' | 'lead' */) {
  if (!source) return;
  const funnel = getSection('funnel') || {};
  const day = funnel[today()] || {};
  const src = day[source] || { clicks: 0, leads: 0 };
  src[kind === 'lead' ? 'leads' : 'clicks']++;
  day[source] = src; funnel[today()] = day;
  setSection('funnel', funnel);
  stateEvent('funnel_' + kind, { note: source });
}

// Сводка по источникам за N дней: { source: {clicks, leads} }
export function sourceSummary(days = 7) {
  const funnel = getSection('funnel') || {};
  const from = Date.now() - days * 864e5;
  const out = {};
  for (const [d, srcs] of Object.entries(funnel)) {
    if (!/^\d{4}-/.test(d) || Date.parse(d) < from) continue;
    for (const [src, v] of Object.entries(srcs)) {
      out[src] = out[src] || { clicks: 0, leads: 0 };
      out[src].clicks += v.clicks || 0; out[src].leads += v.leads || 0;
    }
  }
  return out;
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
    ...(() => {
      const srcs = Object.entries(sourceSummary(1)).sort((a, b) => b[1].leads - a[1].leads || b[1].clicks - a[1].clicks).slice(0, 5);
      return srcs.length ? ['', '🔗 Откуда пришли (клики → лиды):', ...srcs.map(([k, v]) => `• ${k}: ${v.clicks} → ${v.leads}`)] : [];
    })(),
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

// ── 4б. АНАЛИТИК РАЗВИТИЯ: сам учится на данных недели и ищет пути заработка ──
// Раз в неделю (вс 19:00 МСК): анализ статистики + свежие новости → чему научились,
// что внедрить, где деньги. Отчёт Эдо. Уроки копятся в State (lessons) — память растёт.
export async function growthReport() {
  if (!claude) return null;
  const { HEAVY } = await import('../agents/models.js');
  const mission = getSection('mission') || {};
  const week = Object.entries(mission).filter(([k]) => /^\d{4}-/.test(k)).slice(-7);
  const lessons = (getSection('lessons') || {}).list || [];
  let news = [];
  try { const nb = await import('../bots/newsBot.js'); news = await nb.fetchFreshNews(5); } catch {}
  const { docsTotals } = await import('./docsCrm.js');
  const dt = docsTotals();

  const m = await claude.messages.create({ model: HEAVY, max_tokens: 900, messages: [{ role: 'user', content:
`Ты — аналитик развития LegalAuto (пригон авто из Китая/Кореи, б/у запчасти BMW/Geely/Li, документы СБКТС/ЭПТС/утиль). Проанализируй неделю и предложи, где заработать.

ДАННЫЕ НЕДЕЛИ (день: просмотрено постов партнёров / отобрано / опубликовано / роликов):
${week.map(([d, v]) => `${d}: ${v.scanned || 0}/${v.picked || 0}/${v.published || 0}/${v.video || 0}`).join('\n') || 'данных мало'}
Подписчики: ${JSON.stringify(mission.subs || {})}
Документы: заказов ${dt.count}, выручка ${dt.total.revenue}₽, маржа ${dt.total.margin}₽
Прошлые уроки (не повторяй их): ${lessons.slice(-5).map(l => l.text).join(' | ') || 'нет'}
Свежие новости рынка: ${news.map(n => n.title).join(' | ') || 'нет'}

Верни ТОЛЬКО JSON:
{"learned":["2-3 конкретных урока из ЭТИХ цифр (что работает/не работает)"],"ideas":[{"idea":"конкретная идея заработка/роста","why":"почему сработает — из данных или новостей","first_step":"первый шаг на этой неделе"}],"warning":"главный риск недели или пусто"}
Идей — 3, конкретных для этого бизнеса. Без воды.` }] });

  let r;
  try { r = JSON.parse(m.content[0].text.match(/\{[\s\S]*\}/)[0]); } catch { return null; }
  // копим уроки — «сам учится»
  const cur = getSection('lessons') || {};
  const list = Array.isArray(cur.list) ? cur.list : [];
  for (const t of r.learned || []) list.push({ at: new Date().toISOString().slice(0, 10), text: t });
  setSection('lessons', { list: list.slice(-60) });

  const txt = [
    '🧠 Аналитик развития — недельный отчёт',
    '',
    '📚 Чему научился на этой неделе:',
    ...(r.learned || []).map(l => `• ${l}`),
    '',
    '💡 Где заработать (внедряем?):',
    ...(r.ideas || []).map((i, n) => `${n + 1}. ${i.idea}\n   Почему: ${i.why}\n   Первый шаг: ${i.first_step}`),
    r.warning ? `\n⚠️ Риск: ${r.warning}` : '',
  ].filter(Boolean).join('\n');

  if (ADMIN_BOT_TOKEN && ADMIN_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: txt }),
    }).catch(() => {});
  }
  stateEvent('growth_report', { note: (r.ideas || []).map(i => i.idea).join('; ').slice(0, 120) });
  return txt;
}

// ── 5. Запуск: отчёт в 20:00 МСК ─────────────────────────────────────────────
let started = false;
export function startMissionEngine() {
  if (started) return; started = true;
  console.log(`[Mission] 🎯 Engine запущен: отбор score≥${MIN_SCORE}, отчёт в 20:00 МСК, каналы: ${MY_CHANNELS.join(', ')}`);
  let lastReport = '', lastGrowth = '';
  setInterval(async () => {
    const msk = new Date(Date.now() + 3 * 3600e3);
    const hh = msk.getUTCHours(), key = msk.toISOString().slice(0, 10);
    if (hh === 20 && lastReport !== key) {
      lastReport = key;
      try { await dailyReport(); } catch (e) { console.error('[Mission] report:', e.message); }
    }
    // Аналитик развития: воскресенье 19:00 МСК
    if (msk.getUTCDay() === 0 && hh === 19 && lastGrowth !== key) {
      lastGrowth = key;
      try { await growthReport(); } catch (e) { console.error('[Mission] growth:', e.message); }
    }
  }, 60_000);
}

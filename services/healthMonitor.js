/**
 * LegalAuto — Health Monitor + жнец зависших задач.
 * Никаких AI-менеджеров: только код + Platform State.
 *
 *   startHealthMonitor()  — цикл каждые 30 мин + жнец каждые 5 мин
 *   runHealthCheck()      — все проверки сейчас → отчёт (инструмент Jarvis «здоровье платформы»)
 *
 * Проверки: jarvis_bot, client_bot, admin_bot (getMe/heartbeat), ядро процесса,
 * YouTube (refresh token), OpenAI ключ, Claude ключ, GAS/каталог, AutoPost, зависшие задачи.
 * Докладывает Эдо ТОЛЬКО при смене статуса (сломалось/починилось) — без спама.
 */
import { getState, setSection, getSection, updateTask, logEvent, heartbeat } from './stateService.js';

const ENV = process.env;
const CHECK_EVERY_MIN = Number(ENV.HEALTH_CHECK_MIN || 30);
const REAP_EVERY_MIN = 5;
// лимиты «зависла» по типу задачи (мин): рендер видео долгий, остальное быстрое
const STUCK_LIMITS = { video_product: 40, video_info: 40, video_cinematic: 50, default: 30 };

async function notifyEdo(text) {
  if (!ENV.ADMIN_BOT_TOKEN || !ENV.ADMIN_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${ENV.ADMIN_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ENV.ADMIN_CHAT_ID, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

const t8 = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ── Отдельные проверки: каждая → { ok, note } ────────────────────────────────
async function checkBot(name, token) {
  if (!token) return { ok: false, note: 'токен не задан' };
  try {
    const r = await t8(fetch(`https://api.telegram.org/bot${token}/getMe`));
    const d = await r.json();
    return d.ok ? { ok: true, note: '@' + d.result.username } : { ok: false, note: d.description || 'getMe failed' };
  } catch (e) { return { ok: false, note: e.message }; }
}

async function checkYouTube() {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = ENV;
  if (!YT_CLIENT_ID || !YT_REFRESH_TOKEN) return { ok: false, note: 'YT_* не заданы' };
  try {
    const r = await t8(fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    }));
    const d = await r.json();
    return d.access_token ? { ok: true, note: 'токен обновляется' } : { ok: false, note: d.error_description || d.error || 'нет access_token' };
  } catch (e) { return { ok: false, note: e.message }; }
}

async function checkOpenAI() {
  const key = ENV.OPENAI_API_KEY || ENV.OPENAI_API_KEY_BACKUP;
  if (!key) return { ok: false, note: 'ключ не задан' };
  try {
    const r = await t8(fetch('https://api.openai.com/v1/models?limit=1', { headers: { Authorization: `Bearer ${key}` } }));
    return r.ok ? { ok: true, note: 'ключ работает' } : { ok: false, note: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, note: e.message }; }
}

async function checkClaude() {
  if (!ENV.CLAUDE_API_KEY) return { ok: false, note: 'ключ не задан' };
  try {
    const r = await t8(fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': ENV.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
    }));
    return r.ok ? { ok: true, note: 'ключ работает' } : { ok: false, note: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, note: e.message }; }
}

async function checkCatalog() {
  const SID = ENV.SPREADSHEET_ID || '1oxJ1wdyjReC6fCarq0PsmO-T1TSW9FqqLeksQyKRZE8';
  try {
    const r = await t8(fetch(`https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?tqx=out:csv&headers=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }), 12000);
    const t = await r.text();
    const rows = t.split('\n').length;
    return rows > 100 ? { ok: true, note: `~${rows} строк` } : { ok: false, note: `только ${rows} строк` };
  } catch (e) { return { ok: false, note: e.message }; }
}

function checkHeartbeat(name, maxMin = 15) {
  const hb = getState().heartbeats[name];
  if (!hb) return { ok: false, note: 'нет heartbeat' };
  const ageMin = Math.round((Date.now() - Date.parse(hb.at)) / 60000);
  return ageMin <= maxMin ? { ok: true, note: `${ageMin} мин назад` } : { ok: false, note: `молчит ${ageMin} мин` };
}

function checkAutoPost() {
  const s = getSection('autopost');
  if (!s?.last_at) return { ok: false, note: 'ещё не отработал (после этого деплоя)' , soft: true };
  const ageH = (Date.now() - Date.parse(s.last_at)) / 3600000;
  return ageH <= 8 ? { ok: true, note: `последний ${Math.round(ageH * 10) / 10} ч назад` } : { ok: false, note: `не постил ${Math.round(ageH)} ч` };
}

// ── Жнец зависших задач ──────────────────────────────────────────────────────
export function reapStuckTasks() {
  const state = getState();
  const now = Date.now();
  const reaped = [];
  for (const t of Object.values(state.tasks)) {
    if (!['created', 'processing'].includes(t.status)) continue;
    const limitMin = STUCK_LIMITS[t.type] || STUCK_LIMITS.default;
    const ageMin = (now - Date.parse(t.updated_at)) / 60000;
    if (ageMin > limitMin) {
      // помечаем failed (updateTask сам доложит Эдо); дубль НЕ перезапускаем — только с подтверждения
      updateTask(t.id, { status: 'failed', error: `зависла: ${Math.round(ageMin)} мин в ${t.status} (лимит ${limitMin}). Перезапуск — только по команде Эдо.` });
      reaped.push(`#${t.id} ${t.type}`);
    }
  }
  if (reaped.length) logEvent('reaper', { note: `пожато зависших: ${reaped.join(', ')}` });
  return reaped;
}

// ── Полная проверка здоровья ─────────────────────────────────────────────────
export async function runHealthCheck() {
  const [jarvis, client, admin, yt, openai, claude, catalog] = await Promise.all([
    checkBot('jarvis_bot', ENV.JARVIS_BOT_TOKEN),
    checkBot('client_bot', ENV.CLIENT_BOT_TOKEN),
    checkBot('admin_bot', ENV.ADMIN_BOT_TOKEN),
    checkYouTube(), checkOpenAI(), checkClaude(), checkCatalog(),
  ]);
  const checks = {
    jarvis_bot: jarvis, client_bot: client, admin_bot: admin,
    core_process: checkHeartbeat('core', 10),
    autopilot: checkHeartbeat('autopilot', 20),
    youtube: yt, openai_key: openai, claude_key: claude, gas_catalog: catalog,
    autopost: checkAutoPost(),
  };
  const stuck = reapStuckTasks();
  const failedTasks = Object.values(getState().tasks).filter(t => t.status === 'failed')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  setSection('health', {
    checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, `${v.ok ? 'ok' : 'FAIL'}: ${v.note}`])),
    stuck_reaped: stuck.length,
  });
  heartbeat('health_monitor', { note: `проверок: ${Object.keys(checks).length}` });
  return { checks, stuck, failedTasks };
}

// Форматированный отчёт («здоровье платформы» для Jarvis/Эдо)
export function formatHealth({ checks, stuck, failedTasks }) {
  const line = ([k, v]) => `${v.ok ? '🟢' : '🔴'} ${k}: ${v.note}`;
  const alive = Object.entries(checks).filter(([, v]) => v.ok).map(line);
  const broken = Object.entries(checks).filter(([, v]) => !v.ok && !v.soft).map(line);
  const soft = Object.entries(checks).filter(([, v]) => !v.ok && v.soft).map(line);
  const actions = [];
  if (checks.youtube && !checks.youtube.ok) actions.push('YouTube: перевыпустить YT_REFRESH_TOKEN');
  if (checks.openai_key && !checks.openai_key.ok) actions.push('OpenAI: проверить/заменить ключ');
  if (checks.claude_key && !checks.claude_key.ok) actions.push('Claude: проверить/заменить ключ');
  if (failedTasks.length) actions.push(`Провальные задачи (${failedTasks.length}) — скажи «перезапусти #id», сам дубли не запускаю`);
  return [
    '🏥 ЗДОРОВЬЕ ПЛАТФОРМЫ',
    `\nЖИВО (${alive.length}):\n${alive.join('\n') || '—'}`,
    broken.length ? `\nСЛОМАНО (${broken.length}):\n${broken.join('\n')}` : '\nСЛОМАНО: ничего 🎉',
    soft.length ? `\nЖДЁТ ПЕРВОГО ЗАПУСКА:\n${soft.join('\n')}` : '',
    stuck.length ? `\nЗАВИСЛО (пожато жнецом): ${stuck.join(', ')}` : '',
    failedTasks.length ? `\nПоследние провалы:\n${failedTasks.map(t => `#${t.id} ${t.type}: ${String(t.error).slice(0, 90)}`).join('\n')}` : '',
    actions.length ? `\n⚠️ ТРЕБУЕТ ТВОЕГО ДЕЙСТВИЯ:\n${actions.map(a => '• ' + a).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// ── Цикл: доклад только при СМЕНЕ статуса (не спамим) ────────────────────────
let lastStatus = {};   // name → ok
async function cycle() {
  try {
    const res = await runHealthCheck();
    const changes = [];
    for (const [k, v] of Object.entries(res.checks)) {
      if (lastStatus[k] === undefined) { lastStatus[k] = v.ok; continue; }   // первый прогон — калибровка
      if (lastStatus[k] !== v.ok) {
        changes.push(v.ok ? `✅ ПОЧИНИЛОСЬ: ${k} (${v.note})` : `🔴 СЛОМАЛОСЬ: ${k} (${v.note})`);
        lastStatus[k] = v.ok;
      }
    }
    if (changes.length) await notifyEdo(`🏥 Health Monitor:\n${changes.join('\n')}`);
  } catch (e) { console.error('[Health] cycle:', e.message); }
}

export function startHealthMonitor() {
  setTimeout(cycle, 90_000);                          // первый прогон после стабилизации
  setInterval(cycle, CHECK_EVERY_MIN * 60_000);       // полный чек каждые 30 мин
  setInterval(() => { try { reapStuckTasks(); } catch {} }, REAP_EVERY_MIN * 60_000);   // жнец каждые 5 мин
  console.log(`🏥 [Health] Монитор запущен: чек каждые ${CHECK_EVERY_MIN} мин, жнец каждые ${REAP_EVERY_MIN} мин`);
}

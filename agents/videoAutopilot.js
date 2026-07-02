/**
 * LegalAuto — Видео-автопилот. 2 ролика в день сами, без команд.
 *
 *   11:00 МСК — Product Short: реальные запчасти из каталога (тема дня) → YouTube + Telegram
 *   17:00 МСК — Кино-ролик (make_cinematic): документы/пригон/советы по ротации → YouTube + Telegram
 *
 * Ротация тем — детерминированная по дню года (переживает рестарты без файлов состояния).
 * Отчёт о каждом ролике приходит Эдо (ADMIN_CHAT_ID).
 * Выключатель: VIDEO_AUTOPILOT=false в env.
 */
import { makeProductShort, makeCinematicShort } from './contentAgent.js';

const ENABLED = process.env.VIDEO_AUTOPILOT !== 'false';
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Тема запчастей по дню (утренний слот) — категории чередуются, марка выбирается сама
const PART_THEMES = ['кузовные', 'оптика', 'подвеска', 'электрика', 'салон', 'тормоза', ''];

// Вечерний слот: кино-ролики по направлениям (документы/пригон чередуются)
const CINE_TOPICS = [
  { topic: 'как оформить СБКТС и ЭПТС на ввезённое авто', direction: 'docs' },
  { topic: 'пригон авто из Китая под ключ: как это работает', direction: 'auto' },
  { topic: 'утильсбор 2026: льгота до 160 л.с. — что нужно знать', direction: 'docs' },
  { topic: 'пригон авто из Кореи: сроки, цены, гарантии', direction: 'auto' },
  { topic: 'растаможка авто: из чего складывается цена', direction: 'docs' },
  { topic: '5 ошибок при самостоятельном пригоне авто', direction: 'auto' },
  { topic: 'оригинальные запчасти с разборки: почему это выгодно', direction: 'parts' },
  { topic: 'электронный ПТС за 1 день: как мы это делаем', direction: 'docs' },
  { topic: 'подбор авто в Китае по вашему бюджету', direction: 'auto' },
  { topic: 'таможенное оформление под ключ: все документы за вас', direction: 'docs' },
];

function dayOfYear() {
  const now = new Date(Date.now() + 3 * 3600 * 1000); // МСК
  return Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 0))) / 86400000);
}

async function notifyEdo(text) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

let running = false;

async function morningSlot() {
  if (running) return; running = true;
  try {
    const theme = PART_THEMES[dayOfYear() % PART_THEMES.length];
    console.log(`[Autopilot] 🎬 Утренний ролик: запчасти${theme ? ' (' + theme + ')' : ''}`);
    const r = await makeProductShort({ platforms: ['youtube', 'telegram'], theme });
    await notifyEdo(r.ok
      ? `🤖 Автопилот: утренний ролик готов ✅${theme ? `\nТема: ${theme}` : ''}\n${r.ytUrl || ''}${r.tgOk ? '\n+ Telegram' : ''}\nЗапчасти: ${(r.partsUsed || []).slice(0, 4).join(', ')}`
      : `🤖 Автопилот: утренний ролик не вышел ❌\n${r.error}`);
  } catch (e) {
    console.error('[Autopilot] morning:', e.message);
    await notifyEdo(`🤖 Автопилот: сбой утреннего ролика ❌ ${e.message.slice(0, 150)}`);
  } finally { running = false; }
}

async function eveningSlot() {
  if (running) return; running = true;
  try {
    const { topic, direction } = CINE_TOPICS[dayOfYear() % CINE_TOPICS.length];
    console.log(`[Autopilot] 🎬 Вечерний кино-ролик: ${topic} (${direction})`);
    const r = await makeCinematicShort({ topic, direction, platforms: ['youtube', 'telegram'] });
    await notifyEdo(r.ok
      ? `🤖 Автопилот: вечерний кино-ролик готов ✅\nТема: ${topic}\n${r.ytUrl || ''}${r.tgOk ? '\n+ Telegram' : ''}`
      : `🤖 Автопилот: вечерний ролик не вышел ❌\n${r.error}`);
  } catch (e) {
    console.error('[Autopilot] evening:', e.message);
    await notifyEdo(`🤖 Автопилот: сбой вечернего ролика ❌ ${e.message.slice(0, 150)}`);
  } finally { running = false; }
}

export function startVideoAutopilot() {
  if (!ENABLED) { console.log('[Autopilot] выключен (VIDEO_AUTOPILOT=false)'); return; }
  let lastFired = '';
  setInterval(() => {
    const msk = new Date(Date.now() + 3 * 3600 * 1000);
    const hhmm = `${String(msk.getUTCHours()).padStart(2, '0')}:${String(msk.getUTCMinutes()).padStart(2, '0')}`;
    const key = `${msk.getUTCDate()}_${hhmm}`;
    if (lastFired === key) return;
    if (hhmm === '11:00') { lastFired = key; morningSlot(); }
    if (hhmm === '17:00') { lastFired = key; eveningSlot(); }
  }, 60_000);
  console.log('🎬 [Autopilot] Видео-автопилот запущен: 11:00 (запчасти) и 17:00 (кино) МСК');
}

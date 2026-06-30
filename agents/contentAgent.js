/**
 * LegalAuto — Контент-завод (фабрика Shorts/Reels).
 * Запускается из Jarvis или по расписанию.
 *
 *   makeProductShort({ platforms, lengthSec }) → { ok, ytUrl, tgOk, partsUsed, error }
 *
 * - Берёт РЕАЛЬНЫЕ запчасти из каталога, КОТОРЫЕ ЕЩЁ НЕ БРАЛИСЬ для этих платформ
 * - Музыка из assets/music (приоритет), фото товара, вирусный сценарий
 * - Грузит на YouTube (+ Telegram), помечает запчасти как использованные
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { renderProduct } from './videoAgent.js';
import { uploadShort } from './youtubeUpload.js';
import { HEAVY } from './models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USED_FILE = join(ROOT, 'data', 'video_used.json');
const MUSIC_DIR = join(ROOT, 'assets', 'music');
const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

function loadUsed() { try { return JSON.parse(readFileSync(USED_FILE, 'utf8')); } catch { return {}; } }
function saveUsed(u) { try { writeFileSync(USED_FILE, JSON.stringify(u, null, 1)); } catch {} }
function pickMusic() {
  try {
    const files = readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) return null;
    return join(MUSIC_DIR, files[Math.floor(Math.random() * files.length)]);
  } catch { return null; }
}

async function gasCatalog(limit = 40) {
  const GAS = process.env.APPS_SCRIPT_API_URL;
  let d = null;
  for (let i = 0; i < 3 && !d; i++) {
    try {
      const r = await fetch(`${GAS}?action=catalog&limit=${limit}`, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' } });
      const t = await r.text();
      d = JSON.parse(t);
    } catch { await new Promise(res => setTimeout(res, 2000)); }
  }
  if (!d) throw new Error('GAS каталог недоступен (вернул не JSON)');
  return (d.products || d.parts || []).filter(p => (p.photo || p.photo_cover || '').includes('yandexcloud'));
}

export async function makeProductShort({ platforms = ['youtube'], lengthSec = 18 } = {}) {
  if (!claude) return { ok: false, error: 'CLAUDE_API_KEY не задан' };
  const music = pickMusic();
  if (!music) return { ok: false, error: 'Нет музыки. Закинь mp3-биты в assets/music/ — без музыки ролики не делаем.' };

  // 1) запчасти, которые ещё НЕ брались для этих платформ
  const used = loadUsed();
  const all = await gasCatalog(60);
  const fresh = all.filter(p => {
    const key = String(p.oem || p.id || p.name);
    const u = used[key] || [];
    return !platforms.every(pl => u.includes(pl));   // берём, если не на всех целевых платформах
  });
  const pool = fresh.length >= 4 ? fresh : all;       // если свежих мало — берём из всех
  const parts = pool.slice(0, 6);
  if (parts.length < 3) return { ok: false, error: 'Мало фото запчастей в каталоге' };

  // items: КАЖДАЯ запчасть со своим названием и ценой (текст совпадает с фото)
  const items = parts.map(p => ({
    photo: p.photo || p.photo_cover,
    name: p.name,
    price: p.price ? Number(p.price).toLocaleString('ru-RU') + ' ₽' : '',
    fits: [p.brand, (p.model || p.series || '').replace(/\|/g, '/')].filter(Boolean).join(' ').trim(),
  }));

  // 2) хук + заголовок (на «вы», без «золотых гор» — по брендбуку)
  const m = await claude.messages.create({ model: HEAVY, max_tokens: 350, messages: [{ role: 'user', content:
`Короткий вирусный хук и заголовок для Shorts про б/у запчасти BMW из Европы (LegalAuto Parts). Тон по брендбуку: на «вы», прямо и по фактам, БЕЗ обещаний «золотых гор» и слова «копейки».
JSON: {"title":"до 80 симв, 1 эмодзи","description":"2 строки + #shorts #bmw #запчасти","hook":"3-4 слова крупно (интрига/выгода)"}
запчасти в ролике: ${parts.map(p => p.name).join(', ')}` }] });
  const s = JSON.parse(m.content[0].text.trim().replace(/^```json?|```$/g, ''));

  // 3) рендер: музыка + по сцене на запчасть (фото + название + цена)
  const { path, cleanup } = await renderProduct({
    musicPath: music, items, hook: s.hook,
    cta: 'Заказ запчасти', channel: '@LegalAutoParts24', accent: '#FF6B00',
  });

  const result = { ok: true, partsUsed: parts.map(p => p.name), title: s.title };

  // 4) YouTube
  if (platforms.includes('youtube')) {
    try { const yt = await uploadShort({ path, title: s.title, description: s.description, tags: ['shorts','bmw','запчасти','LegalAuto'] }); result.ytUrl = yt.url; }
    catch (e) { result.ytError = e.message; }
  }
  // 5) Telegram (@LegalAutoParts24 через CHANNEL_BOT_TOKEN/ADMIN_BOT_TOKEN)
  if (platforms.includes('telegram')) {
    const token = process.env.CHANNEL_BOT_TOKEN || process.env.ADMIN_BOT_TOKEN;
    const chan = process.env.PARTS_CHANNEL || process.env.CHANNEL_ID || '@LegalAutoParts24';
    if (token) {
      try {
        const fd = new FormData();
        fd.append('chat_id', String(chan)); fd.append('caption', s.title); fd.append('supports_streaming', 'true');
        fd.append('video', new Blob([readFileSync(path)], { type: 'video/mp4' }), 'short.mp4');
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: fd });
        result.tgOk = (await r.json()).ok;
      } catch (e) { result.tgError = e.message; }
    }
  }

  // 6) помечаем запчасти использованными по платформам
  for (const p of parts) {
    const key = String(p.oem || p.id || p.name);
    used[key] = Array.from(new Set([...(used[key] || []), ...platforms]));
  }
  saveUsed(used);
  cleanup();
  return result;
}

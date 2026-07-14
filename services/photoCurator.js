/**
 * LegalAuto — Фото-редактор (AI-сотрудник контроля качества).
 *
 * Сам отбирает ЛУЧШИЕ фото из альбома объявления: без чужих водяных знаков,
 * машина целиком в кадре, чёткие, правильный ракурс. Отсеивает мусор.
 * Дёшево: 1 vision-вызов Haiku на весь альбом (не по фото).
 *
 *   curatePhotos(urls, { want }) → [{ url, buffer }]  (ранжировано, лучшие первыми)
 */
import Anthropic from '@anthropic-ai/sdk';
import { FAST } from '../agents/models.js';

const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

async function dl(url) {
  try {
    const r = await Promise.race([
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 15000 ? buf : null;   // отсекаем битые/превью-миниатюры
  } catch { return null; }
}

// Размеры JPEG из заголовка (без зависимостей) — чтобы не брать «узкие»/битые
function jpegSize(buf) {
  try {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xC3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch {}
  return null;
}

/** Отобрать лучшие фото: скачать → отсеять мусор по размеру → vision-ранжирование */
export async function curatePhotos(urls = [], { want = 6 } = {}) {
  const downloaded = [];
  for (const url of urls.slice(0, 10)) {
    const buffer = await dl(url);
    if (!buffer) continue;
    const sz = jpegSize(buffer);
    // отсеиваем крошечные и экстремально узкие (панорамы/коллажи)
    if (sz && (Math.min(sz.w, sz.h) < 400 || sz.w / sz.h > 2.4 || sz.h / sz.w > 2.4)) continue;
    downloaded.push({ url, buffer, sz });
  }
  if (!downloaded.length) return [];
  if (downloaded.length <= 2 || !claude) return downloaded.slice(0, want);

  // Vision-оценка Haiku: один вызов на весь альбом (дёшево)
  try {
    const imgs = downloaded.slice(0, 8);
    const content = [
      { type: 'text', text:
`Ты — фотоотдел премиум-автосалона LegalAuto. Перед тобой фото одного авто из объявления (по порядку 0..${imgs.length - 1}).
Ранжируй для рекламного Shorts. ПЕРВЫМ — кузов ЦЕЛИКОМ, ракурс три четверти спереди (или сбоку/сзади), чёткое, светлое. Дальше чередуй: экстерьер → салон/панель → детали. Водяные знаки НЕ помеха — не отсеивай за них.
reject — ТОЛЬКО настоящий мусор: документы/скрины, сильно размытое, тёмное до неразличимости, фото где машины нет.
Верни ТОЛЬКО JSON: {"order":[индексы от лучшего к худшему], "reject":[индексы мусора]}.` },
    ];
    for (const im of imgs) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.buffer.toString('base64') } });
    const m = await claude.messages.create({ model: FAST, max_tokens: 200, messages: [{ role: 'user', content }] });
    const raw = m.content[0].text.match(/\{[\s\S]*\}/);
    const r = raw ? JSON.parse(raw[0]) : {};
    const reject = new Set(Array.isArray(r.reject) ? r.reject : []);
    const order = (Array.isArray(r.order) ? r.order : imgs.map((_, i) => i)).filter(i => !reject.has(i) && imgs[i]);
    // если после отсева слишком мало — добираем не-мусорными по остатку
    for (let i = 0; i < imgs.length; i++) if (!order.includes(i) && !reject.has(i)) order.push(i);
    const ranked = order.map(i => ({ url: imgs[i].url, buffer: imgs[i].buffer }));
    if (ranked.length) { console.log(`[PhotoCurator] из ${downloaded.length} фото отобрано ${ranked.length}, отсеяно ${reject.size} (клейма/мусор)`); return ranked.slice(0, want); }
  } catch (e) { console.error('[PhotoCurator] vision:', e.message); }

  // фолбэк: по размеру (крупнее = качественнее)
  return downloaded.sort((a, b) => (b.buffer.length) - (a.buffer.length)).slice(0, want);
}

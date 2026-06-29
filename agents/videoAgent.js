/**
 * LegalAuto — Video Agent (видеозавод на Remotion)
 *
 * Рендерит вертикальные Reels (1080x1920) с моушн-дизайном из реальных данных.
 * Композиции — в /remotion (React). Данные привязаны к авто: текст всегда
 * соответствует фото (никакого хардкода). Фото показываются ЦЕЛИКОМ на размытой
 * подложке — без растяжки.
 *
 * Экспорт:
 *   renderReel(props) → { path, dir, cleanup }
 *   props: { kind, brand, model, tagline, specs[], price, priceLabel, location, cta, photos[] }
 *
 * Требует: chromium (PUPPETEER_EXECUTABLE_PATH) — есть в nixpacks.
 */

import { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, ensureBrowser } from '@remotion/renderer';
import Anthropic from '@anthropic-ai/sdk';

import { extractPriceFromText } from './priceUtil.js';

const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

export { extractPriceFromText };

// Извлекаем СТРОГО из текста поста чистые данные для ролика (без выдумок).
// Гарантирует, что текст совпадает с фото того же объявления.
export async function extractReelData(text, kind = 'car') {
  if (!claude) return null;
  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content:
`Из объявления об авто извлеки данные СТРОГО как написано (ничего не выдумывай, чего нет — пропусти). Верни ТОЛЬКО JSON:
{"brand":"марка одним словом","model":"модель кратко без года и кодов двигателя","tagline":"короткий хук до 5 слов","specs":[{"label":"Год","value":"2022"},{"label":"Пробег","value":"17 000 км"},{"label":"Двигатель","value":"1.4T"},{"label":"Привод","value":"передний"}],"price":"2 050 000 ₽","location":"из Китая"}
Правила: price — число с разрядами и знаком ₽, как в тексте. specs — только реально указанные, максимум 4. Без markdown.

Объявление:
"${String(text).slice(0, 700)}"`,
      }],
    });
    const raw = msg.content[0].text.trim().replace(/^```json?\s*|\s*```$/g, '');
    const d = JSON.parse(raw);
    // Цена — только детерминированно из текста; Claude к ней не прикасается
    const price = extractPriceFromText(text) || String(d.price || '');
    return {
      kind,
      brand: String(d.brand || '').toUpperCase(),
      model: String(d.model || ''),
      tagline: String(d.tagline || ''),
      specs: Array.isArray(d.specs) ? d.specs.filter(s => s && s.label && s.value).slice(0, 4) : [],
      price,
      priceLabel: 'под ключ в России',
      location: d.location ? `${d.location} · доставка 6-8 недель` : '',
      cta: kind === 'part' ? 'Заказ → @LegalAutoAssist_bot' : 'Заказ авто → @LegalAuto247',
    };
  } catch (e) {
    console.error('[Video] extractReelData:', e.message);
    return null;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENTRY = join(ROOT, 'remotion', 'index.ts');

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
}

// Бандл Remotion-проекта кэшируем (дорого делать каждый раз)
let bundlePromise = null;
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: ENTRY,
      // публичная папка remotion/public (шрифты) подхватывается автоматически
    }).catch((e) => { bundlePromise = null; throw e; });
  }
  return bundlePromise;
}

// ── Вирусный Short: Sora-видео + музыка + хук/субтитры + CTA ───────────────
const PUBLIC_DIR = join(ROOT, 'remotion', 'public');

export async function renderViral({ soraPath, musicPath, ...props }) {
  const dir = mkdtempSync(join(tmpdir(), 'viral-'));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  const out = join(dir, 'viral.mp4');
  try {
    if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
    cpSync(soraPath, join(PUBLIC_DIR, 'sora.mp4'));
    if (musicPath && existsSync(musicPath)) cpSync(musicPath, join(PUBLIC_DIR, 'music.mp3'));

    const exec = chromePath();
    await ensureBrowser(exec ? { browserExecutable: exec } : undefined).catch(() => {});
    // пере-бандлим (ассеты sora/music меняются каждый раз)
    const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR });
    const inputProps = { soraFile: 'sora.mp4', musicFile: musicPath ? 'music.mp3' : undefined, ...props };
    const composition = await selectComposition({ serveUrl, id: 'ViralShort', inputProps, browserExecutable: exec });
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: out, inputProps,
      browserExecutable: exec, publicDir: PUBLIC_DIR, concurrency: 1,
      chromiumOptions: { gl: 'swiftshader' }, x264Preset: 'veryfast', crf: 23,
    });
    return { path: out, dir, cleanup };
  } catch (e) { cleanup(); throw e; }
}

export async function renderReel(props) {
  const dir = mkdtempSync(join(tmpdir(), 'reel-'));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  const out = join(dir, 'reel.mp4');

  try {
    const exec = chromePath();
    await ensureBrowser(exec ? { browserExecutable: exec } : undefined).catch(() => {});

    const serveUrl = await getBundle();
    const inputProps = normalizeProps(props);

    const composition = await selectComposition({
      serveUrl,
      id: 'CarReel',
      inputProps,
      browserExecutable: exec,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: out,
      inputProps,
      browserExecutable: exec,
      concurrency: 1,                 // бережём память Railway
      chromiumOptions: { gl: 'swiftshader' },
      x264Preset: 'veryfast',
      crf: 23,
    });

    return { path: out, dir, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// Приводим вход к ReelProps, защищаемся от пустых полей
function normalizeProps(p = {}) {
  return {
    kind: p.kind === 'part' ? 'part' : 'car',
    brand: String(p.brand || 'LegalAuto'),
    model: String(p.model || ''),
    tagline: String(p.tagline || ''),
    specs: Array.isArray(p.specs) ? p.specs.filter(s => s && s.value).slice(0, 6) : [],
    price: String(p.price || ''),
    priceLabel: String(p.priceLabel || 'цена под ключ'),
    location: String(p.location || ''),
    cta: String(p.cta || 'Пиши в @LegalAuto247'),
    photos: (Array.isArray(p.photos) ? p.photos : []).filter(Boolean).slice(0, 5),
  };
}

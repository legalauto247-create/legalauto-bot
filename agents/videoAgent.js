/**
 * LegalAuto — Video Agent (видеозавод)
 *
 * Делает вертикальные Reels (1080x1920) из реальных фото авто/запчастей:
 *   фото → Ken Burns (зум) → переходы xfade → брендовые карточки (Puppeteer) → mp4
 *
 * Текст/брендинг рендерим через Chromium (puppeteer-core) как картинки —
 * это даёт кириллицу, эмодзи и красивую вёрстку без drawtext/freetype.
 *
 * Экспорт:
 *   buildReel({ photos, title, subtitle, price, cta, badge, kind }) → { path, dir, cleanup }
 *
 * Требует на Railway: ffmpeg + chromium (оба добавлены в nixpacks.toml).
 */

import { execFile } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FONT_BOLD = join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

const W = 1080, H = 1920, FPS = 30;
const SCENE_SEC = 2.8;            // длительность фото-сцены
const CARD_SEC  = 2.4;            // длительность карточки (интро/аутро)
const XFADE     = 0.5;            // переход

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function run(bin, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${(stderr || err.message).slice(-400)}`));
      else resolve({ stdout, stderr });
    });
  });
}

// ── Поиск Chromium (как в остальном проекте) ───────────────────────────────
function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH
      || process.env.CHROME_PATH
      || '/usr/bin/chromium'
      || '/usr/bin/chromium-browser';
}

// ── Рендер HTML → PNG (брендовая карточка / оверлей) ───────────────────────
async function renderHtmlToPng(html, outPath, { transparent = false } = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outPath, omitBackground: transparent });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Шаблоны карточек ───────────────────────────────────────────────────────
const BASE_CSS = `
  *{margin:0;padding:0;box-sizing:border-box;font-family:'DejaVu Sans',sans-serif;}
  @font-face{font-family:'DejaVu Sans';src:url('file://${FONT_BOLD}');font-weight:700;}
  html,body{width:${W}px;height:${H}px;overflow:hidden;}
`;

function introCardHtml({ title, subtitle, badge, kind }) {
  const accent = kind === 'part' ? '#1d9e75' : '#185fa5';
  return `<!doctype html><html><head><style>${BASE_CSS}
    body{background:linear-gradient(160deg,#0d1117 0%,#161b22 60%,${accent} 240%);
      display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:80px;}
    .badge{font-size:38px;font-weight:700;color:#fff;background:${accent};padding:18px 44px;border-radius:60px;margin-bottom:60px;letter-spacing:1px;}
    .title{font-size:96px;font-weight:700;color:#fff;line-height:1.1;}
    .sub{font-size:46px;color:#9fb3c8;margin-top:40px;line-height:1.3;}
    .brand{position:absolute;bottom:90px;font-size:40px;font-weight:700;color:#fff;opacity:.85;}
  </style></head><body>
    <div class="badge">${esc(badge || 'LegalAuto')}</div>
    <div class="title">${esc(title)}</div>
    ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
    <div class="brand">LegalAuto</div>
  </body></html>`;
}

function outroCardHtml({ price, cta, kind }) {
  const accent = kind === 'part' ? '#1d9e75' : '#185fa5';
  return `<!doctype html><html><head><style>${BASE_CSS}
    body{background:linear-gradient(160deg,${accent} -40%,#161b22 50%,#0d1117 100%);
      display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:80px;}
    .price{font-size:108px;font-weight:700;color:#fff;line-height:1.05;}
    .pl{font-size:42px;color:#9fb3c8;margin-bottom:24px;}
    .cta{font-size:54px;font-weight:700;color:#fff;background:${accent};padding:34px 60px;border-radius:40px;margin-top:80px;line-height:1.2;}
    .brand{position:absolute;top:90px;font-size:44px;font-weight:700;color:#fff;}
  </style></head><body>
    <div class="brand">LegalAuto</div>
    ${price ? `<div class="pl">цена под ключ</div><div class="price">${esc(price)}</div>` : ''}
    <div class="cta">${esc(cta || 'Пиши в @LegalAuto247')}</div>
  </body></html>`;
}

// Постоянный оверлей: логотип сверху (накладывается на всё видео)
function watermarkHtml() {
  return `<!doctype html><html><head><style>${BASE_CSS}
    body{background:transparent;}
    .wm{position:absolute;top:60px;left:60px;font-size:46px;font-weight:700;color:#fff;
      text-shadow:0 2px 12px rgba(0,0,0,.6);}
    .dot{color:#1d9e75;}
  </style></head><body><div class="wm">Legal<span class="dot">Auto</span></div></body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Скачать фото ───────────────────────────────────────────────────────────
async function fetchPhoto(url, outPath) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!/image\//i.test(ct)) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return false;
    writeFileSync(outPath, buf);
    return true;
  } catch { return false; }
}

// ── Сцена из картинки: Ken Burns (зум in/out) ──────────────────────────────
async function makeScene(imgPath, outPath, seconds, zoomIn = true) {
  const frames = Math.round(seconds * FPS);
  const z = zoomIn
    ? `z='min(zoom+0.0011,1.12)'`
    : `z='if(lte(zoom,1.0),1.12,max(1.001,zoom-0.0011))'`;
  const vf =
    `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,` +
    `zoompan=${z}:d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`;
  await run(FFMPEG, [
    '-y', '-loop', '1', '-i', imgPath, '-vf', vf,
    '-frames:v', String(frames), '-r', String(FPS), '-an',
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', outPath,
  ]);
}

// ── Сборка финального Reel ─────────────────────────────────────────────────
export async function buildReel({ photos = [], title, subtitle, price, cta, badge, kind = 'car' }) {
  const dir = mkdtempSync(join(tmpdir(), 'reel-'));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };

  try {
    // 1) фото (до 5)
    const urls = photos.filter(Boolean).slice(0, 5);
    const imgs = [];
    for (let i = 0; i < urls.length; i++) {
      const p = join(dir, `img${i}.jpg`);
      if (await fetchPhoto(urls[i], p)) imgs.push(p);
    }
    if (imgs.length === 0) throw new Error('нет рабочих фото для видео');

    // 2) брендовые карточки
    const introPng = join(dir, 'intro.png');
    const outroPng = join(dir, 'outro.png');
    const wmPng    = join(dir, 'wm.png');
    await renderHtmlToPng(introCardHtml({ title, subtitle, badge, kind }), introPng);
    await renderHtmlToPng(outroCardHtml({ price, cta, kind }), outroPng);
    await renderHtmlToPng(watermarkHtml(), wmPng, { transparent: true });

    // 3) сцены: интро → фото(зум in/out) → аутро
    const scenes = [];
    const introScene = join(dir, 's_intro.mp4');
    await makeScene(introPng, introScene, CARD_SEC, true);
    scenes.push({ path: introScene, dur: CARD_SEC });

    for (let i = 0; i < imgs.length; i++) {
      const s = join(dir, `s${i}.mp4`);
      await makeScene(imgs[i], s, SCENE_SEC, i % 2 === 0);
      scenes.push({ path: s, dur: SCENE_SEC });
    }

    const outroScene = join(dir, 's_outro.mp4');
    await makeScene(outroPng, outroScene, CARD_SEC, false);
    scenes.push({ path: outroScene, dur: CARD_SEC });

    // 4) xfade-цепочка
    const inputs = [];
    scenes.forEach(s => { inputs.push('-i', s.path); });
    let filter = '';
    let prev = '0:v';
    let acc = scenes[0].dur;
    for (let i = 1; i < scenes.length; i++) {
      const off = (acc - XFADE).toFixed(3);
      const out = (i === scenes.length - 1) ? 'vx' : `v${i}`;
      filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${off}[${out}];`;
      prev = out;
      acc = acc + scenes[i].dur - XFADE;
    }
    filter = filter.replace(/;$/, '');
    const xfaded = join(dir, 'xfaded.mp4');
    await run(FFMPEG, [
      '-y', ...inputs, '-filter_complex', filter, '-map', '[vx]',
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-r', String(FPS), xfaded,
    ], 180000);

    // 5) водяной знак на всё видео
    const final = join(dir, 'reel.mp4');
    await run(FFMPEG, [
      '-y', '-i', xfaded, '-i', wmPng,
      '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p',
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
      '-movflags', '+faststart', final,
    ], 120000);

    return { path: final, dir, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

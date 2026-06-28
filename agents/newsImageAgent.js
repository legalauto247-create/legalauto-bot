/**
 * LegalAuto — генератор картинки-новости (бесплатно, через Chromium).
 * Рендерит брендовую карточку новости (чёрный/золото, лого LA, заголовок)
 * в стиле фирменных шаблонов. Без платных AI.
 *
 * renderNewsCard(postText) → Buffer (PNG 1080x1350) | null
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FONT_BOLD = join(ROOT, 'assets', 'fonts', 'Montserrat-Bold.ttf');
const FONT_REG  = join(ROOT, 'assets', 'fonts', 'Montserrat-Regular.ttf');
const LOGO_SVG  = join(ROOT, 'brand', 'inbox', 'logo-master.svg');

const W = 1080, H = 1350;

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
}

// Заголовок из текста поста: первая содержательная строка, без markdown/эмодзи
function deriveTitle(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let t = lines[0] || 'Новости авторынка';
  t = t.replace(/[*_`#>]/g, '')
       .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/gu, '')
       .replace(/\s+/g, ' ').trim();
  if (t.length > 120) t = t.slice(0, 117) + '…';
  return t;
}

function cardHtml(title) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'M';font-weight:700;src:url('file://${FONT_BOLD}') format('truetype');}
    @font-face{font-family:'M';font-weight:400;src:url('file://${FONT_REG}') format('truetype');}
    *{margin:0;padding:0;box-sizing:border-box;font-family:'M',sans-serif;}
    html,body{width:${W}px;height:${H}px;overflow:hidden;}
    body{background:radial-gradient(120% 80% at 50% 0%, #1a1407 -25%, #0b0e14 42%, #05070b 100%);
      display:flex;flex-direction:column;padding:96px 84px;color:#fff;}
    .top{display:flex;align-items:center;gap:20px;}
    .wm{font-weight:700;font-size:44px;letter-spacing:0.5px;}
    .wm .s{color:#C0C0C0;} .wm .g{color:#D4AF37;}
    .dot{width:8px;height:8px;border-radius:50%;background:#D4AF37;}
    .kicker{font-weight:700;font-size:26px;letter-spacing:2px;color:#A6A6A6;text-transform:uppercase;}
    .tag{margin-top:72px;display:inline-block;align-self:flex-start;font-weight:700;font-size:26px;
      color:#05070b;background:linear-gradient(135deg,#F2E6B1,#D4AF37);padding:14px 30px;border-radius:100px;letter-spacing:1px;}
    .title{margin-top:44px;font-weight:700;font-size:82px;line-height:1.1;color:#fff;}
    .rule{margin-top:auto;height:4px;width:180px;background:linear-gradient(90deg,#D4AF37,transparent);}
    .foot{margin-top:38px;display:flex;justify-content:space-between;align-items:center;}
    .slogan{font-weight:400;font-size:30px;color:#A6A6A6;}
    .ch{font-weight:700;font-size:36px;color:#D4AF37;}
  </style></head><body>
    <div class="top"><span class="wm"><span class="s">LEGAL</span><span class="g">AUTO</span></span><span class="dot"></span><span class="kicker">Новости рынка</span></div>
    <div class="tag">АВТОИМПОРТ · РФ</div>
    <div class="title">${esc(title)}</div>
    <div class="rule"></div>
    <div class="foot"><span class="slogan">Документы · СБКТС · ЭПТС</span><span class="ch">@LegalAuto24</span></div>
  </body></html>`;
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

export async function renderNewsCard(postText) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(cardHtml(deriveTitle(postText)), { waitUntil: 'networkidle0' });
    const buf = await page.screenshot({ type: 'png' });
    return buf;
  } catch (e) {
    console.error('[NewsImage] render error:', e.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

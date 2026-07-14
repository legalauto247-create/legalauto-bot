/**
 * LegalAuto — движок карточек ПО НАПРАВЛЕНИЯМ (официальный брендбук).
 * Темится из brand/tokens.json: AUTO=бирюза, STORE=золото, PARTS=оранж.
 * Общая «обёртка» (шапка-эмблема + футер) + тело по типу карточки.
 *
 *   renderCard({ direction, type, ...fields }) → Buffer PNG 1080x1350
 *   type: 'car' | 'news' | 'parts' | 'info'
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __d = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__d, '..');
const FB = join(ROOT, 'assets', 'fonts', 'Montserrat-Bold.ttf');
const FS = join(ROOT, 'assets', 'fonts', 'Montserrat-SemiBold.ttf');
const FR = join(ROOT, 'assets', 'fonts', 'Montserrat-Regular.ttf');
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'brand', 'tokens.json'), 'utf8'));
const W = 1080, H = 1350;

const chrome = () => process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dir = (d) => TOKENS.directions[d] || TOKENS.directions.store;

// Щит LA в цвете направления (inline SVG)
function shield(accent) {
  return `<svg width="92" height="104" viewBox="0 0 92 104" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M46 3 L86 18 V52 C86 78 66 94 46 101 C26 94 6 78 6 52 V18 Z" fill="#0D0D0D" stroke="${accent}" stroke-width="4"/>
    <text x="46" y="64" font-family="Montserrat, serif" font-weight="700" font-size="40" fill="${accent}" text-anchor="middle">LA</text>
  </svg>`;
}

function head(d) {
  const t = dir(d);
  const [a, ...rest] = t.name.split(' '); // LEGAL | AUTO [STORE/PARTS]
  const main = t.name.replace(/\s+(STORE|PARTS)$/, '');
  const suffix = (t.name.match(/(STORE|PARTS)$/) || [''])[0];
  return `<div class="head">
    ${shield(t.accent)}
    <div class="brand">
      <div class="wm">${esc(main)} ${suffix ? `<span style="color:${t.accent}">${suffix}</span>` : ''}</div>
      <div class="tag">${esc(t.tagline)}</div>
    </div>
  </div>
  <div class="rule" style="background:linear-gradient(90deg,${t.accent},transparent)"></div>`;
}

function foot(d) {
  const t = dir(d);
  return `<div class="foot" style="border-top:2px solid ${t.accent}33">
    <span>📞 +7 938 515-24-29</span><span style="color:${t.accent}">✈ ${esc(t.channel)}</span>
  </div>
  <div class="slogan">Ваш надёжный партнёр в мире автомобилей</div>`;
}

// ── Тела карточек по типу ──────────────────────────────────────────────────
function bodyCar(d, f) {
  const t = dir(d);
  const photos = (f.photos || []).filter(Boolean);
  const chips = [f.year && `${f.year} год`, f.mileage, f.city].filter(Boolean);
  return `
    <div class="h1">${esc(f.title || `${f.brand} ${f.model}`)}</div>
    <div class="chips">${chips.map(c => `<span class="chip" style="border-color:${t.accent}55">${esc(c)}</span>`).join('')}</div>
    <div class="hero">${photos[0] ? `<img src="${esc(photos[0])}">` : ''}
      ${f.price ? `<div class="price" style="border-color:${t.accent}"><span>цена под ключ</span><b style="color:${t.accent}">${esc(f.price)}</b></div>` : ''}
    </div>
    ${photos.length > 1 ? `<div class="thumbs">${photos.slice(1,4).map(p=>`<div><img src="${esc(p)}"></div>`).join('')}</div>` : ''}
    <div class="specs">${(f.specs||[]).slice(0,6).map(s=>`<div class="spec"><b style="color:${t.accent}">▪</b> ${esc(s.label?`${s.label}: ${s.value}`:s)}</div>`).join('')}</div>`;
}
function bodyNews(d, f) {
  const t = dir(d);
  return `<div class="kicker" style="color:${t.accent}">${esc(f.kicker || 'НОВОСТЬ')}</div>
    <div class="h1big">${esc(f.title)}</div>
    ${f.text ? `<div class="ptext">${esc(f.text)}</div>` : ''}`;
}
function bodyParts(d, f) {
  const t = dir(d);
  return `<div class="kicker" style="color:${t.accent}">${esc(f.kicker || 'В НАЛИЧИИ')}</div>
    <div class="h1">${esc(f.title)}</div>
    ${f.photos?.[0] ? `<div class="hero"><img src="${esc(f.photos[0])}"></div>` : ''}
    <div class="specs">${(f.specs||[]).map(s=>`<div class="spec"><b style="color:${t.accent}">▪</b> ${esc(s)}</div>`).join('')}</div>`;
}

function html(d, type, f) {
  const t = dir(d);
  const body = type === 'news' ? bodyNews(d, f) : type === 'parts' ? bodyParts(d, f) : bodyCar(d, f);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
   @font-face{font-family:'M';font-weight:700;src:url('file://${FB}') format('truetype');}
   @font-face{font-family:'M';font-weight:600;src:url('file://${FS}') format('truetype');}
   @font-face{font-family:'M';font-weight:400;src:url('file://${FR}') format('truetype');}
   *{margin:0;padding:0;box-sizing:border-box;font-family:'M',sans-serif;color:#fff;}
   html,body{width:${W}px;height:${H}px;overflow:hidden;}
   body{background:radial-gradient(120% 60% at 50% 0%, ${t.accent}1f -10%, #1A1A1A 40%, #0D0D0D 100%);padding:46px 50px;display:flex;flex-direction:column;}
   .head{display:flex;align-items:center;gap:18px;}
   .wm{font-weight:700;font-size:42px;letter-spacing:0.5px;}
   .tag{font-weight:400;font-size:22px;color:#A6A6A6;margin-top:2px;}
   .rule{height:3px;margin:18px 0 8px;border-radius:2px;}
   .h1{font-weight:700;font-size:60px;line-height:1.04;margin-top:18px;}
   .h1big{font-weight:700;font-size:76px;line-height:1.06;margin-top:18px;}
   .kicker{font-weight:700;font-size:28px;letter-spacing:2px;margin-top:18px;}
   .chips{display:flex;gap:12px;margin:18px 0;flex-wrap:wrap;}
   .chip{background:#11151d;border:1px solid;border-radius:13px;padding:10px 18px;font-size:24px;font-weight:600;}
   .hero{position:relative;border-radius:18px;overflow:hidden;height:460px;border:1px solid #2a2f3a;margin-top:6px;}
   .hero img{width:100%;height:100%;object-fit:cover;}
   .price{position:absolute;top:16px;right:16px;background:rgba(8,10,15,.85);border:1px solid;border-radius:14px;padding:12px 20px;text-align:right;}
   .price span{font-size:20px;color:#A6A6A6;display:block;} .price b{font-size:42px;}
   .thumbs{display:flex;gap:12px;margin-top:12px;}
   .thumbs div{flex:1;height:130px;border-radius:12px;overflow:hidden;border:1px solid #2a2f3a;}
   .thumbs img{width:100%;height:100%;object-fit:cover;}
   .specs{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-top:20px;}
   .spec{font-size:24px;font-weight:400;color:#e8eaed;}
   .ptext{font-size:30px;color:#cfd3d8;margin-top:22px;line-height:1.4;}
   .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;padding-top:18px;font-weight:700;font-size:26px;}
   .slogan{text-align:center;color:#8a939c;font-size:20px;font-weight:400;margin-top:12px;font-style:italic;}
  </style></head><body>
   ${head(d)}
   <div style="flex:1;display:flex;flex-direction:column;">${body}</div>
   ${foot(d)}
  </body></html>`;
}

async function render(htmlStr) {
  let b;
  try {
    b = await puppeteer.launch({ executablePath: chrome(), headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
    const p = await b.newPage();
    await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await p.setContent(htmlStr, { waitUntil: 'networkidle0' });
    return await p.screenshot({ type: 'png' });
  } catch (e) { console.error('[Card] render:', e.message); return null; }
  finally { if (b) await b.close().catch(()=>{}); }
}

export async function renderCard({ direction = 'store', type = 'car', ...fields }) {
  return render(html(direction, type, fields));
}
// Совместимость со старым вызовом
export async function renderCarCard(data) {
  return renderCard({ direction: 'store', type: 'car', ...data });
}

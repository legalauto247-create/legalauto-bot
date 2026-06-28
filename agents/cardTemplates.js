/**
 * LegalAuto — код-шаблоны постов (повторяют дизайн из папки «Шаблоны Legal Auto»).
 * Мозг выбирает тип и заполняет данными; дизайн = твой шаблон, не самодельный.
 *
 * renderCarCard(data) → Buffer (PNG 1080x1600) — карточка продажи авто
 *   data: { brand, model, year, mileage, city, price, photos[], specs[], features[] }
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FB = join(ROOT, 'assets', 'fonts', 'Montserrat-Bold.ttf');
const FR = join(ROOT, 'assets', 'fonts', 'Montserrat-Regular.ttf');
const BG_CARS = join(ROOT, 'brand', 'templates', 'bg-cars.png');  // фон от ChatGPT
const W = 1080, H = 1600;

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function carCardHtml(d) {
  const photos = (d.photos || []).filter(Boolean);
  const hero = photos[0] || '';
  const thumbs = photos.slice(1, 4);
  const chips = [
    d.year     && ['📅', `${d.year} год`],
    d.mileage  && ['🚗', d.mileage],
    d.city     && ['📍', d.city],
  ].filter(Boolean);
  const specsL = (d.specs || []).slice(0, 4);
  const featuresR = (d.features || []).slice(0, 4);

  return `<!doctype html><html><head><meta charset="utf-8"><style>
   @font-face{font-family:'M';font-weight:700;src:url('file://${FB}') format('truetype');}
   @font-face{font-family:'M';font-weight:400;src:url('file://${FR}') format('truetype');}
   *{margin:0;padding:0;box-sizing:border-box;font-family:'M',sans-serif;color:#fff;}
   html,body{width:${W}px;height:${H}px;overflow:hidden;}
   body{background:#05070b ${existsSync(BG_CARS)?`url('file://${BG_CARS}')`:''} center/cover no-repeat;padding:54px 54px 40px;display:flex;flex-direction:column;}
   .h2,.h1,.brand{text-shadow:0 2px 14px rgba(0,0,0,.7);}
   .brand{text-align:center;font-weight:700;font-size:34px;letter-spacing:1px;margin-bottom:18px;}
   .brand .s{color:#C0C0C0;} .brand .g{color:#D4AF37;}
   .h1{text-align:center;font-weight:700;font-size:40px;letter-spacing:3px;color:#fff;}
   .h2{text-align:center;font-weight:700;font-size:78px;line-height:1;color:#D4AF37;margin-top:4px;}
   .chips{display:flex;gap:14px;justify-content:center;margin:24px 0 22px;}
   .chip{background:#11151d;border:1px solid #2a2f3a;border-radius:14px;padding:12px 20px;font-size:26px;font-weight:700;}
   .hero{position:relative;border-radius:22px;overflow:hidden;height:560px;border:1px solid #2a2f3a;}
   .hero img{width:100%;height:100%;object-fit:cover;}
   .price{position:absolute;top:20px;right:20px;background:rgba(8,10,15,.82);border:1px solid #D4AF37;border-radius:16px;padding:14px 22px;text-align:right;}
   .price .l{font-size:22px;color:#A6A6A6;} .price .v{font-size:46px;font-weight:700;color:#D4AF37;}
   .thumbs{display:flex;gap:14px;margin-top:14px;}
   .thumbs div{flex:1;height:150px;border-radius:14px;overflow:hidden;border:1px solid #2a2f3a;}
   .thumbs img{width:100%;height:100%;object-fit:cover;}
   .specs{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;margin-top:24px;}
   .spec{display:flex;gap:10px;align-items:flex-start;font-size:25px;font-weight:400;color:#e8eaed;}
   .spec b{color:#D4AF37;font-weight:700;}
   .guarantee{margin-top:auto;text-align:center;border:1px solid #D4AF37;border-radius:16px;padding:16px;font-weight:700;font-size:27px;color:#D4AF37;}
   .guarantee small{display:block;color:#A6A6A6;font-weight:400;font-size:21px;margin-top:4px;}
   .foot{display:flex;justify-content:space-between;align-items:center;margin-top:20px;font-weight:700;font-size:26px;}
   .foot .ph{color:#fff;} .foot .tg{color:#D4AF37;}
   .slogan{text-align:center;color:#8a939c;font-size:21px;font-weight:400;margin-top:14px;letter-spacing:1px;}
  </style></head><body>
   <div class="brand"><span class="s">LEGAL</span><span class="g">AUTO</span> STORE</div>
   <div class="h1">ПРОДАЖА</div>
   <div class="h2">${esc(d.brand)} ${esc(d.model)}</div>
   <div class="chips">${chips.map(c=>`<div class="chip">${c[0]} ${esc(c[1])}</div>`).join('')}</div>
   <div class="hero">${hero?`<img src="${esc(hero)}">`:''}
     ${d.price?`<div class="price"><div class="l">Цена под ключ:</div><div class="v">${esc(d.price)}</div></div>`:''}
   </div>
   ${thumbs.length?`<div class="thumbs">${thumbs.map(t=>`<div><img src="${esc(t)}"></div>`).join('')}</div>`:''}
   <div class="specs">
     ${specsL.map(s=>`<div class="spec"><b>▪</b> ${esc(s.label?`${s.label}: ${s.value}`:s)}</div>`).join('')}
     ${featuresR.map(f=>`<div class="spec"><b>♦</b> ${esc(f)}</div>`).join('')}
   </div>
   <div class="guarantee">ПОЛНОЕ СОПРОВОЖДЕНИЕ СДЕЛКИ<small>без ошибок, отказов и лишних расходов</small></div>
   <div class="foot"><span class="ph">📞 +7 938 515-24-29</span><span class="tg">✈ @LegalAuto247</span></div>
   <div class="slogan">Ваш надёжный партнёр в мире автомобилей</div>
  </body></html>`;
}

async function renderHtml(html) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath(), headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.screenshot({ type: 'png' });
  } catch (e) { console.error('[CardTpl] render:', e.message); return null; }
  finally { if (browser) await browser.close().catch(()=>{}); }
}

export async function renderCarCard(data) {
  return renderHtml(carCardHtml(data));
}

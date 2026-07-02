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
import { renderProduct, renderInfo, renderCinematic, renderNewsCard } from './videoAgent.js';
import { createTask, taskProcessing, taskDone, taskFailed, persistentPath } from '../services/stateService.js';
import { reviewContent } from '../services/qualityGate.js';
import { uploadShort, LINKS_BLOCK } from './youtubeUpload.js';
import { HEAVY } from './models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USED_FILE = persistentPath('video_used.json');
const MUSIC_DIR = join(ROOT, 'assets', 'music');
const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

function loadUsed() { try { return JSON.parse(readFileSync(USED_FILE, 'utf8')); } catch { return {}; } }
function saveUsed(u) { try { writeFileSync(USED_FILE, JSON.stringify(u, null, 1)); } catch {} }
const LAST_MUSIC_FILE = persistentPath('last_music.json');
// genres — предпочитаемые жанры по префиксу имени файла (phonk/sport/electronic/hiphop/rock)
function pickMusic(genres = null) {
  try {
    let files = readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) return null;
    if (genres && genres.length) {
      const g = files.filter(f => genres.some(pref => f.toLowerCase().startsWith(pref)));
      if (g.length) files = g;   // если по жанру есть — берём из них, иначе из всех
    }
    let last = ''; try { last = JSON.parse(readFileSync(LAST_MUSIC_FILE, 'utf8')).last || ''; } catch {}
    const pool = files.length > 1 ? files.filter(f => f !== last) : files;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    try { writeFileSync(LAST_MUSIC_FILE, JSON.stringify({ last: pick })); } catch {}
    return join(MUSIC_DIR, pick);
  } catch { return null; }
}

// CSV-парсер (поля в кавычках, запятые внутри, экранированные кавычки)
function parseCSV(t) {
  const rows = []; let f = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; f.push(cur); rows.push(f); f = []; cur = ''; } else cur += c; }
  }
  if (cur || f.length) { f.push(cur); rows.push(f); }
  return rows;
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1oxJ1wdyjReC6fCarq0PsmO-T1TSW9FqqLeksQyKRZE8';

// Читаем ВЕСЬ каталог напрямую из таблицы (gviz CSV) — все 1378 позиций и ВСЕ марки
// (API ?action=catalog режет на 1000 строк и Geely/Li Auto не доходят).
async function catalogFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&headers=1`;
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const t = await r.text();
  if (!t.startsWith('"') && !t.includes(',')) throw new Error('gviz: не CSV');
  const rows = parseCSV(t);
  const head = rows[0].map(h => h.trim());
  const ix = n => head.indexOf(n);
  const [I_id, I_brand, I_model, I_name, I_oem, I_price, I_photo, I_cat, I_series, I_title, I_cond, I_desc, I_pcount] =
    ['id', 'brand', 'model', 'name', 'oem', 'price', 'photo', 'category', 'series', 'display_car', 'condition', 'description', 'photo_count'].map(ix);
  return rows.slice(1).filter(r => r.length >= head.length - 4).map(r => {
    const photo = r[I_photo];
    // в облаке лежат 01.jpg..NN.jpg — таблица ссылается только на 01; строим все по photo_count
    const count = Math.min(Number(r[I_pcount]) || 1, 6);
    let photos = [photo].filter(Boolean);
    const m = /^(.*\/)01(\.[a-z]+)$/i.exec(photo || '');
    if (m && count > 1) photos = Array.from({ length: count }, (_, i) => `${m[1]}${String(i + 1).padStart(2, '0')}${m[2]}`);
    return {
      id: r[I_id], brand: r[I_brand], model: r[I_model], series: r[I_series],
      name: r[I_name], oem: r[I_oem], price: r[I_price], photo, photos,
      category: r[I_cat], title: r[I_title], condition: r[I_cond], description: r[I_desc],
    };
  });
}

async function gasCatalog(limit = 40) {
  // 1) прямое чтение таблицы (полный каталог, все марки)
  try {
    const all = await catalogFromSheet();
    const withPhoto = all.filter(p => (p.photo || '').includes('yandexcloud'));
    if (withPhoto.length) return withPhoto;
  } catch (e) { console.error('[Content] catalogFromSheet:', e.message); }

  // 2) запасной путь — API каталога (капается на 1000, но лучше чем ничего)
  const GAS = process.env.APPS_SCRIPT_API_URL;
  let d = null;
  for (let i = 0; i < 3 && !d; i++) {
    try {
      const r = await fetch(`${GAS}?action=catalog&limit=${limit}`, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' } });
      d = JSON.parse(await r.text());
    } catch { await new Promise(res => setTimeout(res, 2000)); }
  }
  if (!d) throw new Error('Каталог недоступен');
  return (d.products || d.parts || []).filter(p => (p.photo || p.photo_cover || '').includes('yandexcloud'));
}

// Тема из запроса Эдо → ключевые слова категории (фильтруем каталог)
function themeKeywords(theme = '') {
  const t = String(theme).toLowerCase();
  const groups = [
    { on: ['кузов','крыл','бампер','капот','двер','порог','молдинг','накладк','крыш','багажник','стойк кузов'], kw: ['кузов','крыл','бампер','капот','двер','порог','молдинг','накладк','крыш','багажник','лонжерон','арк'] },
    { on: ['оптик','фар','фонар','свет','птф','лампа'], kw: ['фар','фонар','оптик','птф','лампа','ксенон','led','повторител'] },
    { on: ['двигат','мотор','двс'], kw: ['двигат','мотор','цеп','форсунк','поршн','клапан','турбин','насос','патрубок','коллектор','грм'] },
    { on: ['подвеск','ходов','амортизат','рычаг'], kw: ['подвеск','амортизат','рычаг','стойк','пружин','сайлентблок','ступиц','шаров','стабилизат'] },
    { on: ['тормоз','колодк','суппорт'], kw: ['тормоз','колодк','суппорт','диск тормоз'] },
    { on: ['электр','проводк','датчик','блок'], kw: ['электр','проводк','датчик','блок','реле','катушк','генератор','стартер'] },
    { on: ['салон','интерьер','сиден','обшивк','торпед'], kw: ['салон','обшивк','сиден','подлокот','торпед','панел прибор','руль','airbag','подушк безоп'] },
    { on: ['трансмисс','кпп','коробк','сцеплен'], kw: ['кпп','коробк','сцеплен','привод','шрус','кардан','дифференциал'] },
  ];
  for (const g of groups) if (g.on.some(w => t.includes(w))) return g.kw;
  return null;   // не узнали категорию — не сужаем по категории (марка отфильтрует отдельно)
}

// Марка из запроса Эдо → канон (для фильтра по brand в каталоге)
function brandFromTheme(theme = '') {
  const t = String(theme).toLowerCase();
  const brands = [
    { kw: ['geely', 'джили', 'джилли'], label: 'Geely' },
    { kw: ['bmw', 'бмв'], label: 'BMW' },
    { kw: ['li auto', 'li-auto', 'liauto', 'лиауто', 'ли авто', 'li xiang', 'лисян'], label: 'Li Auto' },
    { kw: ['mercedes', 'мерседес', 'мерс', 'benz', 'бенц'], label: 'Mercedes' },
    { kw: ['audi', 'ауди'], label: 'Audi' },
    { kw: ['toyota', 'тойота'], label: 'Toyota' },
    { kw: ['zeekr', 'зикр', 'зиикр'], label: 'Zeekr' },
    { kw: ['chery', 'чери', 'черри'], label: 'Chery' },
  ];
  for (const b of brands) if (b.kw.some(k => t.includes(k))) return b;
  return null;
}
function shuffle(a) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

async function _makeProductShort({ platforms = ['youtube'], theme = '', lengthSec = 18 } = {}) {
  if (!claude) return { ok: false, error: 'CLAUDE_API_KEY не задан' };
  const music = pickMusic();
  if (!music) return { ok: false, error: 'Нет музыки. Закинь mp3-биты в assets/music/ — без музыки ролики не делаем.' };

  // 1) каталог (широко) → фильтр по теме → отсев уже использованных → перемешивание
  const used = loadUsed();
  const all = await gasCatalog(250);

  let pool = all;

  // 1a) фильтр по МАРКЕ — если Эдо назвал марку, а её в каталоге нет, честно откажемся
  const wantBrand = brandFromTheme(theme);
  if (wantBrand) {
    const brandParts = all.filter(p => {
      const b = String(p.brand || '').toLowerCase();
      return wantBrand.kw.some(k => b.includes(k)) || b.includes(wantBrand.label.toLowerCase());
    });
    if (!brandParts.length) {
      const have = [...new Set(all.map(p => String(p.brand || '').trim()).filter(Boolean))];
      return { ok: false, error: `В каталоге нет запчастей ${wantBrand.label}. Сейчас в наличии с фото только: ${have.join(', ') || '—'}. Могу сделать ролик по ним или добавь позиции ${wantBrand.label} в таблицу.` };
    }
    pool = brandParts;
  }

  // 1b) фильтр по КАТЕГОРИИ (в пределах марки, если она задана)
  const kws = themeKeywords(theme);
  if (kws) {
    const matched = pool.filter(p => {
      const hay = (String(p.category || '') + ' ' + String(p.name || '') + ' ' + String(p.title || '')).toLowerCase();
      return kws.some(k => hay.includes(k));
    });
    if (matched.length >= 3) pool = matched;   // если по категории мало — оставляем пул марки
  }

  let fresh = pool.filter(p => {
    const key = String(p.oem || p.id || p.name);
    const u = used[key] || [];
    return !platforms.every(pl => u.includes(pl));   // берём, если не на всех целевых платформах
  });
  if (fresh.length < 4) fresh = pool;                 // если свежих мало — берём весь пул темы

  const parts = shuffle(fresh).slice(0, 6);           // перемешиваем → без повторов от ролика к ролику
  if (parts.length < 3) return { ok: false, error: theme ? `Мало фото по теме «${theme}» в каталоге` : 'Мало фото запчастей в каталоге' };

  // items: КАЖДАЯ запчасть со своим названием и ценой (текст совпадает с фото)
  const items = parts.map(p => ({
    photo: p.photo || p.photo_cover,
    photos: (p.photos && p.photos.length ? p.photos : [p.photo || p.photo_cover]).filter(Boolean).slice(0, 3),
    name: p.name,
    price: p.price ? Number(p.price).toLocaleString('ru-RU') + ' ₽' : '',
    fits: [p.brand, (p.model || p.series || '').replace(/\|/g, '/')].filter(Boolean).join(' ').trim(),
  }));

  // марка(и) и происхождение — из РЕАЛЬНЫХ деталей ролика (не хардкод)
  const brands = [...new Set(parts.map(p => String(p.brand || '').trim()).filter(Boolean))];
  const originOf = (b) => {
    const x = b.toLowerCase();
    if (/geely|li ?auto|лиауто|zeekr|chery|чери|haval|changan|exeed|omoda|jetour|jac|dongfeng|байк|great wall/.test(x)) return 'из Китая';
    if (/bmw|audi|mercedes|мерс|volkswagen|porsche|skoda|volvo|peugeot|renault|opel|mini/.test(x)) return 'из Европы';
    if (/toyota|lexus|honda|nissan|mazda|mitsubishi|subaru|infiniti/.test(x)) return 'из Японии';
    return '';
  };
  const origins = [...new Set(brands.map(originOf).filter(Boolean))];
  const brandLabel = brands.length === 1 ? brands[0] : (brands.slice(0, 2).join(' и ') || 'авто');
  const originLabel = origins.length === 1 ? origins[0] : '';   // разные страны — не заявляем одну
  const brandTag = brands.length === 1 ? brands[0].toLowerCase().replace(/[^a-zа-я0-9]/gi, '') : 'авто';
  // состояние — из колонки condition таблицы (что написано у деталей, то и говорим)
  const conds = [...new Set(parts.map(p => String(p.condition || '').trim()).filter(Boolean))];
  const condLabel = conds.length === 1 ? conds[0] : '';   // смешанное состояние — не заявляем одно

  // 2) хук + заголовок (на «вы», без «золотых гор» — по брендбуку)
  const m = await claude.messages.create({ model: HEAVY, max_tokens: 350, messages: [{ role: 'user', content:
`Короткий вирусный хук и заголовок для Shorts про запчасти ${brandLabel}${originLabel ? ' ' + originLabel : ''} (LegalAuto Parts). Состояние деталей СТРОГО из каталога: "${condLabel || 'разное — не указывай состояние'}". НЕ пиши «б/у», если в состоянии этого нет; НЕ пиши «новые», если не написано «Новый». Тон по брендбуку: на «вы», прямо и по фактам, БЕЗ обещаний «золотых гор» и слова «копейки». НЕ выдумывай страну происхождения — используй только "${originLabel || 'без указания страны'}".
JSON: {"title":"до 80 симв, 1 эмодзи","description":"2 строки + 3 хэштега (#shorts #запчасти #${brandTag})","hook":"3-4 слова крупно (интрига/выгода)"}
запчасти в ролике: ${parts.map(p => `${p.name}${p.condition ? ' (' + p.condition + ')' : ''}`).join(', ')}` }] });
  const s = JSON.parse(m.content[0].text.trim().replace(/^```json?|```$/g, ''));

  // QUALITY GATE: сценарий против реальных данных каталога — брак не публикуем и не рендерим
  const gateSrc = parts.map(p => `${p.brand} ${p.name} ${p.price}₽ ${p.condition || ''}`).join('; ');
  const gate = await reviewContent({ title: s.title, description: `${s.description}${LINKS_BLOCK}`, texts: [s.hook, ...items.map(i => i.name)], direction: 'parts', sourceData: gateSrc });
  if (!gate.pass) return { ok: false, error: `Quality Gate: ${gate.fails.join('; ')}` };

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
        fd.append('chat_id', String(chan)); fd.append('caption', `${s.title}\n\n✅ Заказать: https://t.me/LegalAutoAssist_bot?start=tg_parts`); fd.append('supports_streaming', 'true');
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

// ── Инфо-ролик по брендбуку (документы / пригон / советы) ────────────────────
const DIRECTIONS = {
  docs:  { accent: '#00D1C2', brandLine: 'LEGAL AUTO • ДОКУМЕНТЫ', channel: '@LegalAuto24',        groupUrl: 't.me/LegalAuto24',        genres: ['electronic', 'sport'],           theme: 'оформление документов на авто в РФ (СБКТС, ЭПТС, утильсбор, таможенное оформление)' },
  auto:  { accent: '#D4AF37', brandLine: 'LEGAL AUTO • ПРИГОН',    channel: '@LegalAutoStore',      groupUrl: 't.me/LegalAutoStore',      genres: ['sport', 'rock', 'electronic'],   theme: 'пригон и подбор авто под ключ из Китая/Кореи/Европы' },
  parts: { accent: '#FF6B00', brandLine: 'LEGAL AUTO • ЗАПЧАСТИ',  channel: '@LegalAutoParts24',    groupUrl: 't.me/LegalAutoParts24',    genres: ['phonk', 'sport'],                theme: 'оригинальные автозапчасти из Европы' },
};

/**
 * Инфо-ролик на ЛЮБУЮ тему в фирстиле LegalAuto (не из каталога).
 * makeInfoShort({ topic, direction, platforms, channel, groupUrl }) → { ok, ytUrl, tgOk, title, error }
 */
async function _makeInfoShort({ topic, direction = 'docs', platforms = ['youtube'], channel, groupUrl } = {}) {
  if (!claude) return { ok: false, error: 'CLAUDE_API_KEY не задан' };
  if (!topic) return { ok: false, error: 'Не задана тема ролика' };
  const dir = DIRECTIONS[direction] || DIRECTIONS.docs;
  const music = pickMusic(dir.genres);
  if (!music) return { ok: false, error: 'Нет музыки в assets/music/' };

  const ch = channel || dir.channel;
  const gurl = groupUrl || dir.groupUrl;

  // 1) сценарий: хук + 4-5 шагов/пунктов + CTA (тон по брендбуку, на «вы», факты не выдумывать)
  const m = await claude.messages.create({ model: HEAVY, max_tokens: 900, messages: [{ role: 'user', content:
`Ты — сценарист вирусных вертикальных Shorts для LegalAuto (${dir.theme}).
Сделай короткий информативный ролик по теме: "${topic}".
Тон брендбука: на «вы», уверенно, по фактам, без «золотых гор» и воды. Каждый пункт — реально полезный.
ВАЖНЫЙ ФАКТ РФ-2026: льготный утильсбор физлица (3400/5200 ₽) — ТОЛЬКО если мощность ≤160 л.с. и 1 авто/год; свыше 160 л.с. — полный тариф. Не вводи в заблуждение.
Верни ТОЛЬКО JSON:
{"hook":"3-4 слова крупно (интрига/выгода)","tagline":"подзаголовок до 5 слов","points":[{"icon":"1 эмодзи по смыслу","title":"суть пункта до 5 слов","text":"пояснение 1 фраза до 12 слов"}],"cta":"призыв до 6 слов","title":"заголовок YouTube до 80 симв, 1 эмодзи","description":"2 строки для YouTube-описания + 3 хэштега"}
points: РОВНО 4-5 штук, по порядку/логике. Без markdown, только JSON.` }] });
  let s;
  try { s = JSON.parse(m.content[0].text.trim().replace(/^```json?|```$/g, '')); }
  catch { return { ok: false, error: 'Не удалось собрать сценарий (не JSON)' }; }
  const points = Array.isArray(s.points) ? s.points.filter(p => p && p.title).slice(0, 5) : [];
  if (points.length < 3) return { ok: false, error: 'Мало пунктов в сценарии' };

  // QUALITY GATE перед рендером
  {
    const gate = await reviewContent({ title: s.title || topic, description: `${s.description || ''}\n➡️ ${ch} · ${gurl}`, texts: [s.hook, s.tagline, ...points.map(p => `${p.title}. ${p.text || ''}`), s.cta], direction, sourceData: null });
    if (!gate.pass) return { ok: false, error: `Quality Gate: ${gate.fails.join('; ')}` };
  }

  // 2) рендер инфо-ролика
  const { path, cleanup } = await renderInfo({
    musicPath: music,
    brandLine: dir.brandLine, hook: s.hook || topic, tagline: s.tagline || '',
    points, cta: s.cta || 'Оформим за вас', channel: ch, groupUrl: gurl, accent: dir.accent,
  });

  const result = { ok: true, title: s.title || topic, direction };
  const desc = `${s.description || topic}\n\n➡️ ${ch}  ·  ${gurl}`;

  // 3) YouTube
  if (platforms.includes('youtube')) {
    try { const yt = await uploadShort({ path, title: s.title || topic, description: desc, tags: ['shorts', 'авто', 'документы', 'LegalAuto'] }); result.ytUrl = yt.url; }
    catch (e) { result.ytError = e.message; }
  }
  // 4) Telegram
  if (platforms.includes('telegram')) {
    const token = process.env.CHANNEL_BOT_TOKEN || process.env.ADMIN_BOT_TOKEN;
    if (token) {
      try {
        const fd = new FormData();
        fd.append('chat_id', String(ch)); fd.append('caption', `${s.title || topic}\n\n✅ Заявка: https://t.me/LegalAutoAssist_bot?start=tg_${direction}\n${gurl}`); fd.append('supports_streaming', 'true');
        fd.append('video', new Blob([readFileSync(path)], { type: 'video/mp4' }), 'info.mp4');
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: fd });
        result.tgOk = (await r.json()).ok;
      } catch (e) { result.tgError = e.message; }
    }
  }

  cleanup();
  return result;
}

// ── Кино-ролик высшего уровня: AI-кадры (gpt-image) + брендовый оверлей ──────
const OPENAI_KEY = () => process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_BACKUP;

// Кино-стиль картинок — из brand/IMAGE_STYLE_GUIDE.json (единый источник правды)
function loadImageGuide() {
  try { return JSON.parse(readFileSync(join(ROOT, 'brand', 'IMAGE_STYLE_GUIDE.json'), 'utf8')); }
  catch { return null; }
}
const IMG_GUIDE = loadImageGuide();
const CINE_STYLE = {
  docs:  IMG_GUIDE?.directions?.docs?.prompt_suffix  || 'cinematic, teal rim lighting, premium automotive mood',
  auto:  IMG_GUIDE?.directions?.auto?.prompt_suffix  || 'cinematic, gold rim lighting, luxury showroom mood',
  parts: IMG_GUIDE?.directions?.parts?.prompt_suffix || 'cinematic, orange rim lighting, premium auto parts mood',
};
const IMG_BASE = IMG_GUIDE?.base
  ? `${IMG_GUIDE.base.style}, ${IMG_GUIDE.base.lighting}, ${IMG_GUIDE.base.background}, ${IMG_GUIDE.base.quality}, vertical ${IMG_GUIDE.base.aspect}, no ${(IMG_GUIDE.base.negative || []).join(', no ')}`
  : 'Ultra-detailed, moody advertising photography, vertical 9:16, no text, no logo, no watermark, no letters';

async function genCineImage(prompt, direction = 'auto') {
  const key = OPENAI_KEY();
  if (!key) throw new Error('OPENAI_API_KEY не задан');
  const model = process.env.IMAGE_MODEL || IMG_GUIDE?.base?.model || 'gpt-image-2';
  const full = `${prompt}. ${CINE_STYLE[direction] || CINE_STYLE.auto}. ${IMG_BASE}.`;
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: full, n: 1, size: '1024x1536' }),
  });
  if (!r.ok) throw new Error('gpt-image: ' + (await r.text()).slice(0, 160));
  const d = await r.json();
  const b64 = d.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, 'base64');
  const url = d.data?.[0]?.url;
  if (url) { const im = await fetch(url); return Buffer.from(await im.arrayBuffer()); }
  throw new Error('gpt-image: пустой ответ');
}

/**
 * Кино-ролик высшего уровня на любую тему (документы/пригон/советы).
 * Каждая сцена — кинематографичная AI-картинка + премиум брендовый оверлей.
 * makeCinematicShort({ topic, direction, platforms, groupUrl }) → { ok, ytUrl, tgOk, title, error }
 */
async function _makeCinematicShort({ topic, direction = 'auto', platforms = ['youtube'], channel, groupUrl } = {}) {
  if (!claude) return { ok: false, error: 'CLAUDE_API_KEY не задан' };
  if (!OPENAI_KEY()) return { ok: false, error: 'OPENAI_API_KEY не задан (нужен для кино-кадров)' };
  if (!topic) return { ok: false, error: 'Не задана тема ролика' };
  const dir = DIRECTIONS[direction] || DIRECTIONS.auto;
  const music = pickMusic(dir.genres);
  if (!music) return { ok: false, error: 'Нет музыки в assets/music/' };
  const ch = channel || dir.channel;
  const gurl = groupUrl || dir.groupUrl;

  // 1) сценарий: hook + 3-4 сцены (заголовок/текст/kicker + промпт кино-картинки) + CTA
  const m = await claude.messages.create({ model: HEAVY, max_tokens: 1100, messages: [{ role: 'user', content:
`Ты — креативный директор премиум-роликов LegalAuto (${dir.theme}).
Сделай сценарий вертикального кино-Shorts по теме: "${topic}".
Тон брендбука: на «вы», уверенно, по фактам, без «золотых гор».
ФАКТ РФ-2026: льготный утильсбор физлица (3400/5200 ₽) — ТОЛЬКО если ≤160 л.с. и 1 авто/год; свыше 160 л.с. — полный тариф.
Для каждой сцены дай "imagePrompt" — КОРОТКОЕ описание кинематографичного КАДРА на английском (что в кадре: авто/деталь/сцена; БЕЗ текста и людей крупным планом), под премиум-рекламу.
Верни ТОЛЬКО JSON:
{"hook":"3-4 слова крупно","tagline":"подзаголовок до 5 слов","heroPrompt":"english cinematic hero shot description","scenes":[{"kicker":"метка до 12 симв (ШАГ 1 / ФАКТ / ВАЖНО)","title":"суть до 5 слов","text":"пояснение до 12 слов","imagePrompt":"english cinematic frame description"}],"cta":"призыв до 6 слов","title":"YouTube-заголовок до 80 симв, 1 эмодзи","description":"2 строки + 3 хэштега"}
scenes: РОВНО 3-4. Только JSON, без markdown.` }] });
  let s;
  try { s = JSON.parse(m.content[0].text.trim().replace(/^```json?|```$/g, '')); }
  catch { return { ok: false, error: 'Сценарий не собрался (не JSON)' }; }
  const scenesRaw = Array.isArray(s.scenes) ? s.scenes.filter(x => x && x.title && x.imagePrompt).slice(0, 4) : [];
  if (scenesRaw.length < 2) return { ok: false, error: 'Мало сцен в сценарии' };

  // QUALITY GATE перед генерацией кадров (брак не тратит деньги на gpt-image)
  {
    const gate = await reviewContent({ title: s.title || topic, description: `${s.description || ''}\n➡️ ${ch} · ${gurl}`, texts: [s.hook, s.tagline, ...scenesRaw.map(x => `${x.title}. ${x.text || ''}`), s.cta], direction, sourceData: null });
    if (!gate.pass) return { ok: false, error: `Quality Gate: ${gate.fails.join('; ')}` };
  }

  // 2) генерим кино-кадры (герой + по сцене) параллельно
  const heroPrompt = s.heroPrompt || `premium ${direction} automotive hero shot`;
  const imgJobs = [genCineImage(heroPrompt, direction).then(b => ({ name: 'cine-hero.png', buffer: b })).catch(() => null)];
  scenesRaw.forEach((sc, i) => imgJobs.push(genCineImage(sc.imagePrompt, direction).then(b => ({ name: `cine-${i}.png`, buffer: b })).catch(() => null)));
  const imgs = await Promise.all(imgJobs);
  const hero = imgs[0];
  const scenes = [];
  const images = [];
  if (hero) images.push(hero);
  scenesRaw.forEach((sc, i) => {
    const im = imgs[i + 1];
    if (!im) return;   // пропускаем сцену, если картинка не сгенерилась
    images.push(im);
    scenes.push({ image: im.name, kicker: sc.kicker || '', title: sc.title, text: sc.text || '' });
  });
  if (scenes.length < 2) return { ok: false, error: 'Кино-кадры не сгенерились (проверь OpenAI ключ/лимиты)' };

  // 3) рендер
  const { path, cleanup } = await renderCinematic({
    musicPath: music, images,
    brandLine: dir.brandLine, heroImage: hero ? 'cine-hero.png' : undefined,
    hook: s.hook || topic, tagline: s.tagline || '',
    scenes, cta: s.cta || 'Оставьте заявку', channel: ch, groupUrl: gurl, accent: dir.accent,
  });

  const result = { ok: true, title: s.title || topic, direction, scenes: scenes.length };
  const desc = `${s.description || topic}\n\n➡️ ${ch}  ·  ${gurl}`;

  // 4) YouTube
  if (platforms.includes('youtube')) {
    try { const yt = await uploadShort({ path, title: s.title || topic, description: desc, tags: ['shorts', 'авто', 'LegalAuto'] }); result.ytUrl = yt.url; }
    catch (e) { result.ytError = e.message; }
  }
  // 5) Telegram
  if (platforms.includes('telegram')) {
    const token = process.env.CHANNEL_BOT_TOKEN || process.env.ADMIN_BOT_TOKEN;
    if (token) {
      try {
        const fd = new FormData();
        fd.append('chat_id', String(ch)); fd.append('caption', `${s.title || topic}\n\n✅ Заявка: https://t.me/LegalAutoAssist_bot?start=tg_${direction}\n${gurl}`); fd.append('supports_streaming', 'true');
        fd.append('video', new Blob([readFileSync(path)], { type: 'video/mp4' }), 'cine.mp4');
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: fd });
        result.tgOk = (await r.json()).ok;
      } catch (e) { result.tgError = e.message; }
    }
  }

  cleanup();
  return result;
}


// ── Трекинг в Platform State: каждая генерация = задача со статусами ─────────
function tracked(type, fn, metaOf) {
  return async (opts = {}) => {
    const id = createTask({ type, source: opts.source || 'jarvis', owner: 'contentAgent', meta: metaOf(opts) });
    taskProcessing(id);
    try {
      const r = await fn(opts);
      if (r?.ok) taskDone(id, { url: r.ytUrl || null, title: r.title || null, tg: !!r.tgOk });
      else taskFailed(id, r?.error || 'unknown');
      return r;
    } catch (e) { taskFailed(id, e); throw e; }
  };
}
export const makeProductShort   = tracked('video_product',   _makeProductShort,   o => ({ theme: o.theme || '' }));
export const makeInfoShort      = tracked('video_info',      _makeInfoShort,      o => ({ topic: o.topic || '', direction: o.direction }));
export const makeCinematicShort = tracked('video_cinematic', _makeCinematicShort, o => ({ topic: o.topic || '', direction: o.direction }));


// ── Новостная карточка по эталону ЛИСТ 2 (1080x1350, 3 факт-блока) ───────────
// makeNewsCard({ newsText }) → { ok, path, cleanup, caption } | { ok:false, error }
export async function makeNewsCard({ newsText, date }) {
  if (!claude) return { ok: false, error: 'CLAUDE_API_KEY не задан' };
  if (!newsText) return { ok: false, error: 'Нет текста новости' };
  // 1) структурируем в эталонный layout
  const m = await claude.messages.create({ model: HEAVY, max_tokens: 700, messages: [{ role: 'user', content:
`Разложи новость в эталонный шаблон новостного поста LegalAuto (аудитория: импортёры авто и владельцы ввезённых авто). СТРОГО по фактам из текста, ничего не выдумывай.
Верни ТОЛЬКО JSON:
{"title":"суть КРАТКО, 3-6 слов (будет капсом, ≤3 строк)","titleAccent":"дата/ключевой факт 2-4 слова (бирюзой) или пусто","subtitle":"1-2 предложения: что это значит","facts":[{"icon":"1 эмодзи","label":"ЧТО ИЗМЕНИТСЯ?","text":"до 12 слов"},{"icon":"1 эмодзи","label":"КОГО КАСАЕТСЯ?","text":"до 12 слов"},{"icon":"1 эмодзи","label":"ЧТО ДЕЛАТЬ?","text":"до 12 слов, конкретное действие"}],"imagePrompt":"english: cinematic scene matching the news topic (cars/customs/port/city), bright professional","caption":"текст поста для Telegram: 3-5 предложений по фактам + в конце «Вопрос по вашей ситуации → @LegalAutoAssist_bot»"}

Новость:
"${String(newsText).slice(0, 1200)}"` }] });
  let sc;
  try { sc = JSON.parse(m.content[0].text.trim().replace(/^```json?|```$/g, '')); }
  catch { return { ok: false, error: 'Структура новости не собралась' }; }
  if (!Array.isArray(sc.facts) || sc.facts.length < 3) return { ok: false, error: 'Не собрались 3 факт-блока' };

  // 2) Quality Gate на текст карточки
  const gate = await reviewContent({ title: sc.title, description: `${sc.caption}`, texts: [sc.subtitle, ...sc.facts.map(f => `${f.label} ${f.text}`)], direction: 'docs', sourceData: String(newsText).slice(0, 900) });
  if (!gate.pass) return { ok: false, error: `Quality Gate: ${gate.fails.join('; ')}` };

  // 3) фон: светлый docs-кадр по теме
  let bgImageBuffer = null;
  try { bgImageBuffer = await genCineImage(sc.imagePrompt || 'imported cars at customs terminal, professional', 'docs'); } catch (e) { console.error('[NewsCard] bg:', e.message); }

  // 4) рендер эталонной карточки
  const { path, cleanup } = await renderNewsCard({
    bgImageBuffer,
    title: sc.title, titleAccent: sc.titleAccent || '', subtitle: sc.subtitle,
    date: date || new Date().toLocaleDateString('ru-RU'),
    facts: sc.facts.slice(0, 3), accent: '#00D1C2',
  });
  return { ok: true, path, cleanup, caption: sc.caption || sc.title };
}
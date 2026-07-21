/**
 * LegalAuto — Студийная дорисовка фона (ТОЛЬКО для премиум-авто от 7 млн ₽).
 *
 * Берёт отобранное фоторедактором фото авто (телефонное, белый фон, чужое клеймо)
 * и через OpenAI images/edits ставит машину в тёмную кинематографичную студию/город-ночь
 * в стиле ЛИСТ 6 — сохраняя саму машину (форма/цвет/ракурс), меняя ТОЛЬКО фон.
 *
 * Дорого (edit hi = ~несколько центов/кадр) — поэтому включается по порогу цены.
 * Осечка (API упал, не то нарисовал) → возвращаем исходное фото, ролик не падает.
 */
const OPENAI_KEY = () => process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_BACKUP;
const PREMIUM_MIN = Number(process.env.STUDIO_PREMIUM_MIN || 7000000);   // порог, ₽

// Цена (строка «7 500 000 ₽» или число) → число
export function priceValue(price) {
  const n = Number(String(price).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export function isPremium(price) { return priceValue(price) >= PREMIUM_MIN; }

const PROMPT = `Замени ТОЛЬКО фон вокруг автомобиля на тёмную премиальную студию: глубокий чёрный/графитовый фон, мягкий студийный свет сверху, лёгкие отражения на полу, кинематографичная атмосфера, как в дорогой автомобильной рекламе. САМУ МАШИНУ НЕ МЕНЯЙ — сохрани точную форму, цвет, колёса, ракурс и все детали кузова. Убери белый фон, любые вывески, иероглифы и чужие водяные знаки. Фотореализм, без текста и логотипов. Вертикальный кадр 9:16.`;

async function toStudio(buffer) {
  const key = OPENAI_KEY();
  if (!key) return null;
  try {
    const fd = new FormData();
    fd.append('model', process.env.IMAGE_MODEL || 'gpt-image-1');   // edits: gpt-image-1 стабильнее
    fd.append('image', new Blob([buffer], { type: 'image/png' }), 'car.png');
    fd.append('prompt', PROMPT);
    fd.append('size', '1024x1536');
    fd.append('quality', process.env.STUDIO_QUALITY || 'high');
    fd.append('n', '1');
    const r = await Promise.race([
      fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000)),
    ]);
    if (!r.ok) { console.error('[Studio] edit:', (await r.text()).slice(0, 160)); return null; }
    const d = await r.json();
    const b64 = d?.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (e) { console.error('[Studio]', e.message); return null; }
}

/**
 * Прогнать первые N отобранных фото через студию (для премиум-авто).
 * curated: [{ url, buffer }] от photoCurator. Возвращает тот же формат,
 * но у первых maxStudio фото buffer заменён на студийный (если удалось).
 */
export async function studioizePhotos(curated = [], { price, maxStudio = 3 } = {}) {
  if (!isPremium(price) || !OPENAI_KEY()) return { photos: curated, used: 0, premium: isPremium(price) };
  let used = 0;
  const out = [];
  for (let i = 0; i < curated.length; i++) {
    if (i < maxStudio) {
      const studio = await toStudio(curated[i].buffer);
      if (studio) { out.push({ url: curated[i].url, buffer: studio }); used++; continue; }
    }
    out.push(curated[i]);
  }
  console.log(`[Studio] премиум-авто (${priceValue(price).toLocaleString('ru-RU')}₽): студийных кадров ${used}/${Math.min(maxStudio, curated.length)}`);
  return { photos: out, used, premium: true };
}

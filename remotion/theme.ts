import { continueRender, delayRender } from 'remotion';
import { FONT_BOLD_B64, FONT_SEMI_B64, FONT_REG_B64 } from './fontsData';
// ЕДИНСТВЕННЫЙ источник дизайн-значений — brand/DESIGN_TOKENS.json (хардкод запрещён)
import TOKENS from '../brand/DESIGN_TOKENS.json';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const C: Record<string, string> = (TOKENS as any).colors || {};
const glow = (hex: string, a = 0.45) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const theme = {
  // Направления из DESIGN_TOKENS: авто=store(золото), запчасти=parts(оранж), документы=legal(бирюза)
  car:  { accent: C.store || '#D4AF37', accent2: C.store_2 || '#B9972E', glow: glow(C.store || '#D4AF37') },
  part: { accent: C.parts || '#FF6B00', accent2: C.parts_2 || '#FF944D', glow: glow(C.parts || '#FF6B00') },
  docs: { accent: C.legal || '#1c7fd6', accent2: C.legal_2 || '#0e4f8a', glow: glow(C.legal || '#1c7fd6') },
  gold: C.store || '#D4AF37',
  goldLight: C.gold_light || '#F2E6B1',
  silver: '#C0C0C0',
  bg: C.background || '#05070b',
  bg2: C.surface || '#0e1118',
  text: C.text || '#ffffff',
  muted: C.text_muted || '#A6A6A6',
};

export type SpecChip = { label: string; value: string };

export type ReelProps = {
  kind: 'car' | 'part';
  brand: string;       // BMW
  model: string;       // 3 Series 2023
  tagline: string;     // короткий хук
  specs: SpecChip[];   // [{label:'Пробег',value:'85 000 км'}, ...]
  price: string;       // "2 859 000 ₽"
  priceLabel: string;  // "цена под ключ"
  location: string;    // "из Китая"
  cta: string;         // "Заказ авто → @LegalAuto247"
  photos: string[];    // полноразмерные URL
};

// Шрифты — инжектим один раз
let fontsInjected = false;
export function ensureFonts() {
  if (fontsInjected || typeof document === 'undefined') return;
  fontsInjected = true;
  const handle = delayRender('fonts');
  const d = (b64: string) => `url('data:font/ttf;base64,${b64}') format('truetype')`;
  const css = `
    @font-face{font-family:'Mont';font-weight:700;src:${d(FONT_BOLD_B64)};}
    @font-face{font-family:'Mont';font-weight:600;src:${d(FONT_SEMI_B64)};}
    @font-face{font-family:'Mont';font-weight:400;src:${d(FONT_REG_B64)};}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const fontsApi = (document as any).fonts;
  if (fontsApi?.load) {
    Promise.all([
      fontsApi.load('700 40px Mont'),
      fontsApi.load('600 40px Mont'),
      fontsApi.load('400 40px Mont'),
    ]).then(() => continueRender(handle)).catch(() => continueRender(handle));
  } else {
    continueRender(handle);
  }
  setTimeout(() => continueRender(handle), 2000);
}

export const FONT = "'Mont', sans-serif";

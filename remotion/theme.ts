import { continueRender, delayRender } from 'remotion';
import { FONT_BOLD_B64, FONT_SEMI_B64, FONT_REG_B64 } from './fontsData';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const theme = {
  car:  { accent: '#3b82f6', accent2: '#1d4ed8', glow: 'rgba(59,130,246,0.45)' },
  part: { accent: '#10b981', accent2: '#047857', glow: 'rgba(16,185,129,0.45)' },
  bg: '#070b12',
  bg2: '#0d1422',
  text: '#ffffff',
  muted: '#9fb0c5',
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

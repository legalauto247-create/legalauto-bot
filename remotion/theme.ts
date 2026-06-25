import { continueRender, delayRender } from 'remotion';
import { FONT_BOLD_B64, FONT_SEMI_B64, FONT_REG_B64 } from './fontsData';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const theme = {
  // Официальный фирстиль LegalAuto: золото #D4AF37 + серебро на чёрном.
  // Направления: авто=золото, запчасти=красный, документы=синий.
  car:  { accent: '#D4AF37', accent2: '#B9972E', glow: 'rgba(212,175,55,0.45)' },
  part: { accent: '#c02531', accent2: '#7a1820', glow: 'rgba(192,37,49,0.45)' },
  docs: { accent: '#1c7fd6', accent2: '#0e4f8a', glow: 'rgba(28,127,214,0.45)' },
  gold: '#D4AF37',
  goldLight: '#F2E6B1',
  silver: '#C0C0C0',
  bg: '#05070b',
  bg2: '#0e1118',
  text: '#ffffff',
  muted: '#A6A6A6',
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

import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 3 (PARTS), 1080x1350 — СТРОГО по макету Эдо:
// шапка + чип категории с подписью • заголовок + модели бирюзой • СОВМЕСТИМОСТЬ
// • OEM • преимущества сеткой 2x3 (иконка+заголовок+подпись) • фото вплавлено
// в тёмную сцену (виньетка, без рамок) • ЦЕНА в оранжевой рамке + В НАЛИЧИИ
// • футер: канал | подбор по VIN | консультация | гарантия.
export type PartsCardProps = {
  category?: string;         // «ОПТИКА»
  categorySub?: string;      // «свет · безопасность · стиль»
  name: string;
  models?: string;           // «BMW X5 G05 / X6 G06»
  compatibility?: string[];
  oem?: string;
  price: string;
  condition?: string;
  photo: string;
  inStock?: boolean;
};

const ORANGE = '#FF6B00';
const TEAL = '#00D1C2';
const BG = '#0B0F14';

const Shield: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={ORANGE} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={ORANGE} textAnchor="middle">LA</text>
  </svg>
);

// Преимущества (ЛИСТ 3): иконка + заголовок + подпись, сетка 2 колонки
const BENEFITS: Array<[string, string, string]> = [
  ['🛡', '100% ОРИГИНАЛ', 'заводской оригинал'],
  ['📸', 'РЕАЛЬНЫЕ ФОТО', 'и видео детали'],
  ['✅', 'ПРОВЕРЕНО', 'перед отправкой'],
  ['↩️', '14 ДНЕЙ НА ВОЗВРАТ', 'без лишних вопросов'],
  ['📦', 'НАДЁЖНАЯ УПАКОВКА', 'защита при доставке'],
  ['🚚', 'БЫСТРАЯ ДОСТАВКА', 'по всей России'],
];

export const PartsCard: React.FC<PartsCardProps> = (p) => {
  ensureFonts();
  const photo = /^https?:/.test(p.photo || '') ? p.photo : (p.photo ? staticFile(p.photo) : '');
  const compat = (p.compatibility || []).slice(0, 3);
  const longestWord = Math.max(...p.name.split(/\s+/).map(w => w.length), 1);
  const nameSize = longestWord > 11 ? 46 : longestWord > 8 ? 56 : 68;

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, color: '#fff' }}>
      {/* карбоновая текстура (ЛИСТ 3) */}
      <AbsoluteFill style={{ opacity: 0.06, backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 24px)' }} />

      {/* ФОТО: вплавлено в сцену — правая часть, виньетка гасит края в фон (БЕЗ рамки) */}
      {photo ? (
        <div style={{ position: 'absolute', right: 0, top: 170, width: 660, height: 730 }}>
          <Img src={photo} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.92) saturate(1.05)' }} />
          {/* виньетка: края растворяются в чёрном фоне сцены */}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${BG} 0%, rgba(11,15,20,0.55) 18%, transparent 45%)` }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${BG} 0%, transparent 22%, transparent 62%, ${BG} 96%)` }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(270deg, ${BG} 0%, transparent 14%)` }} />
        </div>
      ) : null}
      {/* акцентные световые линии (teal + orange, как на листе) */}
      <div style={{ position: 'absolute', right: 40, top: 200, width: 420, height: 3, background: `linear-gradient(90deg, transparent, ${TEAL})`, opacity: 0.75, transform: 'rotate(-18deg)' }} />
      <div style={{ position: 'absolute', right: 120, top: 860, width: 380, height: 3, background: `linear-gradient(90deg, transparent, ${ORANGE})`, opacity: 0.7, transform: 'rotate(-14deg)' }} />

      {/* шапка: лого слева, чип категории справа (с подписью, как на листе) */}
      <div style={{ position: 'absolute', top: 44, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Shield />
          <div>
            <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: 1 }}>LEGAL AUTO <span style={{ color: ORANGE }}>PARTS</span></div>
            <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: 2.5, color: '#9BA3AF' }}>ОРИГИНАЛЬНЫЕ ЗАПЧАСТИ ДЛЯ ВАШЕГО АВТО</div>
          </div>
        </div>
        {p.category ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ border: `1.5px solid ${TEAL}`, borderRadius: 12, padding: '9px 26px', fontWeight: 700, fontSize: 24, color: TEAL, textTransform: 'uppercase', background: 'rgba(11,15,20,0.7)' }}>{p.category}</div>
            {p.categorySub ? <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: 2, color: '#9BA3AF', marginTop: 7, textTransform: 'uppercase' }}>{p.categorySub}</div> : null}
          </div>
        ) : null}
      </div>

      {/* контент слева: заголовок → модели → совместимость → OEM */}
      <div style={{ position: 'absolute', left: 56, top: 220, width: 470, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: nameSize, lineHeight: 1.08, textTransform: 'uppercase', textShadow: '0 4px 26px rgba(0,0,0,.95)' }}>{p.name}</div>
        {p.models ? <div style={{ fontWeight: 700, fontSize: 38, marginTop: 10, textShadow: '0 3px 18px rgba(0,0,0,.9)' }}><span style={{ color: '#fff' }}>{p.models.split(' ')[0]} </span><span style={{ color: TEAL }}>{p.models.split(' ').slice(1).join(' ')}</span></div> : null}

        {compat.length ? (
          <div style={{ marginTop: 26 }}>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 1.5, color: TEAL }}>СОВМЕСТИМОСТЬ:</div>
            {compat.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 26, color: '#E6E9EC', marginTop: 8, textShadow: '0 2px 12px rgba(0,0,0,.9)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: TEAL }} />{c}
              </div>
            ))}
          </div>
        ) : null}

        {p.oem ? (
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 26, color: TEAL }}>OEM:</div>
            <div style={{ fontWeight: 700, fontSize: 30, color: '#fff', letterSpacing: 1.5, textShadow: '0 2px 12px rgba(0,0,0,.9)' }}>{p.oem}</div>
          </div>
        ) : null}

        {/* преимущества: сетка 2 колонки, иконка + заголовок + подпись (как на листе) */}
        <div style={{ marginTop: 34, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 22px', width: 470 }}>
          {BENEFITS.map(([ic, t, sub], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, border: `1.5px solid ${ORANGE}77`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: 'rgba(11,15,20,0.7)', flexShrink: 0 }}>{ic}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 19, letterSpacing: 0.5 }}>{i === 0 && p.condition ? p.condition.toUpperCase() : t}</div>
                <div style={{ fontWeight: 400, fontSize: 16, color: '#9BA3AF', marginTop: 2 }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ЦЕНА + В НАЛИЧИИ — внизу справа, при фото (как на листе) */}
      <div style={{ position: 'absolute', right: 56, bottom: 170, display: 'flex', alignItems: 'flex-end', gap: 22 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 24, letterSpacing: 5, color: '#C8CDD2', marginBottom: 8, textShadow: '0 2px 10px rgba(0,0,0,.9)' }}>ЦЕНА</div>
          <div style={{ border: `2.5px solid ${ORANGE}`, borderRadius: 16, padding: '16px 38px', fontWeight: 700, fontSize: 56, color: ORANGE, background: 'rgba(11,15,20,0.82)', boxShadow: `0 0 44px ${ORANGE}30` }}>{p.price}</div>
        </div>
        {p.inStock !== false ? (
          <div style={{ border: `1.5px solid ${TEAL}`, borderRadius: 14, padding: '14px 24px', background: 'rgba(11,15,20,0.82)', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 24, color: TEAL, letterSpacing: 1 }}>В НАЛИЧИИ ✓</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#9BA3AF', marginTop: 4, letterSpacing: 1 }}>НА СКЛАДЕ В МОСКВЕ</div>
          </div>
        ) : null}
      </div>

      {/* футер: канал | подбор по VIN | консультация | гарантия (как на листе) */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 44 }}>
        <div style={{ height: 1.5, background: 'rgba(255,255,255,0.12)', marginBottom: 20 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#2AABEE', color: '#fff', fontWeight: 700, fontSize: 22, padding: '10px 20px', borderRadius: 12, flexShrink: 0 }}>✈ @LegalAutoParts24</div>
          {['ПОДБОР ПО VIN', 'КОНСУЛЬТАЦИЯ', 'ГАРАНТИЯ КАЧЕСТВА'].map((t, i) => (
            <React.Fragment key={i}>
              <div style={{ width: 1.5, height: 26, background: 'rgba(255,255,255,0.2)', margin: '0 22px' }} />
              <div style={{ fontWeight: 600, fontSize: 19, color: '#C8CDD2', whiteSpace: 'nowrap' }}>{t}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

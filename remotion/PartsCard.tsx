import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 3 (PARTS) — карточка запчасти 1080x1350.
// Категория-chip (бирюза), НАЗВАНИЕ + модели (коды бирюзой), совместимость,
// OEM выделен, преимущества-иконки, фото на тёмном фоне, ЦЕНА оранжем + В НАЛИЧИИ.
export type PartsCardProps = {
  category?: string;        // «ОПТИКА»
  name: string;             // «Правая LED фара»
  models?: string;          // «BMW X5 G05 / X6 G06»
  compatibility?: string[]; // строки совместимости
  oem?: string;
  price: string;            // «125 000 ₽»
  condition?: string;       // «Оригинал Б/У»
  photo: string;            // URL фото из каталога (ТОЛЬКО каталог)
  inStock?: boolean;
};

const ORANGE = '#FF6B00';
const TEAL = '#00D1C2';

const Shield: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={ORANGE} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={ORANGE} textAnchor="middle">LA</text>
  </svg>
);

export const PartsCard: React.FC<PartsCardProps> = (p) => {
  ensureFonts();
  const photo = /^https?:/.test(p.photo || '') ? p.photo : (p.photo ? staticFile(p.photo) : '');
  const compat = (p.compatibility || []).slice(0, 3);

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: FONT, color: '#fff' }}>
      {/* карбоновый паттерн (ЛИСТ 3: карбоновая текстура) */}
      <AbsoluteFill style={{ opacity: 0.05, backgroundImage: `repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 26px)` }} />
      {/* фото детали: правая половина на тёмном фоне */}
      {photo ? (
        <>
          <Img src={photo} style={{ position: 'absolute', right: 0, top: 130, width: '62%', height: '58%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `linear-gradient(95deg, ${theme.bg} 34%, rgba(11,15,20,0.55) 50%, rgba(11,15,20,0.06) 72%)` }} />
          <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(11,15,20,0.55) 8%, transparent 24%, rgba(11,15,20,0.7) 62%, ${theme.bg} 74%)` }} />
        </>
      ) : null}
      {/* оранжевая линия-акцент */}
      <div style={{ position: 'absolute', right: 0, top: 156, width: 340, height: 2, background: `linear-gradient(90deg, transparent, ${ORANGE})`, opacity: 0.85 }} />

      {/* шапка */}
      <div style={{ position: 'absolute', top: 44, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Shield />
          <div>
            <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: 1 }}>LEGAL AUTO <span style={{ color: ORANGE }}>PARTS</span></div>
            <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: 2.5, color: '#9BA3AF' }}>ОРИГИНАЛЬНЫЕ ЗАПЧАСТИ ДЛЯ ВАШЕГО АВТО</div>
          </div>
        </div>
        {p.category ? (
          <div style={{ border: `1.5px solid ${TEAL}`, borderRadius: 999, padding: '9px 22px', fontWeight: 700, fontSize: 20, color: TEAL, textTransform: 'uppercase', background: 'rgba(11,15,20,0.6)' }}>{p.category}</div>
        ) : null}
      </div>

      {/* название + модели + совместимость + OEM — колонка слева */}
      <div style={{ position: 'absolute', left: 56, top: 220, maxWidth: 520, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: p.name.length > 18 ? 58 : 72, lineHeight: 1.06, textTransform: 'uppercase', textShadow: '0 4px 26px rgba(0,0,0,.95)' }}>{p.name}</div>
        {p.models ? <div style={{ fontWeight: 700, fontSize: 40, color: TEAL, marginTop: 12, textShadow: '0 3px 18px rgba(0,0,0,.9)' }}>{p.models}</div> : null}

        {compat.length ? (
          <div style={{ marginTop: 30 }}>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: 2, color: TEAL }}>СОВМЕСТИМОСТЬ:</div>
            {compat.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 27, color: '#E6E9EC', marginTop: 10, textShadow: '0 2px 12px rgba(0,0,0,.9)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: TEAL }} />{c}
              </div>
            ))}
          </div>
        ) : null}

        {p.oem ? (
          <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 26, color: '#9BA3AF' }}>OEM:</div>
            <div style={{ fontWeight: 700, fontSize: 32, color: ORANGE, letterSpacing: 1.5, background: 'rgba(255,107,0,0.10)', border: `1.5px solid ${ORANGE}66`, borderRadius: 10, padding: '6px 18px' }}>{p.oem}</div>
          </div>
        ) : null}
      </div>

      {/* преимущества-иконки (ЛИСТ 3) */}
      <div style={{ position: 'absolute', left: 56, bottom: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[['🛡', `${p.condition || '100% оригинал'} · проверено перед отправкой`], ['📸', 'Реальные фото и видео детали'], ['📦', 'Надёжная упаковка · 14 дней на возврат'], ['🚚', 'Быстрая доставка по всей России']].map(([ic, t], i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 23, color: '#D7DBDF' }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, border: `1.5px solid ${ORANGE}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: 'rgba(11,15,20,0.65)' }}>{ic}</div>{t}
          </div>
        ))}
      </div>

      {/* ЦЕНА оранжевым + В НАЛИЧИИ */}
      <div style={{ position: 'absolute', right: 56, bottom: 330, textAlign: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 22, letterSpacing: 4, color: '#9BA3AF', marginBottom: 8 }}>ЦЕНА</div>
        <div style={{ border: `2.5px solid ${ORANGE}`, borderRadius: 16, padding: '16px 36px', fontWeight: 700, fontSize: 54, color: ORANGE, background: 'rgba(11,15,20,0.8)', boxShadow: `0 0 40px ${ORANGE}30` }}>{p.price}</div>
        {p.inStock !== false ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 14, border: `1.5px solid ${TEAL}`, borderRadius: 12, padding: '9px 22px', fontWeight: 700, fontSize: 22, color: TEAL, background: 'rgba(11,15,20,0.7)' }}>В НАЛИЧИИ ✓</div>
        ) : null}
      </div>

      {/* футер */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 44 }}>
        <div style={{ height: 1.5, background: 'rgba(255,255,255,0.12)', marginBottom: 20 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: ORANGE, color: '#0B0F14', fontWeight: 700, fontSize: 22, padding: '11px 20px', borderRadius: 12, flexShrink: 0 }}>✈ @LegalAutoParts24</div>
          <div style={{ fontWeight: 600, fontSize: 19, color: '#C8CDD2', whiteSpace: 'nowrap' as const, margin: '0 12px' }}>ПОДБОР ПО VIN · КОНСУЛЬТАЦИЯ</div>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: 2, color: '#9BA3AF', whiteSpace: 'nowrap' as const }}>ГАРАНТИЯ КАЧЕСТВА</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

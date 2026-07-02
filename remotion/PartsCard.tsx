import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 3 (PARTS) — карточка запчасти 1080x1350. v2:
// фото ЦЕЛИКОМ в студийной рамке (блюр-подложка + contain) — реальные фото
// с разборки выглядят премиально; текстовая колонка слева, цена оранжем.
export type PartsCardProps = {
  category?: string;
  name: string;
  models?: string;
  compatibility?: string[];
  oem?: string;
  price: string;
  condition?: string;
  photo: string;
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
  const longestWord = Math.max(...p.name.split(/\s+/).map(w => w.length), 1);
  const nameSize = longestWord > 11 ? 44 : longestWord > 8 ? 54 : p.name.length > 16 ? 60 : 70;

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: FONT, color: '#fff' }}>
      {/* карбон-паттерн + оранжевое свечение за фото-панелью */}
      <AbsoluteFill style={{ opacity: 0.05, backgroundImage: `repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 26px)` }} />
      <div style={{ position: 'absolute', right: 20, top: 330, width: 560, height: 560, borderRadius: '50%', background: `radial-gradient(circle, ${ORANGE}26 0%, transparent 65%)`, filter: 'blur(30px)' }} />
      <div style={{ position: 'absolute', right: 0, top: 150, width: 340, height: 2, background: `linear-gradient(90deg, transparent, ${ORANGE})`, opacity: 0.85 }} />

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

      {/* ФОТО: студийная рамка справа — деталь ЦЕЛИКОМ (contain) на блюр-подложке */}
      {photo ? (
        <div style={{ position: 'absolute', right: 56, top: 218, width: 520, height: 620, borderRadius: 28, overflow: 'hidden', border: `1.5px solid ${ORANGE}55`, boxShadow: `0 26px 70px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.12)`, background: '#11161D' }}>
          <Img src={photo} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(34px) brightness(0.28) saturate(1.05)', transform: 'scale(1.25)' }} />
          <Img src={photo} style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 16px 28px rgba(0,0,0,.55))' }} />
        </div>
      ) : null}

      {/* текстовая колонка слева */}
      <div style={{ position: 'absolute', left: 56, top: 218, width: 400, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: nameSize, lineHeight: 1.08, textTransform: 'uppercase' }}>{p.name}</div>
        {p.models ? <div style={{ fontWeight: 700, fontSize: 36, color: TEAL, marginTop: 12 }}>{p.models}</div> : null}

        {compat.length ? (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontWeight: 700, fontSize: 21, letterSpacing: 2, color: TEAL }}>СОВМЕСТИМОСТЬ:</div>
            {compat.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 26, color: '#E6E9EC', marginTop: 9 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: TEAL }} />{c}
              </div>
            ))}
          </div>
        ) : null}

        {p.oem ? (
          <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 24, color: '#9BA3AF' }}>OEM:</div>
            <div style={{ fontWeight: 700, fontSize: 28, color: ORANGE, letterSpacing: 1.2, background: 'rgba(255,107,0,0.10)', border: `1.5px solid ${ORANGE}66`, borderRadius: 10, padding: '6px 16px' }}>{p.oem}</div>
          </div>
        ) : null}
      </div>

      {/* нижняя зона: преимущества слева, цена справа — на одном уровне */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 160, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {[['🛡', `${p.condition || '100% оригинал'} · проверено перед отправкой`], ['📸', 'Реальные фото и видео детали'], ['📦', 'Надёжная упаковка · 14 дней на возврат'], ['🚚', 'Быстрая доставка по всей России']].map(([ic, t], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, color: '#D7DBDF' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, border: `1.5px solid ${ORANGE}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: 'rgba(11,15,20,0.65)' }}>{ic}</div>{t}
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 22, letterSpacing: 4, color: '#9BA3AF', marginBottom: 8 }}>ЦЕНА</div>
          <div style={{ border: `2.5px solid ${ORANGE}`, borderRadius: 16, padding: '16px 36px', fontWeight: 700, fontSize: 52, color: ORANGE, background: 'rgba(11,15,20,0.8)', boxShadow: `0 0 40px ${ORANGE}30` }}>{p.price}</div>
          {p.inStock !== false ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 12, border: `1.5px solid ${TEAL}`, borderRadius: 12, padding: '8px 20px', fontWeight: 700, fontSize: 21, color: TEAL, background: 'rgba(11,15,20,0.7)' }}>В НАЛИЧИИ ✓</div>
          ) : null}
        </div>
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

import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 4 (STORE) — пост 1080x1350, продажа/пригон авто.
// Марка+модель капсом, год в золотой рамке, фото-герой справа, характеристики
// с иконками, ЦЕНА золотом в рамке, преимущества, CTA.
export type Spec = { icon?: string; label: string; value: string };
export type StoreCardProps = {
  brand: string; model: string; year?: string;
  photo: string;                    // фото-герой (URL)
  specs: Spec[];                    // до 6
  price: string;                    // «6 950 000 ₽»
  priceNote?: string;               // «выгода и безопасность с нами»
  badge?: string;                   // «ПОДБОР ПОД КЛЮЧ» и т.п.
  accent?: string;
};

const GOLD = '#D4AF37';
const SPEC_ICONS: Record<string, string> = { пробег: '🛣', двигатель: '⚙️', привод: '🔄', коробка: '🕹', комплектация: '⭐', состояние: '✅', год: '📅', цвет: '🎨' };

const Shield: React.FC<{ accent: string; size?: number }> = ({ accent, size = 54 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={accent} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={accent} textAnchor="middle">LA</text>
  </svg>
);

export const StoreCard: React.FC<StoreCardProps> = (p) => {
  ensureFonts();
  const accent = p.accent || GOLD;
  const specs = (p.specs || []).slice(0, 6);
  const photo = /^https?:/.test(p.photo || '') ? p.photo : (p.photo ? staticFile(p.photo) : '');

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: FONT, color: '#fff' }}>
      {/* фото-герой: правые 2/3, гаснет влево и вниз (взгляд авто → заголовок → цена) */}
      {photo ? (
        <>
          <Img src={photo} style={{ position: 'absolute', right: 0, top: 0, width: '82%', height: '72%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `linear-gradient(95deg, ${theme.bg} 22%, rgba(11,15,20,0.6) 45%, rgba(11,15,20,0.05) 75%)` }} />
          <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(11,15,20,0.3) 0%, transparent 20%, rgba(11,15,20,0.75) 60%, ${theme.bg} 76%)` }} />
        </>
      ) : null}
      {/* золотая линия-акцент */}
      <div style={{ position: 'absolute', right: 0, top: 190, width: 300, height: 2, background: `linear-gradient(90deg, transparent, ${accent})`, opacity: 0.8 }} />

      {/* шапка */}
      <div style={{ position: 'absolute', top: 44, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Shield accent={accent} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: 1 }}>LEGAL AUTO <span style={{ color: accent }}>STORE</span></div>
            <div style={{ fontWeight: 600, fontSize: 18, letterSpacing: 3, color: '#9BA3AF' }}>ПОДБОР И ПРОДАЖА АВТО</div>
          </div>
        </div>
        {p.badge ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1.5px solid ${accent}`, borderRadius: 999, padding: '10px 22px', fontWeight: 700, fontSize: 20, color: accent, textTransform: 'uppercase', background: 'rgba(11,15,20,0.55)' }}>🌐 {p.badge}</div>
        ) : null}
      </div>

      {/* марка + модель + год + характеристики — единая колонка (без наложений) */}
      <div style={{ position: 'absolute', left: 56, top: 230, maxWidth: 540, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: 52, textTransform: 'uppercase', textShadow: '0 4px 24px rgba(0,0,0,.9)' }}>{p.brand}</div>
        <div style={{ fontWeight: 700, fontSize: p.model.length > 10 ? 74 : 90, lineHeight: 1.04, textTransform: 'uppercase', textShadow: '0 4px 30px rgba(0,0,0,.9)' }}>{p.model}</div>
        {p.year ? (
          <div style={{ alignSelf: 'flex-start', marginTop: 18, border: `2px solid ${accent}`, color: accent, fontWeight: 700, fontSize: 32, padding: '7px 22px', borderRadius: 10, background: 'rgba(11,15,20,0.6)' }}>{p.year}</div>
        ) : null}
        <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 15 }}>
        {specs.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 29 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, border: `1.5px solid ${accent}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: 'rgba(11,15,20,0.6)' }}>{s.icon || SPEC_ICONS[s.label.toLowerCase()] || '•'}</div>
            <div style={{ color: '#9BA3AF', fontWeight: 600 }}>{s.label}:</div>
            <div style={{ fontWeight: 600, textShadow: '0 2px 10px rgba(0,0,0,.8)' }}>{s.value}</div>
          </div>
        ))}
        </div>
      </div>

      {/* ЦЕНА золотом в рамке */}
      <div style={{ position: 'absolute', right: 56, bottom: 224, textAlign: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 24, letterSpacing: 4, color: '#9BA3AF', marginBottom: 10 }}>ЦЕНА</div>
        <div style={{ border: `2.5px solid ${accent}`, borderRadius: 16, padding: '18px 40px', fontWeight: 700, fontSize: 58, color: accent, background: 'rgba(11,15,20,0.75)', boxShadow: `0 0 40px ${accent}33` }}>{p.price}</div>
        {p.priceNote ? <div style={{ fontWeight: 400, fontSize: 18, color: '#C8CDD2', marginTop: 10, whiteSpace: 'nowrap' as const }}>{p.priceNote}</div> : null}
      </div>

      {/* преимущества-иконки */}
      <div style={{ position: 'absolute', left: 56, bottom: 148, right: 56, display: 'flex', gap: 26, flexWrap: 'wrap' as const }}>
        {[['✅', '100% юридическая чистота'], ['🔍', 'Проверка 100+ пунктов'], ['🚚', 'Доставка по РФ и СНГ'], ['🤝', 'Сопровождение сделки']].map(([ic, t], i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18.5, color: '#D7DBDF' }}>
            <span style={{ fontSize: 24 }}>{ic}</span>{t}
          </div>
        ))}
      </div>

      {/* футер CTA */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 44 }}>
        <div style={{ height: 1.5, background: 'rgba(255,255,255,0.12)', marginBottom: 20 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: accent, color: '#0B0F14', fontWeight: 700, fontSize: 22, padding: '11px 20px', borderRadius: 12, flexShrink: 0 }}>✈ @LegalAutoStore</div>
          <div style={{ fontWeight: 600, fontSize: 19, color: '#C8CDD2', whiteSpace: 'nowrap' as const, margin: '0 14px' }}>КОНСУЛЬТАЦИЯ БЕСПЛАТНО</div>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: 2, color: '#9BA3AF', whiteSpace: 'nowrap' as const }}>ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

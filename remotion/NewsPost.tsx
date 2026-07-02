import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 2 (NEWS) — пост 1080x1350.
// Заголовок КАПСОМ ≤3 строк, бирюзовый акцент, 3 факт-блока, футер со слоганом.
export type NewsFact = { icon: string; label: string; text: string };
export type NewsPostProps = {
  title: string;        // ЗАГОЛОВОК (капс, ≤3 строк)
  titleAccent?: string; // строка бирюзой (напр. «С 1 ИЮЛЯ 2026»)
  subtitle: string;     // 2-3 строки сути
  date?: string;        // 29.06.2026
  facts: NewsFact[];    // ровно 3: ЧТО ИЗМЕНИТСЯ? / КОГО КАСАЕТСЯ? / ЧТО ДЕЛАТЬ?
  bgImage?: string;     // AI-кадр по теме (https или имя в public)
  accent?: string;
};

const ACC = '#00D1C2';

const Shield: React.FC<{ accent: string; size?: number }> = ({ accent, size = 56 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={accent} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={accent} textAnchor="middle">LA</text>
  </svg>
);

export const NewsPost: React.FC<NewsPostProps> = (p) => {
  ensureFonts();
  const accent = p.accent || ACC;
  const facts = (p.facts || []).slice(0, 3);
  const bg = p.bgImage ? (/^https?:/.test(p.bgImage) ? p.bgImage : staticFile(p.bgImage)) : null;

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: FONT, color: '#fff' }}>
      {/* фон-фото по теме: справа-сверху, гаснет к левому краю (взгляд объект→заголовок) */}
      {bg ? (
        <>
          <Img src={bg} style={{ position: 'absolute', right: 0, top: 0, width: '78%', height: '68%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `linear-gradient(100deg, ${theme.bg} 30%, rgba(11,15,20,0.55) 55%, rgba(11,15,20,0.15) 80%)` }} />
          <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(11,15,20,0.25) 0%, transparent 25%, rgba(11,15,20,0.85) 58%, ${theme.bg} 74%)` }} />
        </>
      ) : null}
      {/* тонкие акцентные линии (ЛИСТ 2: линии и акценты) */}
      <div style={{ position: 'absolute', right: 0, top: 210, width: 320, height: 2, background: `linear-gradient(90deg, transparent, ${accent})`, opacity: 0.7 }} />

      {/* ── Шапка: лого слева + НОВОСТИ, дата справа ── */}
      <div style={{ position: 'absolute', top: 44, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Shield accent={accent} size={54} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: 1 }}>LEGAL AUTO</div>
            <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: 4, color: accent }}>НОВОСТИ</div>
          </div>
        </div>
        {p.date ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 24, color: '#9BA3AF' }}>
            {p.date}<div style={{ width: 10, height: 10, background: accent }} />
          </div>
        ) : null}
      </div>

      {/* ── Заголовок: КАПС белый ≤3 строк + бирюзовая строка ── */}
      <div style={{ position: 'absolute', left: 56, right: 280, top: 250 }}>
        <div style={{ fontWeight: 700, fontSize: 76, lineHeight: 1.1, textTransform: 'uppercase', textShadow: '0 4px 30px rgba(0,0,0,.9)' }}>{p.title}</div>
        {p.titleAccent ? (
          <div style={{ fontWeight: 700, fontSize: 60, marginTop: 12, color: accent, textTransform: 'uppercase', textShadow: '0 4px 24px rgba(0,0,0,.9)' }}>{p.titleAccent}</div>
        ) : null}
        <div style={{ width: 120, height: 3, background: accent, margin: '30px 0' }} />
        <div style={{ fontWeight: 400, fontSize: 32, lineHeight: 1.4, color: '#E6E9EC', maxWidth: 660, textShadow: '0 2px 16px rgba(0,0,0,.9)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>{p.subtitle}</div>
      </div>

      {/* ── 3 факт-блока (эталон: что изменится / кого касается / что делать) ── */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 176, display: 'flex', gap: 22 }}>
        {facts.map((f, i) => (
          <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 22, padding: '26px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, border: `1.5px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 25, color: accent, textTransform: 'uppercase' }}>{f.label}</div>
            </div>
            <div style={{ fontWeight: 400, fontSize: 24.5, lineHeight: 1.35, color: '#D7DBDF' }}>{f.text}</div>
          </div>
        ))}
      </div>

      {/* ── Футер: телеграм + слоган + сайт ── */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 48 }}>
        <div style={{ height: 1.5, background: 'rgba(255,255,255,0.12)', marginBottom: 24 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: accent, color: '#0B0F14', fontWeight: 700, fontSize: 23, padding: '11px 20px', borderRadius: 12, flexShrink: 0 }}>✈ @LegalAuto247</div>
          <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: 2.5, color: '#9BA3AF', whiteSpace: 'nowrap' as const, margin: '0 18px' }}>ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ</div>
          <div style={{ fontWeight: 600, fontSize: 20, color: '#C8CDD2', whiteSpace: 'nowrap' as const }}>🌐 LEGAL-AUTO.RU</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

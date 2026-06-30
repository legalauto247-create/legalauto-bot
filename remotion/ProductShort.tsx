import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type Item = { photo: string; name: string; price?: string; fits?: string };
export type ProductProps = {
  items: Item[];
  hook: string;
  cta: string;
  channel: string;
  accent: string;
  musicFile?: string;
};

const FPS = 30;
const INTRO = 48;   // 1.6с
const PER = 84;     // 2.8с — спокойно, читаемо
const OUTRO = 78;

export const productDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;

// Щит LA в цвете направления (как в логотипе/шаблонах)
const Shield: React.FC<{ accent: string; size?: number }> = ({ accent, size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={accent} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={accent} textAnchor="middle">LA</text>
  </svg>
);

// Постоянная шапка — как в брендбуке
const Header: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ position: 'absolute', top: 50, left: 56, right: 56, zIndex: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <Shield accent={accent} size={56} />
      <div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 38, letterSpacing: 0.5, lineHeight: 1 }}>
          <span style={{ color: '#fff' }}>LEGAL AUTO </span><span style={{ color: accent }}>PARTS</span>
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 22, color: '#A6A6A6', marginTop: 4 }}>Запчасти и комплектующие</div>
      </div>
    </div>
    <div style={{ height: 2, marginTop: 16, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
  </div>
);

// Постоянный футер — контакты + слоган
const Footer: React.FC<{ accent: string; channel: string }> = ({ accent, channel }) => (
  <div style={{ position: 'absolute', left: 56, right: 56, bottom: 46, zIndex: 6 }}>
    <div style={{ height: 2, marginBottom: 16, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 30 }}>
      <span style={{ color: '#fff' }}>📞 +7 938 515-24-29</span>
      <span style={{ color: accent }}>✈ {channel}</span>
    </div>
    <div style={{ textAlign: 'center', fontFamily: FONT, fontWeight: 400, fontSize: 22, color: '#8a939c', marginTop: 12, fontStyle: 'italic' }}>Ваш надёжный партнёр в мире автомобилей</div>
  </div>
);

const Bg: React.FC<{ accent: string }> = ({ accent }) => (
  <AbsoluteFill style={{ background: `radial-gradient(130% 70% at 50% 0%, ${accent}26 -20%, #14110a 35%, ${theme.bg} 100%)` }} />
);

// Карточка запчасти — как твой шаблон: фото в рамке, плашка модели, имя, бейдж цены
const PartScene: React.FC<{ item: Item; accent: string }> = ({ item, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 20, stiffness: 90 } });
  const out = interpolate(f, [PER - 12, PER], [1, 0], { extrapolateLeft: 'clamp' });
  const zoom = interpolate(f, [0, PER], [1.0, 1.06]);
  const chip = spring({ frame: f - 6, fps: FPS, config: { damping: 18 } });
  const price = spring({ frame: f - 12, fps: FPS, config: { damping: 12, stiffness: 140 } });

  return (
    <AbsoluteFill style={{ opacity: out }}>
      {/* фото в аккуратной рамке (как в карточке) */}
      <div style={{ position: 'absolute', top: 230, left: 70, right: 70, height: 660, borderRadius: 26, overflow: 'hidden', border: `2px solid ${accent}66`, boxShadow: `0 24px 70px rgba(0,0,0,.55)`, transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s }}>
        <Img src={item.photo} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(26px) brightness(0.5)', transform: 'scale(1.2)' }} />
        <Img src={item.photo} style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})` }} />
      </div>

      {/* модель + имя + цена */}
      <div style={{ position: 'absolute', left: 70, right: 70, top: 935, textAlign: 'center' }}>
        {item.fits ? (
          <div style={{ display: 'inline-block', opacity: chip, transform: `translateY(${interpolate(chip, [0, 1], [16, 0])}px)`, fontFamily: FONT, fontWeight: 700, fontSize: 32, color: accent, background: '#11151d', border: `1.5px solid ${accent}`, borderRadius: 14, padding: '10px 26px', marginBottom: 16, letterSpacing: 0.5 }}>{item.fits}</div>
        ) : null}
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 58, color: '#fff', lineHeight: 1.12, opacity: s, textShadow: '0 2px 14px rgba(0,0,0,.6)' }}>{item.name}</div>
        {item.price ? (
          <div style={{ display: 'inline-block', marginTop: 18, transform: `scale(${interpolate(price, [0, 1], [0.7, 1])})`, opacity: price, fontFamily: FONT, fontWeight: 700, fontSize: 56, color: theme.bg, background: `linear-gradient(135deg, ${accent}, ${theme.part?.accent2 || accent})`, padding: '14px 42px', borderRadius: 16, boxShadow: `0 10px 36px ${accent}66` }}>{item.price}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const IntroHook: React.FC<{ hook: string; accent: string }> = ({ hook, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 80 } });
  const out = interpolate(f, [INTRO - 8, INTRO], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, opacity: out }}>
      <div style={{ transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s, textAlign: 'center' }}>
        <Shield accent={accent} size={120} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 84, color: '#fff', lineHeight: 1.08, marginTop: 40, textShadow: `0 0 30px ${accent}55` }}>{hook}</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ cta: string; channel: string; accent: string }> = ({ cta, channel, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
      <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)` }}>
        <Shield accent={accent} size={110} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: '#fff', margin: '30px 0 24px' }}>
          <span>LEGAL AUTO </span><span style={{ color: accent }}>PARTS</span>
        </div>
        <div style={{ display: 'inline-block', fontFamily: FONT, fontWeight: 700, fontSize: 50, color: theme.bg, background: accent, padding: '26px 50px', borderRadius: 22 }}>{cta}</div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 44, color: accent, marginTop: 28 }}>{channel}</div>
      </div>
    </AbsoluteFill>
  );
};

export const ProductShort: React.FC<ProductProps> = (p) => {
  ensureFonts();
  const items = (p.items || []).filter(i => i && i.photo).slice(0, 6);
  const n = items.length || 1;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.55} /> : null}
      <Bg accent={p.accent} />

      <Sequence durationInFrames={INTRO + 4}><IntroHook hook={p.hook} accent={p.accent} /></Sequence>

      {items.map((it, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER + 4}>
          <PartScene item={it} accent={p.accent} />
          <Header accent={p.accent} />
          <Footer accent={p.accent} channel={p.channel} />
        </Sequence>
      ))}

      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}><Outro cta={p.cta} channel={p.channel} accent={p.accent} /></Sequence>
    </AbsoluteFill>
  );
};

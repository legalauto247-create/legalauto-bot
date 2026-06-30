import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, random,
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
const INTRO = 42;   // 1.4с хук
const PER = 66;     // 2.2с на запчасть (динамичнее)
const OUTRO = 72;   // 2.4с финал

export const productDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;

// ── Грейн + виньетка поверх всего (премиум-грейд) ──────────────────────────
const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 8 }}>
    <svg width="100%" height="100%" style={{ position: 'absolute', opacity: 0.06 }}>
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" /></filter>
      <rect width="100%" height="100%" filter="url(#n)" />
    </svg>
    <AbsoluteFill style={{ boxShadow: 'inset 0 0 360px 90px rgba(0,0,0,0.85)' }} />
  </AbsoluteFill>
);

// ── Вспышка на склейке ─────────────────────────────────────────────────────
const FlashCut: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 1, 6], [0, 0.9, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: accent, opacity: o, zIndex: 9 }} />;
};

const ProgressBar: React.FC<{ p: number; accent: string }> = ({ p, accent }) => (
  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 7, background: 'rgba(255,255,255,0.12)', zIndex: 7 }}>
    <div style={{ height: '100%', width: `${Math.round(p * 100)}%`, background: accent }} />
  </div>
);

const Wm: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ position: 'absolute', top: 40, left: 50, fontFamily: FONT, fontWeight: 700, fontSize: 36, textShadow: '0 2px 14px rgba(0,0,0,.9)', zIndex: 7 }}>
    <span style={{ color: '#fff' }}>LEGAL</span><span style={{ color: accent }}>AUTO</span>
  </div>
);

// ── Сцена ОДНОЙ запчасти — кино-обработка + кинетический текст ──────────────
const PartScene: React.FC<{ item: Item; accent: string }> = ({ item, accent }) => {
  const f = useCurrentFrame();
  // фото: реактивный «вход» из блюра + ken burns + лёгкий разворот
  const reveal = spring({ frame: f, fps: FPS, config: { damping: 18, stiffness: 120 } });
  const blur = interpolate(reveal, [0, 1], [22, 0]);
  const zoom = interpolate(f, [0, PER], [1.12, 1.28]);
  const rot = interpolate(f, [0, PER], [-1.2, 1.2]);
  const shake = (random(`s${f}`) - 0.5) * interpolate(f, [0, 8], [10, 0], { extrapolateRight: 'clamp' });

  // текст: чип модели слайдит, имя «вбивается», цена пружинит
  const chip = spring({ frame: f - 4, fps: FPS, config: { damping: 16 } });
  const name = spring({ frame: f - 7, fps: FPS, config: { damping: 11, stiffness: 200 } });
  const price = spring({ frame: f - 12, fps: FPS, config: { damping: 9, stiffness: 220 } });
  const outO = interpolate(f, [PER - 8, PER], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ opacity: outO }}>
      {/* размытая подложка-атмосфера */}
      <Img src={item.photo} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.35) saturate(1.3)', transform: 'scale(1.3)' }} />
      <AbsoluteFill style={{ background: `radial-gradient(60% 50% at 50% 42%, ${accent}22, transparent 70%)` }} />
      {/* герой-фото */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 300 }}>
        <Img src={item.photo} style={{ maxWidth: '94%', maxHeight: '60%', objectFit: 'contain', filter: `blur(${blur}px)`, transform: `translateX(${shake}px) scale(${zoom * interpolate(reveal, [0, 1], [0.88, 1])}) rotate(${rot}deg)`, borderRadius: 16, boxShadow: '0 30px 90px rgba(0,0,0,.7)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, transparent 46%, rgba(13,13,13,0.95) 100%)' }} />

      {/* подпись: модель + название + цена ЭТОЙ запчасти */}
      <div style={{ position: 'absolute', left: 50, right: 50, bottom: 150, textAlign: 'center' }}>
        {item.fits ? (
          <div style={{ display: 'inline-block', transform: `translateX(${interpolate(chip, [0, 1], [-60, 0])}px)`, opacity: chip, fontFamily: FONT, fontWeight: 700, fontSize: 34, color: accent, border: `2px solid ${accent}`, borderRadius: 100, padding: '8px 26px', marginBottom: 18, letterSpacing: 1 }}>{item.fits}</div>
        ) : null}
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 64, color: '#fff', lineHeight: 1.08, textShadow: '0 3px 18px rgba(0,0,0,.9)', transform: `scale(${interpolate(name, [0, 1], [1.35, 1])})`, opacity: name }}>{item.name}</div>
        {item.price ? (
          <div style={{ display: 'inline-block', marginTop: 18, transform: `scale(${interpolate(price, [0, 1], [0.4, 1])})`, opacity: Math.min(1, price * 1.4), fontFamily: FONT, fontWeight: 700, fontSize: 60, color: theme.bg, background: accent, padding: '14px 40px', borderRadius: 16, boxShadow: `0 10px 40px ${accent}88` }}>{item.price}</div>
        ) : null}
      </div>
      <FlashCut accent={accent} />
    </AbsoluteFill>
  );
};

const IntroHook: React.FC<{ hook: string; accent: string }> = ({ hook, accent }) => {
  const f = useCurrentFrame();
  const words = hook.split(' ');
  const out = interpolate(f, [INTRO - 6, INTRO], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ background: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 70, opacity: out }}>
      <div style={{ textAlign: 'center', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
        {words.map((w, i) => {
          const s = spring({ frame: f - i * 4, fps: FPS, config: { damping: 11, stiffness: 220 } });
          return <span key={i} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 100, color: i % 2 ? accent : '#fff', lineHeight: 1.02, transform: `scale(${interpolate(s, [0, 1], [0.3, 1])}) translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s, textShadow: `0 0 40px ${accent}` }}>{w}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ cta: string; channel: string; accent: string }> = ({ cta, channel, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 12 } });
  const pulse = 1 + Math.sin(f / 5) * 0.03;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 35%, ${accent}44 -20%, ${theme.bg2} 50%, ${theme.bg} 100%)`, justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 60, color: '#fff', marginBottom: 30, opacity: s }}>
        <span>LEGAL</span><span style={{ color: accent }}>AUTO</span> <span style={{ color: '#A6A6A6', fontSize: 42 }}>PARTS</span>
      </div>
      <div style={{ transform: `scale(${s * pulse})`, opacity: s, fontFamily: FONT, fontWeight: 700, fontSize: 54, color: theme.bg, background: accent, padding: '30px 54px', borderRadius: 26, lineHeight: 1.2, boxShadow: `0 14px 50px ${accent}aa` }}>{cta}</div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 48, color: accent, marginTop: 32 }}>{channel}</div>
    </AbsoluteFill>
  );
};

export const ProductShort: React.FC<ProductProps> = (p) => {
  ensureFonts();
  const { durationInFrames } = useVideoConfig();
  const f = useCurrentFrame();
  const items = (p.items || []).filter(i => i && i.photo).slice(0, 6);
  const n = items.length || 1;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.6} /> : null}

      <Sequence durationInFrames={INTRO + 4}><IntroHook hook={p.hook} accent={p.accent} /></Sequence>

      {items.map((it, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER + 4}>
          <PartScene item={it} accent={p.accent} />
        </Sequence>
      ))}

      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}><Outro cta={p.cta} channel={p.channel} accent={p.accent} /></Sequence>

      <Wm accent={p.accent} />
      <ProgressBar p={f / durationInFrames} accent={p.accent} />
      <Grade />
    </AbsoluteFill>
  );
};

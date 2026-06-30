import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type Item = { photo: string; name: string; price?: string };
export type ProductProps = {
  items: Item[];
  hook: string;
  cta: string;
  channel: string;
  accent: string;
  musicFile?: string;
};

const FPS = 30;
const INTRO = 54;   // 1.8с хук
const PER = 78;     // 2.6с на запчасть
const OUTRO = 84;   // 2.8с финал

export const productDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;

const Wm: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ position: 'absolute', top: 54, left: 54, fontFamily: FONT, fontWeight: 700, fontSize: 38, textShadow: '0 2px 14px rgba(0,0,0,.8)', zIndex: 5 }}>
    <span style={{ color: '#fff' }}>LEGAL</span><span style={{ color: accent }}>AUTO</span>
    <span style={{ color: '#A6A6A6', fontSize: 26, marginLeft: 10 }}>PARTS</span>
  </div>
);

// Сцена ОДНОЙ запчасти: её фото + её название + её цена (синхронно)
const PartScene: React.FC<{ item: Item; accent: string; index: number; total: number }> = ({ item, accent, index, total }) => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, PER], [1.04, 1.14], { extrapolateRight: 'clamp' });
  const inAnim = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 130 } });
  const out = interpolate(f, [PER - 10, PER], [1, 0], { extrapolateLeft: 'clamp' });
  const capY = interpolate(inAnim, [0, 1], [60, 0]);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {/* размытая подложка */}
      <Img src={item.photo} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(32px) brightness(0.4)', transform: 'scale(1.2)' }} />
      {/* фото целиком */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 220 }}>
        <Img src={item.photo} style={{ maxWidth: '92%', maxHeight: '64%', objectFit: 'contain', transform: `scale(${zoom * interpolate(inAnim, [0, 1], [0.92, 1])})`, borderRadius: 18, boxShadow: '0 24px 80px rgba(0,0,0,.6)' }} />
      </AbsoluteFill>
      {/* затемнение снизу */}
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(13,13,13,0.92) 100%)' }} />
      {/* прогресс-точки */}
      <div style={{ position: 'absolute', top: 60, right: 54, display: 'flex', gap: 8, zIndex: 5 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: 22, height: 6, borderRadius: 3, background: i <= index ? accent : 'rgba(255,255,255,0.3)' }} />
        ))}
      </div>
      {/* ПОДПИСЬ — название и цена ЭТОЙ запчасти */}
      <div style={{ position: 'absolute', left: 54, right: 54, bottom: 150, transform: `translateY(${capY}px)`, opacity: inAnim, textAlign: 'center' }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 62, color: '#fff', lineHeight: 1.1, textShadow: '0 2px 16px rgba(0,0,0,.8)' }}>{item.name}</div>
        {item.price ? (
          <div style={{ display: 'inline-block', marginTop: 18, fontFamily: FONT, fontWeight: 700, fontSize: 54, color: theme.bg, background: accent, padding: '12px 34px', borderRadius: 16 }}>{item.price}</div>
        ) : null}
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
      <Wm accent={p.accent} />

      {/* Хук */}
      <Sequence durationInFrames={INTRO + 6}>
        <IntroHook hook={p.hook} accent={p.accent} />
      </Sequence>

      {/* Запчасти — каждая со своим названием и ценой */}
      {items.map((it, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER + 6}>
          <PartScene item={it} accent={p.accent} index={i} total={n} />
        </Sequence>
      ))}

      {/* Финал */}
      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}>
        <Outro cta={p.cta} channel={p.channel} accent={p.accent} />
      </Sequence>
    </AbsoluteFill>
  );
};

const IntroHook: React.FC<{ hook: string; accent: string }> = ({ hook, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 13, stiffness: 110 } });
  const out = interpolate(f, [INTRO - 8, INTRO], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ background: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 70, opacity: out }}>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`, opacity: s, textAlign: 'center' }}>
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 96, color: '#fff', lineHeight: 1.05, textShadow: `0 0 36px ${accent}` }}>{hook}</span>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ cta: string; channel: string; accent: string }> = ({ cta, channel, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 35%, ${accent}33 -20%, ${theme.bg2} 50%, ${theme.bg} 100%)`, justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 58, color: '#fff', marginBottom: 28, opacity: s }}>
        <span>LEGAL</span><span style={{ color: accent }}>AUTO</span> <span style={{ color: '#A6A6A6', fontSize: 40 }}>PARTS</span>
      </div>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.85, 1])})`, opacity: s, fontFamily: FONT, fontWeight: 700, fontSize: 52, color: theme.bg, background: accent, padding: '28px 50px', borderRadius: 24, lineHeight: 1.2 }}>{cta}</div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 46, color: accent, marginTop: 30 }}>{channel}</div>
    </AbsoluteFill>
  );
};

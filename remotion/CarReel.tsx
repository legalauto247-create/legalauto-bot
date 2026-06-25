import React from 'react';
import {
  AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig,
  interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts, ReelProps } from './theme';

const INTRO = 55;
const PHOTO = 68;
const PRICE = 72;
const CTA = 50;

export const reelDuration = (photoCount: number) =>
  INTRO + PHOTO * Math.max(1, photoCount) + PRICE + CTA;

const fade = (frame: number, dur: number, fadeLen = 12) =>
  interpolate(frame, [0, fadeLen, dur - fadeLen, dur], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

// Фото целиком (contain) поверх размытой подложки (cover) — без растяжки
const PhotoFill: React.FC<{ src: string; frame: number }> = ({ src, frame }) => {
  const zoom = interpolate(frame, [0, PHOTO], [1.06, 1.15], { extrapolateRight: 'clamp' });
  const drift = interpolate(frame, [0, PHOTO], [-14, 14]);
  return (
    <AbsoluteFill>
      <AbsoluteFill>
        <Img src={src} style={{
          width: '100%', height: '100%', objectFit: 'cover',
          filter: 'blur(38px) brightness(0.45) saturate(1.1)',
          transform: `scale(${1.25 * zoom})`,
        }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Img src={src} style={{
          maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
          transform: `scale(${zoom}) translateY(${drift}px)`,
          boxShadow: '0 30px 90px rgba(0,0,0,0.55)',
        }} />
      </AbsoluteFill>
      <AbsoluteFill style={{
        background: 'linear-gradient(to bottom, rgba(7,11,18,0.55) 0%, rgba(7,11,18,0) 22%, rgba(7,11,18,0) 55%, rgba(7,11,18,0.92) 100%)',
      }} />
    </AbsoluteFill>
  );
};

const Watermark: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{
    position: 'absolute', top: 56, left: 56, fontFamily: FONT, fontWeight: 700,
    fontSize: 44, color: '#fff', letterSpacing: -1, textShadow: '0 2px 16px rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', gap: 0,
  }}>
    Legal<span style={{ color: accent }}>Auto</span>
  </div>
);

const Progress: React.FC<{ count: number; index: number }> = ({ count, index }) => (
  <div style={{ position: 'absolute', top: 56, right: 56, display: 'flex', gap: 8 }}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} style={{
        width: 26, height: 5, borderRadius: 3,
        background: i <= index ? '#fff' : 'rgba(255,255,255,0.35)',
      }} />
    ))}
  </div>
);

const Chip: React.FC<{ label: string; value: string; delay: number; accent: string }> = ({ label, value, delay, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
  return (
    <div style={{
      transform: `translateY(${interpolate(s, [0, 1], [26, 0])}px)`, opacity: s,
      background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.16)', borderRadius: 18,
      padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 22, color: accent, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: '#fff' }}>{value}</span>
    </div>
  );
};

const IntroScene: React.FC<{ p: ReelProps; accent: string; accent2: string }> = ({ p, accent, accent2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16, stiffness: 90 } });
  const y = interpolate(s, [0, 1], [60, 0]);
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(120% 80% at 50% 18%, ${accent2} -40%, ${theme.bg2} 45%, ${theme.bg} 100%)`,
      justifyContent: 'center', alignItems: 'center', padding: 90, textAlign: 'center',
    }}>
      <div style={{ transform: `translateY(${y}px)`, opacity: s }}>
        <div style={{
          display: 'inline-block', fontFamily: FONT, fontWeight: 700, fontSize: 30,
          color: '#fff', background: accent, padding: '14px 34px', borderRadius: 100,
          letterSpacing: 2, marginBottom: 50,
        }}>
          {p.kind === 'part' ? 'ЗАПЧАСТЬ В НАЛИЧИИ' : 'АВТО ПОД КЛЮЧ'}
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 120, color: '#fff', lineHeight: 1.02, letterSpacing: -2 }}>{p.brand}</div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 72, color: accent, lineHeight: 1.1, marginTop: 6 }}>{p.model}</div>
        {p.tagline ? <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: theme.muted, marginTop: 44, lineHeight: 1.3 }}>{p.tagline}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const PriceScene: React.FC<{ p: ReelProps; accent: string; accent2: string }> = ({ p, accent, accent2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 110 } });
  const scale = interpolate(s, [0, 1], [0.7, 1]);
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(120% 80% at 50% 70%, ${accent2} -50%, ${theme.bg2} 50%, ${theme.bg} 100%)`,
      justifyContent: 'center', alignItems: 'center', padding: 90, textAlign: 'center',
    }}>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 42, color: theme.muted, marginBottom: 18 }}>{p.priceLabel}</div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 128, color: '#fff', transform: `scale(${scale})`, letterSpacing: -2 }}>{p.price}</div>
      {p.location ? <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 38, color: accent, marginTop: 30 }}>{p.location}</div> : null}
    </AbsoluteFill>
  );
};

const CtaScene: React.FC<{ p: ReelProps; accent: string }> = ({ p, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: theme.bg, justifyContent: 'center', alignItems: 'center', padding: 90, textAlign: 'center' }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: '#fff', marginBottom: 50, opacity: s }}>
        Legal<span style={{ color: accent }}>Auto</span>
      </div>
      <div style={{
        transform: `scale(${interpolate(s, [0, 1], [0.85, 1])})`, opacity: s,
        fontFamily: FONT, fontWeight: 700, fontSize: 50, color: '#fff',
        background: accent, padding: '34px 56px', borderRadius: 28, lineHeight: 1.2,
      }}>{p.cta}</div>
    </AbsoluteFill>
  );
};

export const CarReel: React.FC<ReelProps> = (p) => {
  ensureFonts();
  const t = p.kind === 'part' ? theme.part : theme.car;
  const photos = (p.photos && p.photos.length ? p.photos : ['']).slice(0, 5);

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence durationInFrames={INTRO}>
        <AbsoluteFill style={{ opacity: 1 }}>
          <IntroScene p={p} accent={t.accent} accent2={t.accent2} />
        </AbsoluteFill>
      </Sequence>

      {photos.map((src, i) => (
        <Sequence key={i} from={INTRO + i * PHOTO} durationInFrames={PHOTO}>
          <PhotoSceneWrap src={src} index={i} count={photos.length} p={p} accent={t.accent} />
        </Sequence>
      ))}

      <Sequence from={INTRO + photos.length * PHOTO} durationInFrames={PRICE}>
        <PriceScene p={p} accent={t.accent} accent2={t.accent2} />
      </Sequence>

      <Sequence from={INTRO + photos.length * PHOTO + PRICE} durationInFrames={CTA}>
        <CtaScene p={p} accent={t.accent} />
      </Sequence>
    </AbsoluteFill>
  );
};

const PhotoSceneWrap: React.FC<{ src: string; index: number; count: number; p: ReelProps; accent: string }> = ({ src, index, count, p, accent }) => {
  const frame = useCurrentFrame();
  // спецификации распределяем по фото-сценам
  const perScene = Math.ceil(p.specs.length / count) || 1;
  const chips = p.specs.slice(index * perScene, index * perScene + perScene);
  return (
    <AbsoluteFill style={{ opacity: fade(frame, PHOTO) }}>
      {src ? <PhotoFill src={src} frame={frame} /> : <AbsoluteFill style={{ background: theme.bg2 }} />}
      <Watermark accent={accent} />
      <Progress count={count} index={index} />
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 90 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: '#fff', marginBottom: 22, textShadow: '0 2px 18px rgba(0,0,0,0.7)' }}>
          {p.brand} {p.model}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {chips.map((c, j) => <Chip key={j} label={c.label} value={c.value} delay={10 + j * 7} accent={accent} />)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

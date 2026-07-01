import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type CineScene = { image: string; kicker?: string; title: string; text?: string };
export type CineProps = {
  brandLine: string;
  heroImage?: string;
  hook: string;
  tagline: string;
  scenes: CineScene[];
  cta: string;
  channel: string;
  groupUrl?: string;
  accent: string;
  musicFile?: string;
};

const FPS = 30;
const INTRO = 60;
const PER = 96;
const OUTRO = 84;
const TR = 20;   // окно кроссфейда

export const cineDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const Shield: React.FC<{ accent: string; size?: number }> = ({ accent, size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={accent} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={accent} textAnchor="middle">LA</text>
  </svg>
);

// Full-bleed кино-кадр с Ken Burns
const KenBurns: React.FC<{ image: string; dur: number; dir?: number }> = ({ image, dur, dir = 1 }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, dur], [1.08, 1.22]);
  const panX = interpolate(f, [0, dur], [0, 26 * dir]);
  const panY = interpolate(f, [0, dur], [0, -18]);
  const src = /^https?:/.test(image) ? image : staticFile(image);
  return <Img src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translate(${panX}px, ${panY}px)` }} />;
};

const Kinetic: React.FC<{ text: string; style: React.CSSProperties; delay?: number }> = ({ text, style, delay = 0 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ ...style, display: 'flex', flexWrap: 'wrap' }}>
      {text.split(' ').map((w, i) => {
        const s = spring({ frame: f - delay - i * 3, fps: FPS, config: { damping: 16, stiffness: 110 } });
        return <span key={i} style={{ display: 'inline-block', opacity: s, transform: `translateY(${interpolate(s, [0, 1], [26, 0])}px)`, marginRight: 14 }}>{w}</span>;
      })}
    </div>
  );
};

const BrandHeader: React.FC<{ accent: string; brandLine: string }> = ({ accent, brandLine }) => (
  <div style={{ position: 'absolute', top: 48, left: 52, right: 52, display: 'flex', alignItems: 'center', gap: 14, zIndex: 8 }}>
    <Shield accent={accent} size={48} />
    <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 30, letterSpacing: 1, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.8)' }}>{brandLine}</div>
    <div style={{ flex: 1, height: 2, marginLeft: 6, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
  </div>
);

const Scene: React.FC<{ s: CineScene; idx: number; accent: string; channel: string; groupUrl?: string; brandLine: string }> = ({ s, idx, accent, channel, groupUrl, brandLine }) => {
  const f = useCurrentFrame();
  const inOp = interpolate(f, [0, TR], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const outOp = interpolate(f, [PER, PER + TR], [1, 0], { extrapolateLeft: 'clamp', easing: ease });
  const opacity = Math.min(inOp, outOp);
  const barW = interpolate(f, [6, 40], [0, 100], { extrapolateRight: 'clamp', easing: ease });

  return (
    <AbsoluteFill style={{ opacity }}>
      <KenBurns image={s.image} dur={PER + TR} dir={idx % 2 === 0 ? 1 : -1} />
      {/* кино-скрим снизу для читаемости текста */}
      <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(6,6,8,0.45) 0%, transparent 26%, transparent 44%, rgba(6,6,8,0.72) 78%, rgba(6,6,8,0.94) 100%)` }} />
      {/* лёгкая цветовая подсветка бренда */}
      <AbsoluteFill style={{ background: `radial-gradient(80% 50% at 50% 100%, ${accent}22 0%, transparent 60%)`, mixBlendMode: 'screen' }} />

      <BrandHeader accent={accent} brandLine={brandLine} />

      {/* текстовый блок снизу */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 150 }}>
        {s.kicker ? (
          <div style={{ display: 'inline-block', fontFamily: FONT, fontWeight: 700, fontSize: 26, letterSpacing: 2, color: '#0b0b0d', background: accent, padding: '8px 20px', borderRadius: 10, marginBottom: 22, opacity: interpolate(f, [2, 16], [0, 1], { extrapolateRight: 'clamp' }) }}>{s.kicker}</div>
        ) : null}
        <Kinetic text={s.title} delay={6} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 74, color: '#fff', lineHeight: 1.08, textShadow: '0 3px 22px rgba(0,0,0,.85)' }} />
        {s.text ? <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 40, color: '#e3e6ea', lineHeight: 1.3, marginTop: 20, textShadow: '0 2px 14px rgba(0,0,0,.9)', opacity: interpolate(f, [18, 34], [0, 1], { extrapolateRight: 'clamp' }) }}>{s.text}</div> : null}
        {/* прогресс-акцент */}
        <div style={{ height: 4, marginTop: 30, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }}>
          <div style={{ height: '100%', width: `${barW}%`, borderRadius: 2, background: accent, boxShadow: `0 0 14px ${accent}` }} />
        </div>
      </div>

      {/* футер */}
      <div style={{ position: 'absolute', left: 56, right: 56, bottom: 54, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT }}>
        <div style={{ fontWeight: 700, fontSize: 30, color: accent, textShadow: '0 2px 10px rgba(0,0,0,.8)' }}>{channel}</div>
        {groupUrl ? <div style={{ fontWeight: 400, fontSize: 24, color: '#cfd4da', textShadow: '0 2px 10px rgba(0,0,0,.8)' }}>{groupUrl}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const Intro: React.FC<{ heroImage?: string; hook: string; tagline: string; accent: string; brandLine: string }> = ({ heroImage, hook, tagline, accent, brandLine }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 80 } });
  const out = interpolate(f, [INTRO - 10, INTRO], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {heroImage ? <KenBurns image={heroImage} dur={INTRO + TR} /> : <AbsoluteFill style={{ background: theme.bg }} />}
      <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(6,6,8,0.55), rgba(6,6,8,0.35) 40%, rgba(6,6,8,0.9))` }} />
      <AbsoluteFill style={{ background: `radial-gradient(70% 50% at 50% 55%, ${accent}22, transparent 60%)`, mixBlendMode: 'screen' }} />
      <BrandHeader accent={accent} brandLine={brandLine} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 72, textAlign: 'center' }}>
        <div style={{ transform: `translateY(${interpolate(s, [0, 1], [44, 0])}px)`, opacity: s }}>
          <Shield accent={accent} size={110} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 90, color: '#fff', lineHeight: 1.05, marginTop: 30, textShadow: `0 4px 30px rgba(0,0,0,.9)` }}>{hook}</div>
          <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 42, color: accent, marginTop: 22, textShadow: '0 2px 14px rgba(0,0,0,.8)' }}>{tagline}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ heroImage?: string; cta: string; channel: string; groupUrl?: string; accent: string; brandLine: string }> = ({ heroImage, cta, channel, groupUrl, accent, brandLine }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 14 } });
  return (
    <AbsoluteFill>
      {heroImage ? <KenBurns image={heroImage} dur={OUTRO} dir={-1} /> : <AbsoluteFill style={{ background: theme.bg }} />}
      <AbsoluteFill style={{ background: 'rgba(6,6,8,0.72)' }} />
      <AbsoluteFill style={{ background: `radial-gradient(70% 50% at 50% 50%, ${accent}2e, transparent 62%)`, mixBlendMode: 'screen' }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 72, textAlign: 'center' }}>
        <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)` }}>
          <Shield accent={accent} size={120} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 58, color: '#fff', margin: '28px 0 24px', lineHeight: 1.12, textShadow: '0 3px 20px rgba(0,0,0,.9)' }}>{cta}</div>
          <div style={{ display: 'inline-block', fontFamily: FONT, fontWeight: 700, fontSize: 50, color: theme.bg, background: accent, padding: '22px 48px', borderRadius: 20, boxShadow: `0 12px 40px ${accent}55` }}>{channel}</div>
          {groupUrl ? <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 34, color: accent, marginTop: 24 }}>{groupUrl}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CinematicShort: React.FC<CineProps> = (p) => {
  ensureFonts();
  const scenes = (p.scenes || []).filter(s => s && s.image && s.title).slice(0, 6);
  const n = scenes.length || 1;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.5} /> : null}

      <Sequence durationInFrames={INTRO + TR}><Intro heroImage={p.heroImage} hook={p.hook} tagline={p.tagline} accent={p.accent} brandLine={p.brandLine} /></Sequence>

      {scenes.map((s, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER + TR}>
          <Scene s={s} idx={i} accent={p.accent} channel={p.channel} groupUrl={p.groupUrl} brandLine={p.brandLine} />
        </Sequence>
      ))}

      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}><Outro heroImage={p.heroImage} cta={p.cta} channel={p.channel} groupUrl={p.groupUrl} accent={p.accent} brandLine={p.brandLine} /></Sequence>
    </AbsoluteFill>
  );
};

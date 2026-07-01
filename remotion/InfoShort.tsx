import React from 'react';
import {
  AbsoluteFill, Audio, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type InfoPoint = { icon?: string; title: string; text?: string };
export type InfoProps = {
  brandLine: string;     // «LEGAL AUTO • ДОКУМЕНТЫ»
  hook: string;          // крупный хук на интро
  tagline: string;       // подзаголовок интро
  points: InfoPoint[];
  cta: string;
  channel: string;       // @LegalAuto24
  groupUrl?: string;     // t.me/LegalAuto24
  accent: string;
  musicFile?: string;
};

const FPS = 30;
const INTRO = 54;
const PER = 90;
const OUTRO = 84;
const TR = 16;

export const infoDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const Shield: React.FC<{ accent: string; size?: number }> = ({ accent, size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={accent} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={accent} textAnchor="middle">LA</text>
  </svg>
);

// Частицы/бокэ — детерминированные
const Particles: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  const { height } = useVideoConfig();
  const dots = [];
  for (let i = 0; i < 20; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const rx = seed / 233280;
    const ry = ((seed * 7 + 13) % 233280) / 233280;
    const size = 4 + rx * 13;
    const speed = 0.25 + ry * 0.7;
    const x = rx * 100;
    const y = ((ry * height - f * speed * 3) % (height + 120) + height + 120) % (height + 120) - 60;
    const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(f * 0.05 + i));
    const acc = i % 3 === 0;
    dots.push(<div key={i} style={{ position: 'absolute', left: `${x}%`, top: y, width: size, height: size, borderRadius: '50%', background: acc ? accent : '#fff', opacity: tw * (acc ? 0.5 : 0.28), filter: `blur(${size > 11 ? 3 : 1}px)`, boxShadow: acc ? `0 0 12px ${accent}` : '0 0 8px #fff' }} />);
  }
  return <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>{dots}</AbsoluteFill>;
};

// Волновой фон на CSS — адаптируется под цвет направления (без картинки)
const Bg: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const drift = interpolate(f, [0, durationInFrames], [0, 120]);
  const sweep = ((f * 1.5) % 170) - 35;
  const y1 = height * 0.28 + Math.sin(f * 0.03) * 24;
  const y2 = height * 0.62 + Math.cos(f * 0.025) * 30;
  const y3 = height * 0.86 + Math.sin(f * 0.02 + 1) * 20;
  const wave = (y: number, o: number) =>
    `M0 ${y} C ${width * 0.3} ${y - 90}, ${width * 0.7} ${y + 90}, ${width} ${y} L ${width} ${height} L 0 ${height} Z`;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 0%, #14110c 0%, #0A0906 60%, #060504 100%)' }}>
      {/* большие мягкие свечения акцента */}
      <div style={{ position: 'absolute', top: -120 + Math.sin(f * 0.02) * 30, left: -140, width: 620, height: 620, borderRadius: '50%', background: `radial-gradient(circle, ${accent}33 0%, transparent 65%)`, filter: 'blur(40px)' }} />
      <div style={{ position: 'absolute', bottom: -160, right: -160 + Math.cos(f * 0.02) * 30, width: 700, height: 700, borderRadius: '50%', background: `radial-gradient(circle, ${accent}2b 0%, transparent 65%)`, filter: 'blur(50px)' }} />
      {/* волновые линии как в шаблоне */}
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
        <path d={wave(y1, 0)} fill={`${accent}12`} />
        <path d={wave(y2, 0)} fill={`${accent}0e`} />
        <path d={wave(y3, 0)} fill={`${accent}1a`} />
        <path d={`M0 ${y1} C ${width * 0.3} ${y1 - 90}, ${width * 0.7} ${y1 + 90}, ${width} ${y1}`} fill="none" stroke={accent} strokeWidth="2.5" opacity="0.35" />
        <path d={`M0 ${y2} C ${width * 0.3} ${y2 - 90}, ${width * 0.7} ${y2 + 90}, ${width} ${y2}`} fill="none" stroke={accent} strokeWidth="2" opacity="0.25" />
      </svg>
      <AbsoluteFill style={{ opacity: 0.05, backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0 2px, transparent 2px 28px)`, transform: `translateX(${drift}px)` }} />
      <Particles accent={accent} />
      <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent ${sweep - 20}%, ${accent}22 ${sweep}%, transparent ${sweep + 20}%)`, mixBlendMode: 'screen' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(6,5,4,0.5) 0%, rgba(6,5,4,0.12) 40%, rgba(6,5,4,0.8) 100%)' }} />
    </AbsoluteFill>
  );
};

const Header: React.FC<{ accent: string; brandLine: string }> = ({ accent, brandLine }) => (
  <div style={{ position: 'absolute', top: 50, left: 56, right: 56, zIndex: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <Shield accent={accent} size={56} />
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, letterSpacing: 0.5, color: '#fff' }}>{brandLine}</div>
    </div>
    <div style={{ height: 2, marginTop: 14, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
  </div>
);

const Footer: React.FC<{ accent: string; channel: string; groupUrl?: string }> = ({ accent, channel, groupUrl }) => (
  <div style={{ position: 'absolute', left: 56, right: 56, bottom: 46, zIndex: 6, textAlign: 'center', fontFamily: FONT }}>
    <div style={{ height: 2, marginBottom: 18, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
    <div style={{ fontSize: 34, fontWeight: 700, color: accent }}>{channel}</div>
    {groupUrl ? <div style={{ fontSize: 24, color: '#aeb6bf', marginTop: 4 }}>{groupUrl}</div> : null}
  </div>
);

const Kinetic: React.FC<{ text: string; style: React.CSSProperties; delay?: number }> = ({ text, style, delay = 0 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ ...style, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
      {text.split('').map((ch, i) => {
        const s = spring({ frame: f - delay - i * 1.0, fps: FPS, config: { damping: 16, stiffness: 120 } });
        return <span key={i} style={{ display: 'inline-block', opacity: s, transform: `translateY(${interpolate(s, [0, 1], [22, 0])}px)`, whiteSpace: 'pre' }}>{ch}</span>;
      })}
    </div>
  );
};

const PointScene: React.FC<{ p: InfoPoint; idx: number; total: number; accent: string }> = ({ p, idx, total, accent }) => {
  const f = useCurrentFrame();
  const enter = interpolate(f, [0, TR], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const exit = interpolate(f, [PER - TR, PER], [1, 0], { extrapolateLeft: 'clamp', easing: ease });
  const opacity = Math.min(enter, exit);
  const shiftX = interpolate(f, [0, TR], [70, 0], { extrapolateRight: 'clamp', easing: ease })
    + interpolate(f, [PER - TR, PER], [0, -70], { extrapolateLeft: 'clamp', easing: ease });
  const s = spring({ frame: f, fps: FPS, config: { damping: 20, stiffness: 90 } });
  const ring = spring({ frame: f - 4, fps: FPS, config: { damping: 14, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ opacity, transform: `translateX(${shiftX}px)`, justifyContent: 'center', alignItems: 'center', padding: 70 }}>
      {/* номер шага */}
      <div style={{ position: 'absolute', top: 250, fontFamily: FONT, fontWeight: 700, fontSize: 28, letterSpacing: 3, color: accent, opacity: s }}>
        ШАГ {idx + 1} / {total}
      </div>

      {/* большая иконка в кольце */}
      <div style={{ width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)', border: `3px solid ${accent}`, boxShadow: `0 0 60px ${accent}55, inset 0 0 40px ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 110, transform: `scale(${interpolate(ring, [0, 1], [0.6, 1])})`, opacity: ring, marginBottom: 50 }}>
        {p.icon || '✅'}
      </div>

      {/* заголовок + текст в стеклянной панели */}
      <div style={{ width: '100%', maxWidth: 900, textAlign: 'center', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 30, padding: '38px 40px', transform: `translateY(${interpolate(s, [0, 1], [34, 0])}px)`, opacity: s }}>
        <Kinetic text={p.title} delay={6} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 62, color: '#fff', lineHeight: 1.12, textShadow: '0 2px 14px rgba(0,0,0,.6)' }} />
        {p.text ? <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 40, color: '#c7ccd2', lineHeight: 1.28, marginTop: 22 }}>{p.text}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const IntroHook: React.FC<{ hook: string; tagline: string; accent: string }> = ({ hook, tagline, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 80 } });
  const out = interpolate(f, [INTRO - 8, INTRO], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, opacity: out }}>
      <div style={{ transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s, textAlign: 'center' }}>
        <Shield accent={accent} size={120} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 82, color: '#fff', lineHeight: 1.06, marginTop: 36, textShadow: `0 0 30px ${accent}55` }}>{hook}</div>
        <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 40, color: accent, marginTop: 24 }}>{tagline}</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ cta: string; channel: string; groupUrl?: string; accent: string }> = ({ cta, channel, groupUrl, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
      <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)` }}>
        <Shield accent={accent} size={116} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: '#fff', margin: '28px 0 22px', lineHeight: 1.15 }}>{cta}</div>
        <div style={{ display: 'inline-block', fontFamily: FONT, fontWeight: 700, fontSize: 46, color: theme.bg, background: accent, padding: '22px 46px', borderRadius: 20 }}>{channel}</div>
        {groupUrl ? <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 32, color: accent, marginTop: 24 }}>{groupUrl}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

export const InfoShort: React.FC<InfoProps> = (p) => {
  ensureFonts();
  const points = (p.points || []).filter(x => x && x.title).slice(0, 6);
  const n = points.length || 1;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.5} /> : null}
      <Bg accent={p.accent} />

      <Sequence durationInFrames={INTRO + 4}><IntroHook hook={p.hook} tagline={p.tagline} accent={p.accent} /></Sequence>

      <Sequence from={INTRO} durationInFrames={PER * n}>
        <Header accent={p.accent} brandLine={p.brandLine} />
        <Footer accent={p.accent} channel={p.channel} groupUrl={p.groupUrl} />
      </Sequence>

      {points.map((pt, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER}>
          <PointScene p={pt} idx={i} total={n} accent={p.accent} />
        </Sequence>
      ))}

      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}><Outro cta={p.cta} channel={p.channel} groupUrl={p.groupUrl} accent={p.accent} /></Sequence>
    </AbsoluteFill>
  );
};

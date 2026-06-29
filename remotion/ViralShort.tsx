import React from 'react';
import {
  AbsoluteFill, OffthreadVideo, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type ViralProps = {
  soraFile: string;        // имя файла в public (Sora-клип)
  musicFile?: string;      // имя трека в public
  accent: string;
  hook: string;            // хук-фраза
  facts: string[];         // факты-субтитры
  cta: string;
  channel: string;
  photo?: string;          // финальное реальное фото (url)
};

const SORA_SEC = 12;
const OUTRO_SEC = 6;
const FPS = 30;
export const viralDuration = () => (SORA_SEC + OUTRO_SEC) * FPS;

const Watermark: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ position: 'absolute', top: 56, left: 56, fontFamily: FONT, fontWeight: 700, fontSize: 40, textShadow: '0 2px 14px rgba(0,0,0,.7)' }}>
    <span style={{ color: '#fff' }}>LEGAL</span><span style={{ color: accent }}>AUTO</span>
  </div>
);

const HookText: React.FC<{ hook: string; accent: string }> = ({ hook, accent }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 90 } });
  return (
    <div style={{
      position: 'absolute', top: 150, left: 56, right: 56, textAlign: 'center',
      transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s,
    }}>
      <span style={{
        fontFamily: FONT, fontWeight: 700, fontSize: 78, color: '#fff', lineHeight: 1.05,
        background: 'rgba(13,13,13,0.5)', padding: '8px 16px', borderRadius: 14,
        boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
        textShadow: `0 0 24px ${accent}`,
      }}>{hook}</span>
    </div>
  );
};

const Caption: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16 } });
  return (
    <div style={{ position: 'absolute', bottom: 220, left: 56, right: 56, textAlign: 'center', opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})` }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: '#fff', background: accent, padding: '14px 26px', borderRadius: 16, lineHeight: 1.3, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>{text}</span>
    </div>
  );
};

export const ViralShort: React.FC<ViralProps> = (p) => {
  ensureFonts();
  const total = viralDuration();
  const soraFrames = SORA_SEC * FPS;
  const factDur = Math.floor((soraFrames - 60) / Math.max(1, p.facts.length));

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.6} /> : null}

      {/* Сора-сцена с оверлеями */}
      <Sequence durationInFrames={soraFrames}>
        <AbsoluteFill>
          <OffthreadVideo src={staticFile(p.soraFile)} muted={!!p.musicFile} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(13,13,13,0.45) 0%, transparent 25%, transparent 55%, rgba(13,13,13,0.85) 100%)' }} />
          <Watermark accent={p.accent} />
          <Sequence durationInFrames={90}><HookText hook={p.hook} accent={p.accent} /></Sequence>
          {p.facts.map((t, i) => (
            <Sequence key={i} from={90 + i * factDur} durationInFrames={factDur}><Caption text={t} accent={p.accent} /></Sequence>
          ))}
        </AbsoluteFill>
      </Sequence>

      {/* Аутро: CTA + канал + фото */}
      <Sequence from={soraFrames} durationInFrames={OUTRO_SEC * FPS}>
        <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 30%, ${p.accent}33 -20%, ${theme.bg2} 50%, ${theme.bg} 100%)`, justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
          {p.photo ? <Img src={p.photo} style={{ width: 520, height: 520, objectFit: 'cover', borderRadius: 24, border: `2px solid ${p.accent}`, marginBottom: 50 }} /> : null}
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: '#fff', marginBottom: 30 }}>
            <span>LEGAL</span><span style={{ color: p.accent }}>AUTO</span>
          </div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 50, color: theme.bg, background: p.accent, padding: '28px 48px', borderRadius: 24, lineHeight: 1.2 }}>{p.cta}</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 44, color: p.accent, marginTop: 30 }}>{p.channel}</div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

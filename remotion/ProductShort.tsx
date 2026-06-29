import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type ProductProps = {
  photos: string[];
  hook: string;
  captions: string[];     // фразы озвучки = субтитры
  cta: string;
  channel: string;
  accent: string;
  voiceFile?: string;     // имя в public
  musicFile?: string;
  voiceSec: number;       // длительность озвучки
};

const FPS = 30;
const OUTRO_SEC = 2.6;

// Фото целиком на размытой подложке + панч-зум
const PhotoPunch: React.FC<{ src: string; dur: number }> = ({ src, dur }) => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, dur], [1.06, 1.18], { extrapolateRight: 'clamp' });
  const punch = spring({ frame: f, fps: FPS, config: { damping: 12, stiffness: 200 } });
  const scale = zoom * interpolate(punch, [0, 1], [1.08, 1]);
  return (
    <AbsoluteFill>
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(34px) brightness(0.45)', transform: 'scale(1.2)' }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Img src={src} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${scale})` }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f, fps: FPS, config: { damping: 13, stiffness: 160 } });
  return (
    <div style={{ position: 'absolute', bottom: 260, left: 50, right: 50, textAlign: 'center', transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, opacity: s }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 60, color: '#fff', background: accent, padding: '14px 26px', borderRadius: 16, lineHeight: 1.35, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>{text}</span>
    </div>
  );
};

export const productDuration = (voiceSec: number) => Math.round((voiceSec + OUTRO_SEC) * FPS);

export const ProductShort: React.FC<ProductProps> = (p) => {
  ensureFonts();
  const voiceFrames = Math.round(p.voiceSec * FPS);
  const photos = (p.photos || []).filter(Boolean);
  const perPhoto = Math.max(45, Math.floor(voiceFrames / Math.max(1, photos.length)));
  const caps = p.captions || [];
  const perCap = Math.max(30, Math.floor(voiceFrames / Math.max(1, caps.length)));

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {p.voiceFile ? <Audio src={staticFile(p.voiceFile)} /> : null}
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.22} /> : null}

      {/* Фото-сцены с панчами */}
      {photos.map((src, i) => (
        <Sequence key={i} from={i * perPhoto} durationInFrames={perPhoto + 8}>
          <PhotoPunch src={src} dur={perPhoto} />
        </Sequence>
      ))}

      {/* Затемнение снизу для читаемости */}
      <Sequence durationInFrames={voiceFrames}>
        <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(13,13,13,0.5) 0%, transparent 22%, transparent 55%, rgba(13,13,13,0.9) 100%)' }} />
        <div style={{ position: 'absolute', top: 56, left: 56, fontFamily: FONT, fontWeight: 700, fontSize: 40, textShadow: '0 2px 14px rgba(0,0,0,.7)' }}>
          <span style={{ color: '#fff' }}>LEGAL</span><span style={{ color: p.accent }}>AUTO</span>
        </div>
      </Sequence>

      {/* Хук — первые 2 сек крупно */}
      <Sequence durationInFrames={60}>
        <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 180 }}>
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 84, color: '#fff', textAlign: 'center', padding: '0 50px', textShadow: `0 0 26px ${p.accent}` }}>{p.hook}</span>
        </AbsoluteFill>
      </Sequence>

      {/* Субтитры в ритм озвучки */}
      {caps.map((t, i) => (
        <Sequence key={i} from={i * perCap} durationInFrames={perCap}>
          <Caption text={t} accent={p.accent} />
        </Sequence>
      ))}

      {/* Аутро CTA */}
      <Sequence from={voiceFrames} durationInFrames={Math.round(OUTRO_SEC * FPS)}>
        <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 35%, ${p.accent}33 -20%, ${theme.bg2} 50%, ${theme.bg} 100%)`, justifyContent: 'center', alignItems: 'center', padding: 80, textAlign: 'center' }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 58, color: '#fff', marginBottom: 30 }}>
            <span>LEGAL</span><span style={{ color: p.accent }}>AUTO</span>
          </div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: theme.bg, background: p.accent, padding: '28px 50px', borderRadius: 24, lineHeight: 1.2 }}>{p.cta}</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 46, color: p.accent, marginTop: 30 }}>{p.channel}</div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 6 — YouTube Shorts, 6 кадров / 30 секунд (1080x1920).
// 1 хук 0-3 → 2 мощь 3-6 → 3 комплектация 6-12 → 4 состояние 12-18 → 5 доверие 18-24 → 6 CTA 24-30.
export type StoreShortsProps = {
  brand: string; model: string; year?: string;
  hook: string;                 // «ПРЕМИУМ КОТОРЫЙ ВПЕЧАТЛЯЕТ»
  power: string;                // «3.0d / 400 л.с. · xDrive · Автомат»
  options: string[];            // 4-6 опций
  condition: string;            // «107 000 км · Обслужен от и до»
  trust: string[];              // 3-4 пункта доверия
  price?: string;               // «14 500 000 ₽» — показываем на финале
  photos: string[];             // фото авто из поста (URL)
  channel?: string;             // @LegalAutoStore
  musicFile?: string;
};

const FPS = 30;
const ACC = '#00D1C2';   // ЛИСТ 6: акцент бирюзой на ключевых словах
const GOLD = '#D4AF37';
const ease = Easing.bezier(0.22, 1, 0.36, 1);
// границы кадров (сек по эталону): 0-3, 3-6, 6-12, 12-18, 18-24, 24-30
const F = [0, 90, 180, 360, 540, 720, 900];
export const storeShortsDuration = () => 900;

const Shield: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke="#C0C0C0" strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill="#E6E9EC" textAnchor="middle">LA</text>
  </svg>
);

// Фото-фон кадра: Ken Burns, направление чередуется
const Photo: React.FC<{ src: string; dur: number; mode?: 'in' | 'pan' | 'out' }> = ({ src, dur, mode = 'in' }) => {
  const f = useCurrentFrame();
  // ЛИСТ 7: панч-въезд (snappy) → медленный дрейф. Удар в начале кадра = «эффект топ»
  const punch = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 120 } });
  const base = interpolate(punch, [0, 1], [1.32, 1.12]);
  const drift = interpolate(f, [0, dur], [0, mode === 'out' ? -0.05 : 0.07]);
  const panX = mode === 'pan' ? interpolate(f, [0, dur], [-34, 34]) : 0;
  const rot = interpolate(punch, [0, 1], [mode === 'out' ? -1.2 : 1.2, 0]);
  const url = /^https?:/.test(src) ? src : staticFile(src);
  return <Img src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${base + drift}) translateX(${panX}px) rotate(${rot}deg)` }} />;
};

// ЛИСТ 7: световой штрих (light streak) — проходит по кадру в начале сцены
const Sweep: React.FC<{ color?: string }> = ({ color = '#00D1C2' }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, 26], [-40, 140], { extrapolateRight: 'clamp' });
  const op = interpolate(f, [0, 6, 22, 30], [0, 0.9, 0.5, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${x - 14}%, ${color}55 ${x}%, transparent ${x + 14}%)`, mixBlendMode: 'screen', opacity: op }} />;
};

// золотые частицы-бокэ (премиум-атмосфера, ЛИСТ 7 bokeh)
const Gold: React.FC = () => {
  const f = useCurrentFrame();
  const dots = [];
  for (let i = 0; i < 14; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const rx = seed / 233280, ry = ((seed * 7 + 13) % 233280) / 233280;
    const size = 5 + rx * 12;
    const y = ((ry * 1920 - f * (0.4 + ry) * 2.4) % 2040 + 2040) % 2040 - 60;
    const tw = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(f * 0.06 + i * 1.7));
    dots.push(<div key={i} style={{ position: 'absolute', left: `${rx * 100}%`, top: y, width: size, height: size, borderRadius: '50%', background: i % 2 ? '#D4AF37' : '#F2E6B1', opacity: tw * 0.4, filter: `blur(${size > 10 ? 3 : 1}px)`, boxShadow: '0 0 12px #D4AF37' }} />);
  }
  return <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>{dots}</AbsoluteFill>;
};

// Скрим для читаемости + низовой градиент
const Scrim: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(10,10,10,0.42) 0%, transparent 30%, transparent 48%, rgba(10,10,10,0.78) 76%, rgba(10,10,10,0.95) 100%)' }} />
);

// Лого по эталону: низ кадра, отступ ≥5%
const LogoBottom: React.FC<{ line?: string }> = ({ line }) => (
  <div style={{ position: 'absolute', bottom: 96, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
    <Shield size={72} />
    {line ? <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 24, letterSpacing: 2, color: '#C8CDD2' }}>{line}</div> : null}
  </div>
);

const In: React.FC<{ children: React.ReactNode; delay?: number; y?: number }> = ({ children, delay = 0, y = 34 }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - delay, fps: FPS, config: { damping: 16, stiffness: 100 } });
  return <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [y, 0])}px)` }}>{children}</div>;
};

const H: React.FC<{ white: string; accent?: string; size?: number }> = ({ white, accent, size = 78 }) => (
  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.08, textTransform: 'uppercase', color: '#fff', textShadow: '0 4px 28px rgba(0,0,0,.9)' }}>
    {white}{accent ? <span style={{ color: ACC }}> {accent}</span> : null}
  </div>
);

const Check: React.FC<{ items: string[]; delay?: number }> = ({ items, delay = 8 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {items.map((t, i) => {
        const s = spring({ frame: f - delay - i * 5, fps: FPS, config: { damping: 15 } });
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: s, transform: `translateX(${interpolate(s, [0, 1], [30, 0])}px)` }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${ACC}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACC, fontWeight: 700, fontSize: 24, background: 'rgba(10,10,10,0.55)' }}>✓</div>
            <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 36, color: '#F0F2F4', textShadow: '0 2px 14px rgba(0,0,0,.9)' }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
};

export const StoreShorts: React.FC<StoreShortsProps> = (p) => {
  ensureFonts();
  const ph = (i: number) => (p.photos && p.photos.length ? p.photos[i % p.photos.length] : '');
  const carName = `${p.brand} ${p.model}`.trim();
  const channel = p.channel || '@LegalAutoStore';

  return (
    <AbsoluteFill style={{ background: '#0A0A0A' }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.55} /> : null}

      {/* 01 ХУК 0-3с: эмоц. заголовок + бейдж модели */}
      <Sequence durationInFrames={F[1]}>
        <Photo src={ph(0)} dur={F[1]} mode="in" /><Scrim /><Gold /><Sweep color="#D4AF37" />
        <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 200, textAlign: 'center', padding: '200px 70px 0' }}>
          <In><H white={p.hook} size={86} /></In>
          <In delay={8}>
            <div style={{ marginTop: 34, display: 'inline-flex', alignItems: 'center', gap: 12, border: `2px solid ${GOLD}`, borderRadius: 12, padding: '12px 26px', fontFamily: FONT, fontWeight: 700, fontSize: 34, color: '#fff', background: 'rgba(10,10,10,0.6)' }}>
              {carName}{p.year ? <span style={{ color: GOLD }}>{p.year}</span> : null}
            </div>
          </In>
        </AbsoluteFill>
        <LogoBottom line="LEGAL AUTO STORE" />
      </Sequence>

      {/* 02 МОЩЬ 3-6с */}
      <Sequence from={F[1]} durationInFrames={F[2] - F[1]}>
        <Photo src={ph(1)} dur={F[2] - F[1]} mode="pan" /><Scrim /><Gold /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '220px 70px 0', textAlign: 'center', alignItems: 'center' }}>
          <In><H white="МОЩЬ" size={92} /></In>
          <In delay={6}><div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: ACC, marginTop: 18, textShadow: '0 3px 20px rgba(0,0,0,.9)' }}>{p.power}</div></In>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 03 КОМПЛЕКТАЦИЯ 6-12с: чек-лист опций */}
      <Sequence from={F[2]} durationInFrames={F[3] - F[2]}>
        <Photo src={ph(2)} dur={F[3] - F[2]} mode="in" /><Scrim /><Gold /><Sweep />
        <AbsoluteFill style={{ padding: '190px 80px 0' }}>
          <In><H white="МАКСИМАЛЬНАЯ" accent="КОМПЛЕКТАЦИЯ" size={62} /></In>
          <div style={{ marginTop: 44 }}><Check items={(p.options || []).slice(0, 6)} /></div>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 04 СОСТОЯНИЕ 12-18с: крупный план */}
      <Sequence from={F[3]} durationInFrames={F[4] - F[3]}>
        <Photo src={ph(3)} dur={F[4] - F[3]} mode="out" /><Scrim /><Gold /><Sweep color="#D4AF37" />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '220px 70px 0', textAlign: 'center', alignItems: 'center' }}>
          <In><H white="ИДЕАЛЬНОЕ" accent="СОСТОЯНИЕ" size={72} /></In>
          <In delay={8}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 44, color: '#F0F2F4', marginTop: 22, textShadow: '0 3px 18px rgba(0,0,0,.9)' }}>{p.condition}</div></In>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 05 ДОВЕРИЕ 18-24с: чек-лист гарантий */}
      <Sequence from={F[4]} durationInFrames={F[5] - F[4]}>
        <Photo src={ph(4)} dur={F[5] - F[4]} mode="pan" /><Scrim /><Gold /><Sweep />
        <AbsoluteFill style={{ padding: '190px 80px 0' }}>
          <In><H white="ПРОВЕРЕН И ГОТОВ" accent="К НОВОМУ ВЛАДЕЛЬЦУ" size={58} /></In>
          <div style={{ marginTop: 44 }}><Check items={(p.trust || []).slice(0, 4)} /></div>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 06 ФИНАЛ CTA 24-30с */}
      <Sequence from={F[5]} durationInFrames={F[6] - F[5]}>
        <Photo src={ph(0)} dur={F[6] - F[5]} mode="out" /><Scrim /><Gold /><Sweep color="#D4AF37" />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 70px' }}>
          <In><H white={`ТВОЙ НОВЫЙ ${p.model.toUpperCase()}`} accent="ЖДЁТ ТЕБЯ" size={68} /></In>
          {p.price ? (
            <In delay={8}>
              <div style={{ marginTop: 30, display: 'inline-block', border: `2.5px solid ${GOLD}`, borderRadius: 16, padding: '14px 36px', fontFamily: FONT, fontWeight: 700, fontSize: 52, color: GOLD, background: 'rgba(10,10,10,0.75)', boxShadow: `0 0 44px ${GOLD}40` }}>{p.price}</div>
            </In>
          ) : null}
          <In delay={14}>
            <div style={{ marginTop: 30, display: 'inline-flex', alignItems: 'center', gap: 12, background: ACC, color: '#0A0A0A', fontFamily: FONT, fontWeight: 700, fontSize: 40, padding: '20px 42px', borderRadius: 16, boxShadow: `0 10px 44px ${ACC}55` }}>✈ {channel}</div>
          </In>
          <In delay={16}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 28, color: '#C8CDD2', marginTop: 24 }}>Свяжись с нами и узнай больше</div></In>
        </AbsoluteFill>
        <LogoBottom line="ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ" />
      </Sequence>
    </AbsoluteFill>
  );
};

import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// СТРОГО по ЛИСТ 6 (эталон Эдо): YouTube Shorts, 9:16, 6 кадров / 30 сек.
// Фото на ВЕСЬ кадр (тёмное, кинематографичное), текст на скриме поверх.
// Акцент ключевых слов — БИРЮЗА #00D1C2 (палитра ЛИСТ 6: бирюза/белый/серый/чёрный).
// Заголовок ≤2 строк, крупный Montserrat. Щит LA + отступ ≥5%.
// Кадры: 1 хук 0-3 · 2 характеристики 3-6 · 3 комплектация 6-12 · 4 состояние 12-18 · 5 доверие 18-24 · 6 CTA 24-30.
export type StoreShortsProps = {
  brand: string; model: string; year?: string;
  hook: string;
  power: string;
  options: string[];
  condition: string;
  trust: string[];
  price?: string;
  photos: string[];
  channel?: string;
  avail?: 'stock' | 'order';
  eta?: string;
  musicFile?: string;
  sfxWhoosh?: string;
  sfxImpact?: string;
};

const FPS = 30;
const TEAL = '#00D1C2';          // ЛИСТ 6: единственный акцент
const WHITE = '#FFFFFF';
const F = [0, 90, 180, 360, 540, 720, 900];
export const storeShortsDuration = () => 900;

// Ритм-пульс на BPM: фото/акценты слегка «дышат» в такт биту — приём вирусных авто-эдитов.
// ~140 BPM (drift phonk) → бит каждые ~12.86 кадра. Мягкий, не эпилепсия.
const BPM = 140;
const beatPulse = (f: number, amp = 0.012) => {
  const beat = (60 / BPM) * FPS;
  const ph = (f % beat) / beat;              // 0..1 внутри бита
  return 1 + amp * Math.max(0, 1 - ph * 3);  // резкий удар на доле → спад
};

// Щит LA — серебристый контур (как на ЛИСТ 6), бирюзовые буквы
const Shield: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0B0F14" stroke="#C8CDD2" strokeWidth="3" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="800" fontSize="36" fill="#E6E9EC" textAnchor="middle">LA</text>
  </svg>
);

// Фото на весь кадр: машина ЦЕЛИКОМ (contain) на своей же затемнённой размытой подложке.
// Даёт full-bleed без обрезки авто (правило Эдо «машина целиком»). Медленный киношный зум.
const Photo: React.FC<{ src: string; dur: number; mode?: 'in' | 'pan' | 'out' }> = ({ src, dur, mode = 'in' }) => {
  const f = useCurrentFrame();
  const push = spring({ frame: f, fps: FPS, config: { damping: 18, stiffness: 90 } });
  const scale = (interpolate(push, [0, 1], [1.12, 1.0]) + interpolate(f, [0, dur], [0, 0.05])) * beatPulse(f);
  const panX = mode === 'pan' ? interpolate(f, [0, dur], [-14, 14]) : 0;
  const url = /^https?:/.test(src) ? src : staticFile(src);
  return (
    <AbsoluteFill style={{ background: '#0A0A0A' }}>
      <Img src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(42px) brightness(0.34) saturate(1.15)', transform: 'scale(1.3)' }} />
      <Img src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale}) translateX(${panX}px)` }} />
    </AbsoluteFill>
  );
};

// Скрим: сверху и снизу затемнение, чтобы текст читался на любом фото (правило ЛИСТ 6)
const Scrim: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(8,10,14,0.86) 0%, rgba(8,10,14,0.30) 26%, transparent 44%, transparent 56%, rgba(8,10,14,0.55) 74%, rgba(8,10,14,0.94) 100%)' }} />
);

// Тонкая бирюзовая световая линия (ЛИСТ 8) под заголовком
const TealLine: React.FC<{ w?: number; delay?: number }> = ({ w = 300, delay = 5 }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - delay, fps: FPS, config: { damping: 18 } });
  return <div style={{ height: 3, width: w * s, marginTop: 16, borderRadius: 3, background: `linear-gradient(90deg, ${TEAL}, ${TEAL}00)`, boxShadow: `0 0 16px ${TEAL}88` }} />;
};

// Световой штрих на входе сцены (light leak, ЛИСТ 7)
const Sweep: React.FC = () => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, 24], [-30, 130], { extrapolateRight: 'clamp' });
  const op = interpolate(f, [0, 6, 20, 28], [0, 0.7, 0.4, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: `linear-gradient(112deg, transparent ${x - 12}%, ${TEAL}33 ${x}%, transparent ${x + 12}%)`, mixBlendMode: 'screen', opacity: op }} />;
};

const In: React.FC<{ children: React.ReactNode; delay?: number; y?: number }> = ({ children, delay = 0, y = 32 }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - delay, fps: FPS, config: { damping: 16, stiffness: 100 } });
  return <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [y, 0])}px)` }}>{children}</div>;
};

// Заголовок: белый + бирюзовый акцент на ключевых словах (ЛИСТ 6). Макс 2 строки, крупно.
const H: React.FC<{ white: string; accent?: string; size?: number }> = ({ white, accent, size = 88 }) => (
  <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.04, textTransform: 'uppercase', color: WHITE, textShadow: '0 4px 30px rgba(0,0,0,.85)', letterSpacing: -0.5 }}>
    {white}{accent ? <><br /><span style={{ color: TEAL }}>{accent}</span></> : null}
  </div>
);

// Чек-лист (бирюзовая галочка + белый текст) — комплектация/доверие
const Check: React.FC<{ items: string[]; delay?: number }> = ({ items, delay = 6 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {items.map((t, i) => {
        const s = spring({ frame: f - delay - i * 5, fps: FPS, config: { damping: 15 } });
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: s, transform: `translateX(${interpolate(s, [0, 1], [28, 0])}px)` }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, filter: `drop-shadow(0 0 6px ${TEAL}66)` }}><path d="M5 13l4 4L19 7" /></svg>
            <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: '#F0F2F4', textShadow: '0 2px 14px rgba(0,0,0,.9)' }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
};

// Прогресс-бар (6 сегментов) — бирюзовый
const Progress: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', top: 40, left: 56, right: 56, display: 'flex', gap: 7, zIndex: 20 }}>
      {Array.from({ length: 6 }).map((_, i) => {
        const fill = f <= F[i] ? 0 : f >= F[i + 1] ? 1 : (f - F[i]) / (F[i + 1] - F[i]);
        return (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
            <div style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 3, background: TEAL, boxShadow: `0 0 8px ${TEAL}` }} />
          </div>
        );
      })}
    </div>
  );
};

// Бренд-шапка: щит слева сверху (ЛИСТ 6 «лого всегда сверху» + отступ ≥5%)
const TopBrand: React.FC = () => (
  <div style={{ position: 'absolute', top: 62, left: 56, display: 'flex', alignItems: 'center', gap: 14, zIndex: 21 }}>
    <Shield size={48} />
    <div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 26, letterSpacing: 1.5, color: WHITE, lineHeight: 1.05 }}>LEGAL AUTO <span style={{ color: TEAL }}>STORE</span></div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 15, letterSpacing: 2.2, color: '#8A929B' }}>ПОДБОР И ПРОДАЖА АВТО</div>
    </div>
  </div>
);

const LogoBottom: React.FC<{ line?: string }> = ({ line }) => (
  <div style={{ position: 'absolute', bottom: 92, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 6 }}>
    <Shield size={70} />
    {line ? <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 22, letterSpacing: 3, color: '#B9C0C7' }}>{line}</div> : null}
  </div>
);

export const StoreShorts: React.FC<StoreShortsProps> = (p) => {
  ensureFonts();
  const ph = (i: number) => (p.photos && p.photos.length ? p.photos[i % p.photos.length] : '');
  const carName = `${p.brand} ${p.model}`.trim();
  const channel = p.channel || '@LegalAutoStore';
  const inStock = p.avail === 'stock';
  const availLabel = inStock ? '✓ В НАЛИЧИИ В РФ' : `✈ ПОД ЗАКАЗ${p.eta ? ` · ${p.eta}` : ' · ПРИГОН ПОД КЛЮЧ'}`;
  const ctaWhite = inStock ? `${p.model.toUpperCase()} УЖЕ В РФ —` : `ПРИВЕЗЁМ ТВОЙ ${p.model.toUpperCase()}`;
  const ctaAccent = inStock ? 'ЗАБИРАЙ СЕГОДНЯ' : 'ПОД КЛЮЧ';

  return (
    <AbsoluteFill style={{ background: '#0A0A0A' }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.82} /> : null}
      {p.sfxImpact ? <Sequence from={2} durationInFrames={40}><Audio src={staticFile(p.sfxImpact)} volume={0.85} /></Sequence> : null}
      {p.sfxWhoosh ? [1, 2, 3, 4, 5].map((i) => (
        <Sequence key={i} from={F[i] - 6} durationInFrames={30}><Audio src={staticFile(p.sfxWhoosh!)} volume={0.5} /></Sequence>
      )) : null}

      {/* 01 ХУК 0-3 */}
      <Sequence durationInFrames={F[1]}>
        <Photo src={ph(0)} dur={F[1]} mode="in" /><Scrim /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', paddingTop: 210, padding: '210px 60px 0' }}>
          <In><H white={p.hook} size={82} /></In>
          <In delay={7}><TealLine w={280} /></In>
          <In delay={10}>
            <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 40, color: WHITE }}>{carName}{p.year ? <span style={{ color: TEAL }}> {p.year}</span> : null}</div>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 26, color: '#0A0A0A', background: TEAL, borderRadius: 8, padding: '7px 16px' }}>{availLabel}</div>
            </div>
          </In>
        </AbsoluteFill>
        <LogoBottom line="LEGAL AUTO STORE" />
      </Sequence>

      {/* 02 ХАРАКТЕРИСТИКИ 3-6 */}
      <Sequence from={F[1]} durationInFrames={F[2] - F[1]}>
        <Photo src={ph(1)} dur={F[2] - F[1]} mode="pan" /><Scrim /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '230px 60px 0' }}>
          <In><H white="МОЩЬ" accent={p.power} size={96} /></In>
          <In delay={7}><TealLine w={320} /></In>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 03 КОМПЛЕКТАЦИЯ 6-12 */}
      <Sequence from={F[2]} durationInFrames={F[3] - F[2]}>
        <Photo src={ph(2)} dur={F[3] - F[2]} mode="in" /><Scrim /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '200px 60px 0' }}>
          <In><H white="МАКСИМАЛЬНАЯ" accent="КОМПЛЕКТАЦИЯ" size={62} /></In>
          <div style={{ marginTop: 40 }}><Check items={(p.options || []).slice(0, 6)} /></div>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 04 СОСТОЯНИЕ 12-18 */}
      <Sequence from={F[3]} durationInFrames={F[4] - F[3]}>
        <Photo src={ph(3)} dur={F[4] - F[3]} mode="out" /><Scrim /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '230px 60px 0' }}>
          <In><H white="ИДЕАЛЬНОЕ" accent="СОСТОЯНИЕ" size={78} /></In>
          {p.condition ? <In delay={8}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 44, color: '#F0F2F4', marginTop: 22, textShadow: '0 3px 18px rgba(0,0,0,.9)' }}>{p.condition}</div></In> : null}
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 05 ДОВЕРИЕ 18-24 */}
      <Sequence from={F[4]} durationInFrames={F[5] - F[4]}>
        <Photo src={ph(4)} dur={F[5] - F[4]} mode="pan" /><Scrim /><Sweep />
        <AbsoluteFill style={{ justifyContent: 'flex-start', padding: '200px 60px 0' }}>
          <In><H white="ПРОВЕРЕН И ГОТОВ" accent="К НОВОМУ ВЛАДЕЛЬЦУ" size={56} /></In>
          <div style={{ marginTop: 40 }}><Check items={(p.trust && p.trust.length ? p.trust : ['Юридическая чистота', 'Проверка перед покупкой', 'Полный пакет документов']).slice(0, 4)} /></div>
        </AbsoluteFill>
        <LogoBottom />
      </Sequence>

      {/* 06 ФИНАЛ CTA 24-30 */}
      <Sequence from={F[5]} durationInFrames={F[6] - F[5]}>
        <Photo src={ph(0)} dur={F[6] - F[5]} mode="out" /><Scrim /><Sweep />
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse 92% 60% at 50% 48%, rgba(8,10,14,0.72) 0%, rgba(8,10,14,0.4) 55%, transparent 100%)' }} />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 60px' }}>
          <In><H white={ctaWhite} accent={ctaAccent} size={62} /></In>
          {!inStock && p.eta ? <In delay={5}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 30, color: TEAL, marginTop: 14 }}>Срок поставки: {p.eta}</div></In> : null}
          {p.price ? (
            <In delay={8}>
              <div style={{ marginTop: 28, display: 'inline-block', border: `2.5px solid ${TEAL}`, borderRadius: 16, padding: '13px 40px', fontFamily: FONT, fontWeight: 800, fontSize: 54, color: WHITE, background: 'rgba(8,10,14,0.6)', boxShadow: `0 0 40px ${TEAL}44` }}>{p.price}</div>
            </In>
          ) : null}
          <In delay={13}>
            <div style={{ marginTop: 26, display: 'inline-flex', alignItems: 'center', gap: 12, background: TEAL, color: '#0A0A0A', fontFamily: FONT, fontWeight: 800, fontSize: 38, padding: '18px 44px', borderRadius: 14, boxShadow: `0 10px 40px ${TEAL}55` }}>✈ {channel}</div>
          </In>
          <In delay={16}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 26, color: '#C8CDD2', marginTop: 20 }}>Свяжись с нами и узнай больше</div></In>
        </AbsoluteFill>
        <LogoBottom line="ФАКТЫ · КОНТРОЛЬ · РЕЗУЛЬТАТ" />
      </Sequence>

      <TopBrand />
      <Progress />
    </AbsoluteFill>
  );
};

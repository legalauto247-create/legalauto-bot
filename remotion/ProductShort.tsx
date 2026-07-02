import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

export type Item = { photo: string; photos?: string[]; name: string; price?: string; fits?: string };
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
const TR = 16;      // окно перехода (вход/выход сцены)

export const productDuration = (n: number) => INTRO + PER * Math.max(1, n) + OUTRO;

const ease = Easing.bezier(0.22, 1, 0.36, 1);   // «cinematic» замедление

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

// Кружок-иконка (как в шаблоне)
const IconCircle: React.FC<{ accent: string; children: React.ReactNode }> = ({ accent, children }) => (
  <div style={{ width: 62, height: 62, borderRadius: '50%', background: '#11151d', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, boxShadow: `0 6px 22px ${accent}44`, flexShrink: 0 }}>{children}</div>
);

// Постоянный футер — контакты в кружках + слоган (стиль твоего шаблона)
const Footer: React.FC<{ accent: string; channel: string }> = ({ accent, channel }) => (
  <div style={{ position: 'absolute', left: 56, right: 56, bottom: 44, zIndex: 6 }}>
    <div style={{ height: 2, marginBottom: 20, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <IconCircle accent={accent}>📞</IconCircle>
        <div><div style={{ fontSize: 18, color: '#8a939c' }}>Свяжитесь:</div><div style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>+7 938 515-24-29</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <IconCircle accent={accent}>✈️</IconCircle>
        <div><div style={{ fontSize: 18, color: '#8a939c' }}>Telegram:</div><div style={{ fontSize: 30, fontWeight: 700, color: accent }}>{channel}</div></div>
      </div>
    </div>
    <div style={{ textAlign: 'center', fontFamily: FONT, fontWeight: 400, fontSize: 22, color: '#8a939c', marginTop: 16, fontStyle: 'italic' }}>Ваш надёжный партнёр в мире автомобилей</div>
  </div>
);

// Живые частицы/бокэ — детерминированные (одинаковы при каждом рендере кадра)
const Particles: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  const { height } = useVideoConfig();
  const N = 22;
  const dots = [];
  for (let i = 0; i < N; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const rx = (seed / 233280);
    const ry = ((seed * 7 + 13) % 233280) / 233280;
    const size = 4 + rx * 14;
    const speed = 0.25 + ry * 0.7;
    const x = rx * 100;
    const y = ((ry * height - f * speed * 3) % (height + 120) + height + 120) % (height + 120) - 60;
    const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin((f * 0.05) + i));
    const isAccent = i % 3 === 0;
    dots.push(
      <div key={i} style={{
        position: 'absolute', left: `${x}%`, top: y, width: size, height: size, borderRadius: '50%',
        background: isAccent ? accent : '#ffffff', opacity: tw * (isAccent ? 0.5 : 0.3),
        filter: `blur(${size > 12 ? 3 : 1}px)`, boxShadow: isAccent ? `0 0 12px ${accent}` : '0 0 8px #fff',
      }} />
    );
  }
  return <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>{dots}</AbsoluteFill>;
};

// Профи-фон: брендовый фон + карбон + световой свип + параллакс + дыхание + частицы
const Bg: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(f, [0, durationInFrames], [1.06, 1.2]);
  const drift = interpolate(f, [0, durationInFrames], [-24, 24]);
  const breathe = 1 + 0.015 * Math.sin(f * 0.04);      // «дыхание» волн
  const sweep = ((f * 1.5) % 170) - 35;
  return (
    <AbsoluteFill>
      <Img src={staticFile('bg-parts.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom * breathe}) translateX(${drift}px)` }} />
      <AbsoluteFill style={{ opacity: 0.06, backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0 2px, transparent 2px 28px)` }} />
      <Particles accent={accent} />
      <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent ${sweep - 20}%, ${accent}22 ${sweep}%, transparent ${sweep + 20}%)`, mixBlendMode: 'screen' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(10,9,6,0.55) 0%, rgba(10,9,6,0.12) 38%, rgba(10,9,6,0.82) 100%)' }} />
    </AbsoluteFill>
  );
};

// Кинетический заголовок — буквы влетают со стаггером
const Kinetic: React.FC<{ text: string; style: React.CSSProperties; delay?: number }> = ({ text, style, delay = 0 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ ...style, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
      {text.split('').map((ch, i) => {
        const s = spring({ frame: f - delay - i * 1.1, fps: FPS, config: { damping: 16, stiffness: 120 } });
        return (
          <span key={i} style={{ display: 'inline-block', opacity: s, transform: `translateY(${interpolate(s, [0, 1], [22, 0])}px)`, whiteSpace: 'pre' }}>{ch}</span>
        );
      })}
    </div>
  );
};

// Счётчик цены: число «набегает» от 0 к реальной сумме
const PriceCounter: React.FC<{ price: string; accent: string; delay: number }> = ({ price, accent, delay }) => {
  const f = useCurrentFrame();
  const digits = Number(String(price).replace(/[^\d]/g, '')) || 0;
  const p = interpolate(f - delay, [0, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const shown = Math.round(digits * p).toLocaleString('ru-RU');
  const pop = spring({ frame: f - delay, fps: FPS, config: { damping: 12, stiffness: 140 } });
  return (
    <div style={{ display: 'inline-block', marginTop: 18, transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, opacity: pop, fontFamily: FONT, fontWeight: 700, fontSize: 56, color: theme.bg, background: `linear-gradient(135deg, #F5D77A, ${accent})`, padding: '14px 44px', borderRadius: 16, boxShadow: `0 10px 36px ${accent}66` }}>
      {shown} ₽
    </div>
  );
};

// Карточка запчасти — студийный подиум с отражением, вход/выход со сдвигом
const PartScene: React.FC<{ item: Item; accent: string }> = ({ item, accent }) => {
  const f = useCurrentFrame();
  // вход: сдвиг справа + фейд; выход: сдвиг влево + фейд
  const enter = interpolate(f, [0, TR], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const exit = interpolate(f, [PER - TR, PER], [1, 0], { extrapolateLeft: 'clamp', easing: ease });
  const opacity = Math.min(enter, exit);
  const shiftX = interpolate(f, [0, TR], [70, 0], { extrapolateRight: 'clamp', easing: ease })
    + interpolate(f, [PER - TR, PER], [0, -70], { extrapolateLeft: 'clamp', easing: ease });
  const zoom = interpolate(f, [0, PER], [1.0, 1.07]);
  const s = spring({ frame: f, fps: FPS, config: { damping: 20, stiffness: 90 } });
  const chip = spring({ frame: f - 6, fps: FPS, config: { damping: 18 } });

  return (
    <AbsoluteFill style={{ opacity, transform: `translateX(${shiftX}px)` }}>
      {/* мягкое свечение под карточкой */}
      <div style={{ position: 'absolute', top: 300, left: '50%', width: 720, height: 620, transform: 'translateX(-50%)', background: `radial-gradient(ellipse at center, ${accent}30 0%, transparent 65%)`, filter: 'blur(30px)', opacity: s }} />

      {/* студийная карточка: фото (несколько ракурсов с кроссфейдом) + отражение */}
      <div style={{ position: 'absolute', top: 226, left: 66, right: 66, height: 664, transform: `translateY(${interpolate(s, [0, 1], [42, 0])}px)`, opacity: s }}>
        <div style={{ position: 'relative', height: 500, borderRadius: 30, overflow: 'hidden', background: 'linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))', border: `1.5px solid ${accent}55`, boxShadow: `0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.15)` }}>
          <Img src={item.photo} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(30px) brightness(0.4) saturate(1.2)', transform: 'scale(1.25)' }} />
          {(() => {
            const shots = (item.photos && item.photos.length ? item.photos : [item.photo]).slice(0, 3);
            const seg = PER / shots.length;                 // время на один ракурс
            return shots.map((ph, i) => {
              const a = i * seg, b = (i + 1) * seg;
              const op = i === 0
                ? interpolate(f, [b - 8, b], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                : Math.min(
                    interpolate(f, [a - 8, a], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                    i === shots.length - 1 ? 1 : interpolate(f, [b - 8, b], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                  );
              return <Img key={i} src={ph} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})`, filter: 'drop-shadow(0 18px 30px rgba(0,0,0,.55))', opacity: op }} />;
            });
          })()}
          {/* счётчик ракурсов */}
          {(item.photos?.length || 1) > 1 ? (
            <div style={{ position: 'absolute', right: 18, bottom: 14, display: 'flex', gap: 8 }}>
              {(item.photos || []).slice(0, 3).map((_, i) => {
                const seg = PER / (item.photos!.slice(0, 3).length);
                const active = f >= i * seg && f < (i + 1) * seg;
                return <div key={i} style={{ width: active ? 22 : 8, height: 8, borderRadius: 4, background: active ? accent : 'rgba(255,255,255,0.4)', transition: 'width .2s' }} />;
              })}
            </div>
          ) : null}
        </div>
        {/* отражение на «полу» */}
        <div style={{ position: 'relative', height: 150, marginTop: 2, borderRadius: 30, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,.4), transparent 78%)', maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.4), transparent 78%)', opacity: 0.5 }}>
          <Img src={item.photo} style={{ width: '100%', height: 500, objectFit: 'contain', transform: 'scaleY(-1) translateY(-350px)' }} />
        </div>
      </div>

      {/* модель + имя + цена — матовая стеклянная панель + кинетика */}
      <div style={{ position: 'absolute', left: 60, right: 60, top: 936, textAlign: 'center', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 28, padding: '30px 36px', transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`, opacity: s }}>
        {item.fits ? (
          <div style={{ display: 'inline-block', opacity: chip, transform: `translateY(${interpolate(chip, [0, 1], [16, 0])}px)`, fontFamily: FONT, fontWeight: 700, fontSize: 32, color: accent, background: '#0d1119', border: `1.5px solid ${accent}`, borderRadius: 14, padding: '10px 26px', marginBottom: 16, letterSpacing: 0.5 }}>{item.fits}</div>
        ) : null}
        <Kinetic text={item.name} delay={8} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 58, color: '#fff', lineHeight: 1.12, textShadow: '0 2px 14px rgba(0,0,0,.6)' }} />
        {item.price ? <PriceCounter price={item.price} accent={accent} delay={16} /> : null}
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

      {/* шапка/футер — постоянные на всём блоке карточек (не мигают между сценами) */}
      <Sequence from={INTRO} durationInFrames={PER * n}>
        <Header accent={p.accent} />
        <Footer accent={p.accent} channel={p.channel} />
      </Sequence>

      {items.map((it, i) => (
        <Sequence key={i} from={INTRO + i * PER} durationInFrames={PER}>
          <PartScene item={it} accent={p.accent} />
        </Sequence>
      ))}

      <Sequence from={INTRO + n * PER} durationInFrames={OUTRO}><Outro cta={p.cta} channel={p.channel} accent={p.accent} /></Sequence>
    </AbsoluteFill>
  );
};

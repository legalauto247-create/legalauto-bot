import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile,
  useCurrentFrame, interpolate, spring, Easing,
} from 'remotion';
import { theme, FONT, ensureFonts } from './theme';

// Эталон: ЛИСТ 4 (STORE, чёрно-золотой премиум) + ЛИСТ 6 (структура Shorts) + ЛИСТ 7 (motion).
// Карточная вёрстка: фото в золотой рамке + инфопанель с иконками — как в эталоне Эдо.
// 1 хук 0-3 → 2 характеристики 3-6 → 3 комплектация 6-12 → 4 состояние 12-18 → 5 доверие 18-24 → 6 CTA 24-30.
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
  avail?: 'stock' | 'order';    // stock = в наличии в РФ, order = под заказ/пригон
  eta?: string;                 // срок поставки из поста («30-45 дней»), если под заказ
  musicFile?: string;
  sfxWhoosh?: string;           // звук перехода
  sfxImpact?: string;           // удар на хуке
};

const FPS = 30;
const GOLD = '#D4AF37';
const TEAL = '#00D1C2';
const BG = '#0B0F14';
const SURF = 'rgba(18, 23, 30, 0.92)';
const GOLD_GRAD = 'linear-gradient(120deg, #FFD700 0%, #D4AF37 55%, #9A7B1E 100%)';
const HAIR = 'rgba(212,175,55,0.4)';   // золотая волосяная окантовка
const F = [0, 90, 180, 360, 540, 720, 900];
export const storeShortsDuration = () => 900;

const Shield: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size * 1.13} viewBox="0 0 92 104" fill="none">
    <path d="M46 4 L84 18 V52 C84 78 66 94 46 100 C26 94 8 78 8 52 V18 Z" fill="#0D0D0D" stroke={GOLD} strokeWidth="3.5" />
    <text x="46" y="63" fontFamily={FONT} fontWeight="700" fontSize="38" fill={GOLD} textAnchor="middle">LA</text>
  </svg>
);

// Мини-иконки в стиле эталона (тонкая линия, золото)
const Ico: React.FC<{ d: string }> = ({ d }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  gauge: 'M12 15 L16 9 M12 21 a9 9 0 1 1 0 -18 a9 9 0 0 1 0 18 M7 17 a6.6 6.6 0 0 1 10 0',
  engine: 'M5 9 H9 L11 7 H15 V9 H18 V15 H15 V17 H11 L9 15 H5 Z M3 11 V13 M21 11 V13',
  gear: 'M12 8 V4 M12 8 a4 4 0 1 0 0 8 a4 4 0 0 0 0 -8 M12 16 V20 M8 12 H4 M20 12 H16',
  drive: 'M7 7 a2 2 0 1 0 0.01 0 M17 7 a2 2 0 1 0 0.01 0 M7 17 a2 2 0 1 0 0.01 0 M17 17 a2 2 0 1 0 0.01 0 M9 9 L15 15 M15 9 L9 15',
  shield: 'M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z M9 12 L11 14 L15 10',
  doc: 'M7 3 H14 L19 8 V21 H7 Z M14 3 V8 H19 M10 13 H16 M10 17 H16',
  truck: 'M2 7 H14 V16 H2 Z M14 10 H18 L21 13 V16 H14 M6 19 a1.6 1.6 0 1 0 0.01 0 M17 19 a1.6 1.6 0 1 0 0.01 0',
  key: 'M14 10 a4 4 0 1 0 -4 4 L4 20 V22 H8 L8.5 19.5 L11 19 L10 14',
};

// ЛИСТ 4: «Логотип всегда в левом верхнем углу»
const TopBrand: React.FC = () => (
  <div style={{ position: 'absolute', top: 64, left: 56, display: 'flex', alignItems: 'center', gap: 14, zIndex: 21 }}>
    <Shield size={46} />
    <div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 26, letterSpacing: 1.5, color: '#fff', lineHeight: 1.1 }}>LEGAL AUTO <span style={{ color: GOLD }}>STORE</span></div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 15, letterSpacing: 2.2, color: '#9AA1A8' }}>ПОДБОР И ПРОДАЖА АВТО</div>
    </div>
  </div>
);

// Фирменный фон: AI-плита по эталону ЛИСТ 4 (карбон, золотые штрихи, боке) + медленный дрейф.
// Плита сгенерирована из брендбука Эдо (gpt-image), лежит в assets/brand/store-bg.png.
const Bg: React.FC = () => {
  const f = useCurrentFrame();
  const drift = interpolate(f, [0, 900], [1.0, 1.08]);
  return (
    <AbsoluteFill style={{ background: '#06090D' }}>
      <Img src={staticFile('store-bg.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${drift})` }} />
    </AbsoluteFill>
  );
};

// Фото в карточке с золотой окантовкой: авто ЦЕЛИКОМ (contain на тёмной подложке того же фото)
const PhotoCard: React.FC<{ src: string; top: number; height: number; dur: number; pan?: boolean }> = ({ src, top, height, dur, pan }) => {
  const f = useCurrentFrame();
  const enter = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 90 } });
  const scale = interpolate(enter, [0, 1], [1.08, 1]) + interpolate(f, [0, dur], [0, 0.045]);
  const panX = pan ? interpolate(f, [0, dur], [-12, 12]) : 0;
  const url = /^https?:/.test(src) ? src : staticFile(src);
  return (
    <div style={{ position: 'absolute', top, left: 48, right: 48, height, borderRadius: 30, overflow: 'hidden', border: `1.5px solid ${HAIR}`, boxShadow: `0 30px 70px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,0.04) inset`, opacity: enter }}>
      <Img src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(34px) brightness(0.36) saturate(1.15)', transform: 'scale(1.35)' }} />
      <Img src={url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale}) translateX(${panX}px)` }} />
      {/* лёгкий золотой отблеск по верхней кромке */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: GOLD_GRAD, opacity: 0.7 }} />
    </div>
  );
};

// Инфопанель под фото (тёмная поверхность, золотая окантовка — как карточка эталона)
const Panel: React.FC<{ top: number; children: React.ReactNode; center?: boolean }> = ({ top, children, center }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 4, fps: FPS, config: { damping: 16 } });
  return (
    <div style={{ position: 'absolute', top, left: 48, right: 48, bottom: 88, borderRadius: 30, background: SURF, border: `1.5px solid ${HAIR}`, padding: '46px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left', opacity: s, transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: GOLD_GRAD }} />
      {children}
    </div>
  );
};

// Малый золотой заголовок-ярлык секции (как «СОВМЕСТИМОСТЬ:» на ЛИСТЕ 3)
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 26, letterSpacing: 3.5, color: GOLD, textTransform: 'uppercase' }}>{children}</div>
);

// Строка характеристики с иконкой (эталон: иконка + подпись + значение)
const SpecRow: React.FC<{ icon: keyof typeof I; text: string; idx?: number }> = ({ icon, text, idx = 0 }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - 8 - idx * 5, fps: FPS, config: { damping: 15 } });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: s, transform: `translateX(${interpolate(s, [0, 1], [34, 0])}px)` }}>
      <div style={{ width: 58, height: 58, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: 'rgba(212,175,55,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico d={I[icon]} /></div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 37, color: '#F0F2F4', lineHeight: 1.25 }}>{text}</div>
    </div>
  );
};

const In: React.FC<{ children: React.ReactNode; delay?: number; y?: number }> = ({ children, delay = 0, y = 30 }) => {
  const f = useCurrentFrame();
  const s = spring({ frame: f - delay, fps: FPS, config: { damping: 16, stiffness: 100 } });
  return <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [y, 0])}px)` }}>{children}</div>;
};

const H: React.FC<{ white: string; accent?: string; size?: number }> = ({ white, accent, size = 66 }) => (
  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.1, textTransform: 'uppercase', color: '#fff' }}>
    {white}{accent ? <span style={{ color: GOLD }}> {accent}</span> : null}
  </div>
);

// Вспышка перехода
const Flash: React.FC<{ color?: string }> = ({ color = '#FFFFFF' }) => {
  const f = useCurrentFrame();
  const op = interpolate(f, [0, 4, 10], [0.4, 0.16, 0], { extrapolateRight: 'clamp' });
  return op > 0.01 ? <AbsoluteFill style={{ background: color, opacity: op, mixBlendMode: 'screen', zIndex: 30 }} /> : null;
};

// Прогресс-бар (6 сегментов, золото)
const Progress: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', top: 36, left: 56, right: 56, display: 'flex', gap: 7, zIndex: 20 }}>
      {Array.from({ length: 6 }).map((_, i) => {
        const fill = f <= F[i] ? 0 : f >= F[i + 1] ? 1 : (f - F[i]) / (F[i + 1] - F[i]);
        return (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
            <div style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 3, background: GOLD_GRAD }} />
          </div>
        );
      })}
    </div>
  );
};

// Нижняя фирменная полоса (эталон: «ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ»)
const BottomStrip: React.FC = () => (
  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'rgba(8,11,15,0.9)', borderTop: `1px solid ${HAIR}`, zIndex: 21 }}>
    <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 22, letterSpacing: 4, color: '#B9C0C7' }}>ФАКТЫ <span style={{ color: GOLD }}>•</span> КОНТРОЛЬ <span style={{ color: GOLD }}>•</span> РЕЗУЛЬТАТ</div>
  </div>
);

// Раскладка сцены: шапка 150px → фото-карточка → инфопанель → полоса
const PH_TOP = 168;            // под шапкой
const PH_H = 850;              // фото-карточка
const PN_TOP = PH_TOP + PH_H + 26;

export const StoreShorts: React.FC<StoreShortsProps> = (p) => {
  ensureFonts();
  const ph = (i: number) => (p.photos && p.photos.length ? p.photos[i % p.photos.length] : '');
  const channel = p.channel || '@LegalAutoStore';
  const inStock = p.avail === 'stock';
  const availLabel = inStock ? '✓ В НАЛИЧИИ В РФ' : `✈ ПОД ЗАКАЗ${p.eta ? ` • ${p.eta}` : ' • ПРИГОН ПОД КЛЮЧ'}`;
  const availColor = inStock ? TEAL : GOLD;
  const ctaWhite = inStock ? `${p.model.toUpperCase()} УЖЕ В РФ —` : `ПРИВЕЗЁМ ТВОЙ ${p.model.toUpperCase()}`;
  const ctaAccent = inStock ? 'ЗАБИРАЙ СЕГОДНЯ' : 'ПОД КЛЮЧ';
  // Характеристики из power/condition: «3.0d / 400 л.с. · xDrive · Автомат» → строки с иконками
  const powerParts = String(p.power || '').split(/[·•|,]/).map(s => s.trim()).filter(Boolean).slice(0, 3);
  const specIcons: (keyof typeof I)[] = ['engine', 'drive', 'gear'];

  const scene = (i: number, from: number, to: number, panel: React.ReactNode, opts: { pan?: boolean; flash?: string; tall?: boolean } = {}) => {
    const phh = opts.tall ? 1060 : PH_H;   // мало текста → фото крупнее, панель компактнее
    return (
      <Sequence from={from} durationInFrames={to - from}>
        <Bg />
        <PhotoCard src={ph(i)} top={PH_TOP} height={phh} dur={to - from} pan={opts.pan} />
        <Panel top={PH_TOP + phh + 26}>{panel}</Panel>
        <Flash color={opts.flash} />
      </Sequence>
    );
  };

  return (
    <AbsoluteFill style={{ background: BG }}>
      {p.musicFile ? <Audio src={staticFile(p.musicFile)} volume={0.82} /> : null}
      {p.sfxImpact ? <Sequence from={2} durationInFrames={40}><Audio src={staticFile(p.sfxImpact)} volume={0.85} /></Sequence> : null}
      {p.sfxWhoosh ? [1, 2, 3, 4, 5].map((i) => (
        <Sequence key={i} from={F[i] - 6} durationInFrames={30}><Audio src={staticFile(p.sfxWhoosh!)} volume={0.5} /></Sequence>
      )) : null}

      {/* 01 ХУК: фото + модель/год/наличие в панели */}
      {scene(0, F[0], F[1], (
        <>
          <In><H white={p.hook} size={58} /></In>
          <In delay={7}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 22 }}>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 68, color: '#fff', textTransform: 'uppercase' }}>{p.brand} <span style={{ color: GOLD }}>{p.model}</span></div>
              {p.year ? <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: '#0A0A0A', background: GOLD_GRAD, borderRadius: 10, padding: '4px 16px' }}>{p.year}</div> : null}
            </div>
          </In>
          <In delay={12}>
            <div style={{ marginTop: 20, display: 'inline-block', borderRadius: 10, padding: '10px 24px', fontFamily: FONT, fontWeight: 700, fontSize: 29, color: '#0A0A0A', background: availColor }}>{availLabel}</div>
          </In>
        </>
      ), { flash: GOLD, tall: true })}

      {/* 02 ХАРАКТЕРИСТИКИ: строки с иконками, как на эталоне */}
      {scene(1, F[1], F[2], (
        <>
          <Label>Характеристики</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 30 }}>
            {powerParts.map((t, i) => <SpecRow key={i} icon={specIcons[i % 3]} text={t} idx={i} />)}
            {p.condition ? <SpecRow icon="gauge" text={p.condition} idx={powerParts.length} /> : null}
          </div>
        </>
      ), { pan: true, tall: powerParts.length <= 2 })}

      {/* 03 КОМПЛЕКТАЦИЯ */}
      {scene(2, F[2], F[3], (
        <>
          <Label>Комплектация</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 19, marginTop: 28 }}>
            {(p.options || []).slice(0, 5).map((t, i) => <SpecRow key={i} icon={i % 2 ? 'key' : 'shield'} text={t} idx={i} />)}
          </div>
        </>
      ))}

      {/* 04 СОСТОЯНИЕ */}
      {scene(3, F[3], F[4], (
        <>
          <Label>Состояние</Label>
          <In delay={6}><div style={{ marginTop: 24 }}><H white={p.condition || 'Проверено Legal Auto'} size={52} /></div></In>
        </>
      ), { pan: true, flash: GOLD, tall: true })}

      {/* 05 ДОВЕРИЕ */}
      {scene(4, F[4], F[5], (
        <>
          <Label>Гарантии Legal Auto</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 19, marginTop: 28 }}>
            {(p.trust || []).slice(0, 4).map((t, i) => <SpecRow key={i} icon={(['shield', 'doc', 'truck', 'key'] as (keyof typeof I)[])[i % 4]} text={t} idx={i} />)}
          </div>
        </>
      ))}

      {/* 06 ФИНАЛ CTA: цена золотом в рамке + золотая кнопка */}
      <Sequence from={F[5]} durationInFrames={F[6] - F[5]}>
        <Bg />
        <PhotoCard src={ph(0)} top={PH_TOP} height={760} dur={F[6] - F[5]} />
        <Panel top={PH_TOP + 760 + 26} center>
          <In><H white={ctaWhite} accent={ctaAccent} size={48} /></In>
          {!inStock && p.eta ? <In delay={5}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 30, color: GOLD, marginTop: 12 }}>Срок поставки: {p.eta}</div></In> : null}
          {p.price ? (
            <In delay={8}>
              <div style={{ marginTop: 22, display: 'inline-block', border: `2.5px solid ${GOLD}`, borderRadius: 16, padding: '12px 40px', fontFamily: FONT, fontWeight: 700, fontSize: 56, color: GOLD, background: 'rgba(10,10,10,0.6)', boxShadow: `0 0 40px ${GOLD}30` }}>{p.price}</div>
            </In>
          ) : null}
          <In delay={13}>
            <div style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 12, background: GOLD_GRAD, color: '#0A0A0A', fontFamily: FONT, fontWeight: 700, fontSize: 38, padding: '18px 46px', borderRadius: 14, boxShadow: `0 10px 40px ${GOLD}55` }}>✈ {channel}</div>
          </In>
          <In delay={15}><div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 26, color: '#B9C0C7', marginTop: 18 }}>Консультация бесплатно</div></In>
        </Panel>
        <Flash color={GOLD} />
      </Sequence>

      <TopBrand />
      <Progress />
      <BottomStrip />
    </AbsoluteFill>
  );
};

import React from 'react';
import { Composition } from 'remotion';
import { CarReel, reelDuration } from './CarReel';
import { ViralShort, viralDuration, ViralProps } from './ViralShort';
import { ProductShort, productDuration, ProductProps } from './ProductShort';
import { InfoShort, infoDuration, InfoProps } from './InfoShort';
import { CinematicShort, cineDuration, CineProps } from './CinematicShort';
import { FPS, WIDTH, HEIGHT, ReelProps } from './theme';

const defaultProps: ReelProps = {
  kind: 'car',
  brand: 'BMW',
  model: '3 Series 2023',
  tagline: '320Li Sport · из Китая',
  specs: [
    { label: 'Год', value: '2023' },
    { label: 'Пробег', value: '85 000 км' },
    { label: 'Двигатель', value: '2.0T' },
    { label: 'Привод', value: 'Задний' },
  ],
  price: '2 859 000 ₽',
  priceLabel: 'цена под ключ',
  location: 'из Китая · доставка 6-8 недель',
  cta: 'Заказ авто → @LegalAuto247',
  photos: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="CarReel"
      component={CarReel as React.FC<Record<string, unknown>>}
      durationInFrames={reelDuration(5)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as ReelProps;
        return { durationInFrames: reelDuration((p.photos || []).slice(0, 5).length || 1) };
      }}
    />
    <Composition
      id="ViralShort"
      component={ViralShort as React.FC<Record<string, unknown>>}
      durationInFrames={viralDuration()}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ soraFile: 'sora.mp4', accent: '#FF6B00', hook: 'Запчасти BMW', facts: [], cta: 'Заказ', channel: '@LegalAutoParts24' } as unknown as Record<string, unknown>}
    />
    <Composition
      id="ProductShort"
      component={ProductShort as React.FC<Record<string, unknown>>}
      durationInFrames={productDuration(5)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ items: [], hook: 'Запчасти BMW', cta: 'Заказ', channel: '@LegalAutoParts24', accent: '#FF6B00' } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as ProductProps;
        return { durationInFrames: productDuration((p.items || []).slice(0, 6).length || 1) };
      }}
    />
    <Composition
      id="InfoShort"
      component={InfoShort as React.FC<Record<string, unknown>>}
      durationInFrames={infoDuration(4)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ brandLine: 'LEGAL AUTO • ДОКУМЕНТЫ', hook: 'СБКТС и ЭПТС', tagline: 'оформляем под ключ', points: [], cta: 'Оформим за вас', channel: '@LegalAuto24', groupUrl: 't.me/LegalAuto24', accent: '#00D1C2' } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as InfoProps;
        return { durationInFrames: infoDuration((p.points || []).slice(0, 6).length || 1) };
      }}
    />
    <Composition
      id="CinematicShort"
      component={CinematicShort as React.FC<Record<string, unknown>>}
      durationInFrames={cineDuration(4)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ brandLine: 'LEGAL AUTO • ПРИГОН', hook: 'Авто под ключ', tagline: 'из Китая и Кореи', scenes: [], cta: 'Подберём ваше авто', channel: '@LegalAutoStore', groupUrl: 't.me/LegalAutoStore', accent: '#D4AF37' } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as CineProps;
        return { durationInFrames: cineDuration((p.scenes || []).slice(0, 6).length || 1) };
      }}
    />
    </>
  );
};

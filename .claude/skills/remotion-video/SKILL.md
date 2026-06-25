---
name: remotion-video
description: How to build and render LegalAuto marketing Reels with Remotion in this repo — compositions, props, fonts, rendering pipeline, and Railway constraints. Use when creating, editing, or rendering vertical video content (Reels/Shorts) for the video factory.
---

# Remotion-Video — видеозавод LegalAuto

Движок видео — Remotion (React). Слайдшоу на ffmpeg больше не используем.

## Где что лежит
- `remotion/index.ts` — registerRoot
- `remotion/Root.tsx` — `<Composition id="CarReel">` + calculateMetadata (длительность от числа фото)
- `remotion/CarReel.tsx` — сама композиция (интро → фото-сцены → цена → CTA)
- `remotion/theme.ts` — палитра, размеры (1080×1920, 30fps), инжект шрифтов
- `remotion/fontsData.ts` — Montserrat (кириллица) в base64 — НЕ через staticFile (даёт 404)
- `agents/videoAgent.js` — `renderReel(props)` (bundle+render) и `extractReelData(text)` (Claude)

## Props (ReelProps)
`{ kind:'car'|'part', brand, model, tagline, specs:[{label,value}], price, priceLabel, location, cta, photos:[url] }`
Данные — строго из одного поста (см. [[context-engineering]]). Тексты — по [[stop-slop]] и [[auto-marketing]].

## Принципы качества
- Фото показывать ЦЕЛИКОМ: `objectFit:contain` поверх размытой `cover`-подложки. Никогда не растягивать.
- Анимации: `spring()` для появлений, `interpolate()` для движения. Плавно, не дёргано.
- Акцент: авто — синий, запчасти — зелёный (theme.car/part).
- Шрифт Montserrat 700/600/400, кириллица обязательна.

## Рендер
- `renderReel(props)` бандлит проект (кэш в процессе) и рендерит mp4.
- На Railway нужен chromium (`PUPPETEER_EXECUTABLE_PATH`) — уже в nixpacks.
- `concurrency:1`, `gl:'swiftshader'` — бережём память. Рендер ~3–5 мин/ролик (софт-GL).
- Ускорение при необходимости: меньше кадров/fps, выше concurrency при наличии RAM, либо вынести рендер в отдельный воркер.

## Чек перед отправкой
1. Текст совпадает с фото (один объект)?
2. Шрифт Montserrat виден (не дефолт)?
3. Фото не растянуто?
4. Один CTA, контакты только LegalAuto?

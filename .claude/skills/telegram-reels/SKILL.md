---
name: telegram-reels
description: Platform format specs for publishing short vertical video (Reels/Shorts/clips) to Telegram, Instagram, and VK — dimensions, duration, captions, hashtags, covers. Use when generating or publishing video content for LegalAuto across these platforms.
---

# Telegram-Reels — форматы площадок

Базовый ролик: **1080×1920 (9:16), H.264, mp4, ≤30 fps, yuv420p, +faststart**. Один мастер-файл → адаптация под площадку.

## Telegram (@LegalAutoStore / @LegalAutoParts24)
- `sendVideo`, `supports_streaming=true`, грузить байтами (не URL).
- Длина: 10–30 сек оптимум. Размер до 50 МБ через Bot API.
- Подпись (caption) до 1024 симв: хук + 2–3 факта + один CTA + 3–5 хэштегов.
- Хэштеги: #пригонавто #автоподключ #BMW (марка) #запчасти — релевантные, не спам.

## Instagram Reels
- 9:16, 3–90 сек, mp4/H.264 + AAC аудио (нужна звуковая дорожка!).
- Публикация через Graph API: нужен Business-аккаунт IG + привязанная FB-страница + долгоживущий токен. Видео отдаётся по ПУБЛИЧНОМУ URL (контейнер → публикация).
- Подпись до 2200 симв, до 30 хэштегов (реально 5–10 целевых).
- Обложка важна — кадр с авто + крупный текст-хук.

## VK (клипы/видео сообщества)
- 9:16 для клипов. Загрузка через `video.save` → upload_url → публикация в сообщество.
- Нужен токен сообщества с правами video. Описание + хэштеги.

## Общие правила
- Хук в первые 2 сек (см. [[auto-marketing]]).
- Звук = половина вовлечения в Reels/клипах: добавить трек/озвучку (пока бесплатно — без копирайта).
- Один объект = один ролик = один CTA, доводящий до заявки ([[lead-capture]]).
- Текст в кадре крупный, читается на телефоне без звука.

## Что нужно от владельца (не делается из кода)
- IG: Business-аккаунт + FB-страница + токен.
- VK: сообщество + токен с правами video.
Эти доступы Эдо выдаёт сам; код активирует публикацию по наличию токенов.

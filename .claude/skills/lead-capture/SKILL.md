---
name: lead-capture
description: Make every LegalAuto post, video, and page drive a measurable lead into a bot or to the manager, with trackable deep links by source. Use when designing CTAs, wiring bot start-params, or adding tracking to content/channels.
---

# Lead-Capture — каждый контент ведёт к заявке

Цель контента — не лайки, а **заявка**. Каждая единица контента имеет один путь к действию и метку источника.

## CTA по типу контента
- Авто (@LegalAutoStore): «Заказ авто → @LegalAuto247»
- Запчасти (@LegalAutoParts24): «Подбор → @LegalAutoAssist_bot»
- Документы (@LegalAuto24): «Оформим СБКТС/ЭПТС → @LegalAuto247»
Один CTA на единицу. Не три. См. [[auto-marketing]].

## Трекинг источника (deep links)
Telegram умеет start-параметры: `https://t.me/LegalAutoAssist_bot?start=SRC`.
- `SRC` кодирует источник: `reel_store`, `parts_post`, `news_doc`, `vk`, `ig`.
- Бот при `/start <SRC>` сохраняет источник в лид (GAS LEADS.source) — видно, какой канал приносит заявки.
- Для каналов-витрин — кнопка-ссылка с нужным `?start=`.

## Что внедрить в коде
1. В clientBot обрабатывать `ctx.startPayload` → писать `source` в заявку (GAS `save_lead`).
2. В постах/роликах CTA-кнопка/ссылка с `?start=<src>`.
3. В аналитике (adminBot/Jarvis) — разрез заявок по `source` (какой контент конвертит).

## Принцип
Нет пути к заявке — контент не публикуем. Каждая заявка должна знать, откуда пришла.

Связано: [[auto-marketing]], [[brand-voice]], [[telegram-reels]].

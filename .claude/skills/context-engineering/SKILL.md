---
name: context-engineering
description: Discipline for binding generated content strictly to source data — extract structured fields from a single source (one listing/post), never hallucinate, never mix data from different objects. Use when turning listings/posts into videos, posts, or catalog entries for LegalAuto.
---

# Context Engineering — данные строго из источника

Правило №1: **контент об объекте берётся ТОЛЬКО из данных этого объекта.**
Главный провал прошлого: фото одной машины — текст про другую. Это запрещено.

## Алгоритм
1. **Один объект = один источник.** Текст и фото берутся из ОДНОГО поста/строки каталога. Не смешивать посты.
2. **Извлекай по полям, строго:** brand, model, year, mileage, engine, drive, price, location. Чего нет в тексте — поля нет (не выдумывай, не «додумывай среднее»).
3. **Валидируй перед рендером:** есть фото? есть цена? бренд непустой? Если нет — пропусти объект или пометь, но не подставляй заглушки как факт.
4. **Числа — как в источнике.** Цену не «нормализуй на глаз»: 2 050 000, а не 2.050.00.
5. **Связь фото↔текст:** в пайплайне фото и текст должны передаваться вместе как один объект `{text, photos}`; никогда не подбирать фото отдельно от текста.

## Применение в коде LegalAuto
- `extractReelData(text)` в `agents/videoAgent.js` — извлекает строго из текста поста.
- `autoAdsAgent.parsePublicFeed` — отдаёт `{text, photos}` одного поста; рендер ролика/поста использует ровно эту пару.
- Чужие контакты вырезаются (`stripForeignContacts`) — это тоже контекст-гигиена.

## Проверка
Перед публикацией: открой фото и текст рядом — это один и тот же объект? Все цифры реально есть в источнике? Нет — стоп.

Связано: [[stop-slop]], [[auto-marketing]], [[remotion-video]].

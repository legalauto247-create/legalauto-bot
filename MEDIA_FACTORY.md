# MEDIA_FACTORY — AI Media Factory платформы LEGAL AUTO

> Каждый ролик — рекламный продукт с темой, а не набор фотографий.
> Стиль: премиальный, технологичный, спокойная уверенность. ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ.

## 1. Архитектура (модуль платформы)

```
                        ┌──────────────────────── MEDIA_FACTORY ───────────────────────┐
 Каталог (Google Sheets)│                                                              │
 ──── gviz CSV ────────►│ ① CATALOG ANALYZER  ② COLLECTIONS ENGINE  ③ STORYBOARD      │
 Партнёрские TG-посты ─►│      скоринг            смысловые темы        сценарист      │
 Новости (RSS) ────────►│                                                              │
                        │ ④ TITLES BINDER  ⑤ MUSIC SELECTOR  ⑥ RENDER ENGINE (Remotion)│
                        │    OEM/цена/совм.    жанр↔бренд        версии платформ       │
                        │                                                              │
                        │ ⑦ QUALITY GATE ──брак──► task failed + доклад Эдо            │
                        │        │ pass                                                │
                        │ ⑧ PUBLISHER (YouTube · Telegram · [Reels · TikTok])          │
                        │ ⑨ ANALYTICS COLLECTOR → Platform State → выбор тем по CTR    │
                        └──────────────────────────────────────────────────────────────┘
 Управление: Jarvis (инструменты) · Автопилот (слоты 11:00/17:00) · Platform State (задачи/статусы)
```

Принцип: **менеджеры = код, AI только там, где нужен смысл** (сценарий, тексты, QA-ревью).
Никаких отдельных AI-агентов-«менеджеров» — один Jarvis сверху, один State снизу.

## 2. Модули (файлы)

| Модуль | Файл | Этап ТЗ |
|---|---|---|
| Catalog Analyzer + Collections Engine | `services/mediaFactory.js` | 1–2 ✅ |
| Storyboard (сценарист) | `agents/contentAgent.js` (Claude HEAVY) | 3 ✅ |
| Titles Binder (OEM/цена/совместимость из каталога, детерминированно) | `agents/contentAgent.js` | 4 ✅ |
| Music Selector (жанр ↔ направление, без повторов) | `pickMusic(genres)` | 5 ✅ |
| Render Engine (композиции по эталонам Эдо) | `remotion/*` + `agents/videoAgent.js` | 6 ✅ |
| Quality Gate (код + LLM-ревью против источника) | `services/qualityGate.js` | 7 ✅ |
| Publisher | `agents/youtubeUpload.js` + TG sendVideo | 7 ✅ |
| Analytics Collector | `services/analyticsCollector.js` | 8 ⏳ (план ниже) |

## 3. Очередь и статусы
Очередь = **Platform State** (`services/stateService.js`, Railway Volume `/data`):
задача `{id, type, source, status: created→processing→done/failed, owner, result, error}`.
Жнец (Health Monitor) добивает зависшие; `failed` → автодоклад Эдо. Дубль — только по команде.

## 4. Пайплайн ролика (production)

```
Триггер (Jarvis / автопилот / новое авто в @LegalAutoStore)
→ createTask(video_*)
→ [нет темы] pickCollection(): скоринг цена·фото·остатки → тема дня без повторов
  [есть тема] themeBuckets(): корзина на каждый термин → round-robin
→ превалидация фото (HEAD, битые URL — вон; деталь без фото — вон; дедуп имён)
→ Storyboard: Claude HEAVY, тема + факты ТОЛЬКО из каталога (состояние/происхождение/цены)
→ Quality Gate ДО рендера (деньги не тратятся на брак)
→ Remotion: композиция по CONTENT_GRAPH (product_v2 / cinematic_v1 / store_shorts)
→ Publisher: YouTube (+deep-link yt_*) · Telegram (кнопка-заявка tg_*)
→ taskDone(url) → отчёт Эдо → markCollectionUsed
```

## 5. JSON-схемы

**Collection** (Collections Engine):
```json
{ "id": "оптика_bmw_x5_x6", "title": "Оптика BMW X5 · X6", "theme": "Оптика",
  "brand": "BMW", "model": "BMW X5 · X6", "score": 34.7, "size": 3,
  "parts": [{ "name": "Фара LED", "oem": "…", "price": 125000,
              "photos": ["…/01.jpg"], "condition": "Оригинал Б/У" }] }
```
**Storyboard** (выход сценариста): `{hook, title, description, items[{photo,photos,name,price,fits}]}`
**Задача State**: см. `services/stateService.js`. **Шаблон**: `templates/*/*.json` (+`metrics{runs,views,ctr,leads}`).

## 6. Правила (зашиты кодом, не пожеланиями)
- ❌ повторяющиеся детали — дедуп по названию в Collections и в корзинах
- ❌ случайные товары — без темы ролик не собирается (коллекция обязательна)
- ❌ битые/отсутствующие фото — HEAD-превалидация каждого URL
- ❌ выдуманные факты — Gate сверяет с каталогом/источником, брак не публикуется
- ✅ тема в заголовке: «Оптика BMW X5 G05», «Передняя часть Geely Atlas»

## 7. API (внутренний, ESM)
```js
buildCollections(parts)            // все темы со скорингом
pickCollection(parts, {platform})  // тема дня без повторов
makeProductShort({theme?, platforms, source})   // коллекция если theme пуст
makeCinematicShort({topic, direction, platforms})
makeCarPromo({text, photos})       // TG-пост → карточка + Shorts
makeNewsCard({newsText})           // новость → эталонная карточка
reviewContent({...})               // Quality Gate
```
Jarvis-инструменты: `make_short`, `make_cinematic`, `media_collections`, `platform_state`, `platform_health`.

## 8. База данных
Сейчас: Google Sheets (каталог, LEADS) + Railway Volume (State, метрики, трекинг тем).
Масштабирование: State-интерфейс не меняется — хранилище подменяется на Postgres/Supabase
одним модулем (`stateService` backend). Схема таблиц: `tasks`, `events`, `collections_used`,
`video_metrics(video_id, platform, views, ctr, avg_view_duration, likes, comments, leads, collected_at)`.

## 9. Этап 8 — Analytics (следующий спринт)
1. `services/analyticsCollector.js`: раз в 6ч YouTube Data API `videos.list(statistics)`
   по видео из State (`result.url`) → `video_metrics` + секция `analytics` в State.
2. Лиды уже метятся источником (`?start=yt_store…`) → CRM: связка видео→заявки.
3. Обратная связь: `pickCollection` читает метрики → темы с высоким CTR/лидами
   получают буст скоринга; шаблоны обновляют `metrics{}` → Jarvis говорит
   «беру news_004 — лучший CTR». Критичное правило: без данных буст = 0 (не выдумывать).

## 10. Масштабирование
- Плоскости независимы: рендер (CPU) можно вынести в отдельный Railway-сервис,
  очередь уже в State (worker забирает `created`-задачи).
- Новая платформа публикации = 1 модуль Publisher (интерфейс: `publish(path, meta) → url`).
- Новое направление бренда = записи в CONTENT_RULES/GRAPH + эталонный лист → JSON.
- Instagram Reels / TikTok: те же 1080x1920 H.264 — нужен только токен платформы.

## 11. Директории
```
services/   mediaFactory.js · qualityGate.js · stateService.js · healthMonitor.js
agents/     contentAgent.js (storyboard+binder) · videoAgent.js (render) · youtubeUpload.js
remotion/   ProductShort · CinematicShort · StoreShorts · StoreCard · PartsCard · NewsPost
brand/      CONTENT_RULES · CONTENT_GRAPH · DESIGN_TOKENS · DESIGN_BRAIN · MOTION_SYSTEM ·
            IMAGE_STYLE_GUIDE · QUALITY_GATE · ASSET_LIBRARY
templates/  news/ parts/ store/ docs/ shorts/  (эталоны Эдо, metrics для CTR-выбора)
```

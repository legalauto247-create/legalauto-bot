# LegalAuto Platform — Контекст проекта для Claude

## Что это
Multi-bot платформа для автомагазина LegalAuto (BMW, Geely, Li Auto).
Хозяин: Эдо (edik23001@gmail.com), Telegram: @legalauto247

## Архитектура
- **Node.js** на Railway, GitHub: `legalauto247-create/legalauto-bot`, ветка `main`
- **Google Apps Script (GAS)** — база данных + REST API
- **Telegram боты**: Admin Bot (@LegalAutoAgentUprav_Bot), Client Bot (@LegalAutoAssist_bot), Publisher Bot (@LegalAutoPartsBot)

## Ключевые URL и ID
- GAS Deployment (браузер): `https://script.google.com/macros/s/AKfycbxo6RlEQZaDIkhFfo6AeHqCR_r2AABdVw3gGu6FVapCxSfsd7KzKwDtR4H05qiE2DbC/exec`
- GAS API для Railway (APPS_SCRIPT_API_URL): `https://script.google.com/macros/s/AKfycbxo6RlEQZaDIkhFfo6AeHqCR_r2AABdVw3gGu6FVapCxSfsd7KzKwDtR4H05qiE2DbC/exec`
- ✅ APPS_SCRIPT_API_URL = exec URL (константа, не меняется при редеплое). Текущая версия: **39** (15 июн. 2026, 16:41)
- GAS Project ID: `1z1jZH4-2oXo8AHaRM3HNuLFApKnG2inuMYVZJZNIppLe3galfysv3FcX`
- Mini App: `https://legalauto247-create.github.io/legalauto-bot/`
- Telegram канал запчастей: `@LegalAutoParts24`
- Railway project: `dfd997c7-1bb9-425f-9938-9281e5239d5a`

## Структура файлов Node.js
```
legalauto-node-bot/
  bots/
    adminBot.js     — бот управления для Эдо
    clientBot.js    — клиентский бот (VIN, поиск, заявки)
    newsBot.js      — бот новостей/RSS
  agents/
    postAgent.js    — автопостинг запчастей в канал
    brainAgent.js   — AI Orchestrator (Claude + Gemini)
    vinDecoder.js   — VIN декодер через NHTSA API
    crmAgent.js     — CRM агент
  index.js          — точка входа, запуск всех ботов
  website/          — GitHub Pages (Mini App, каталог, лендинг)
```

## GAS файлы
- `00_Config.gs` — константы, laSS(), laSheet(), apiJsonResp()
- `01_AI_Brain.gs` — AI анализ
- `02_AdminBot.gs` — **REST API doGet()** — ГЛАВНЫЙ файл для Railway-ботов
- `03_Setup.gs` — настройка
- `04_CatalogAgent.gs` — doGetCatalog() для Mini App
- `05_ClientBot.gs` — клиент
- `06_AutoPost.gs` — автопостинг каждые 30 мин (триггер SETUP_AUTOPOST_3_триггер)
- `07_Analytics.gs` — аналитика
- `08_Marketing.gs` — маркетинг
- `MiniApp.html` — HTML каталог

## Известные баги и их статус
- **GAS → HTML вместо JSON**: Google блокирует Railway IP при обращении к script.google.com → ФИКС: Railway использует прямой URL script.googleusercontent.com (APPS_SCRIPT_API_URL в env vars). Код использует Node.js `https` модуль с ручными редиректами (httpsGetText в adminBot.js, postAgent.js, clientBot.js)
- **node-fetch v3 timeout**: `timeout:` опция игнорируется → не актуально (перешли на https модуль)
- **Mini App 404**: URL имел лишний `/website/` → ФИКС: `https://legalauto247-create.github.io/legalauto-bot/catalog.html`
- **GAS MiniApp.html пустой**: был сломан → ФИКС: теперь редиректит на catalog.html (v37, 15 июн. 2026)
- **postAgent.js MINI_APP_URL**: указывал на `/` (лендинг) → ФИКС: теперь `/catalog.html`
- **Авито**: отложено! Команда `/avito` показывает "временно приостановлено"

## Данные в таблице
- 1378 запчастей в Google Sheet (BMW X7 G07 и др.)
- Фото на Яндекс Облаке: `https://storage.yandexcloud.net/bmw-parts-photos/...`
- `parts_published: 0` — старый скрипт не ставил TRUE, все готовы к публикации

## Что работает
- Автопостинг GAS: триггер `autoPostOne()` каждые 30 мин (задеплоено 14.06.2026 23:09)
- GAS v1.8 (версия 35) с actions: status, health, save_lead, leads, update_lead, cars, save_car, tasks, unpublished, mark_published, add_part, analytics, catalog, avito_feed, miniapp
- Railway: Online, $4.97 / 27 дней осталось (нужна оплата!)

## ПРАВИЛА
- **НИКОГДА не коммитить реальные токены в Git!**
- **.env НЕ коммитить!**
- **Авито отложено** — не трогать пока Эдо не скажет

## Переменные Railway (env vars)
ADMIN_BOT_TOKEN, CLIENT_BOT_TOKEN, NEWS_BOT_TOKEN, ADMIN_CHAT_ID,
APPS_SCRIPT_API_URL, PARTS_CHANNEL, CLAUDE_API_KEY, GEMINI_API_KEY,
NEWS_CHANNEL_ID, MINI_APP_URL

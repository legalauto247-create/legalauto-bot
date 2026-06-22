# 🔑 TOKENS GUIDE — Где взять все ключи

## 1️⃣ EDO_BOT_TOKEN (Telegram Bot)

**Что это?** Токен личного бота Эдо в Telegram (@LegalAuto247_bot)

**Где взять:**
1. Откройте @BotFather в Telegram
2. /newbot
3. Придумайте имя (например "LegalAuto247")
4. Придумайте username (например "@LegalAuto247_bot")
5. BotFather вернет токен вида: `8789664869:AAG3KlYjIvt8L_cvsSi0LV4IAZqTTn_qrhc`

**Где использовать:**
```bash
# .env файл
EDO_BOT_TOKEN=8789664869:AAG3KlYjIvt8L_cvsSi0LV4IAZqTTn_qrhc

# Railway Variables
EDO_BOT_TOKEN = 8789664869:AAG3KlYjIvt8L_cvsSi0LV4IAZqTTn_qrhc
```

**⚠️ ВАЖНО:**
- Это токен БЕЗ кавычек
- Не делитесь этим никому
- Если утекло → /revoke в BotFather и /newbot

---

## 2️⃣ OPENAI_API_KEY (ChatGPT API)

**Что это?** Ключ для использования OpenAI API (гибридная генерация изображений + GPT-4)

**Где взять:**
1. Откройте https://platform.openai.com/account/api-keys
2. Нажмите "+ Create new secret key"
3. Скопируйте ключ вида: `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`

**Где использовать:**
```bash
# .env файл
OPENAI_API_KEY=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

# Railway Variables
OPENAI_API_KEY = sk-proj-...
```

**Цена:**
- Генерация изображений (gpt-image-2): ~$0.02 за изображение
- GPT-4o-mini: ~$0.0015 за 1K input токенов

**Модели доступные:**
```
✅ gpt-image-1, gpt-image-1.5, gpt-image-2 (генерация фото)
✅ gpt-4o-mini (быстрый, дешевый)
✅ gpt-4o (мощный, дороже)
✅ text-embedding-3-small (эмбеддинги)
```

---

## 3️⃣ ANTHROPIC_API_KEY (Claude API)

**Что это?** Ключ для использования Claude (основной AI для обработки текста)

**Где взять:**
1. Откройте https://console.anthropic.com/account/keys
2. Нажмите "Create Key"
3. Скопируйте ключ вида: `sk-ant-v1-Sx8Yd5tVXy4aB9cE2F3g4h5i6j7k8l9m0n1p2q3r4s5t6u7v8w9x0y1z`

**Где использовать:**
```bash
# .env файл
ANTHROPIC_API_KEY=sk-ant-v1-Sx8Yd5tVXy4aB9cE2F3g4h5i6j7k8l9m0n1p2q3r4s5t6u7v8w9x0y1z

# Railway Variables
ANTHROPIC_API_KEY = sk-ant-...
```

**Цена:**
- Claude Haiku: $0.80 за 1M input токенов
- Claude Sonnet: $3 за 1M input токенов
- Claude Opus: $15 за 1M input токенов

**Модели доступные:**
```
✅ claude-3.5-haiku (самый быстрый, дешевый)
✅ claude-3.5-sonnet (сбалансированный)
✅ claude-opus-4 (самый мощный)
```

---

## 4️⃣ GITHUB_TOKEN (GitHub API)

**Что это?** Personal Access Token для доступа к GitHub API (используется в push_jarvis.py)

**Где взять:**
1. Откройте https://github.com/settings/tokens
2. Нажмите "Generate new token (classic)"
3. Дайте название: "LegalAuto Bot"
4. Выберите scopes:
   - `repo` (полный доступ к репозиториям)
   - `user` (доступ к профилю)
5. Создайте и скопируйте токен вида: `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`

**Где использовать:**
```bash
# .env файл (НИКОГДА не в коде!)
GITHUB_TOKEN=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

# Или в Railway Variables
GITHUB_TOKEN = ghp_...

# Затем используется в скрипте:
# python3 push_jarvis.py
```

**⚠️ ВАЖНО:**
- Это токен НИКОГДА не должен быть виден в .py/.html файлах
- Скрипты ДОЛЖНЫ читать из process.env.GITHUB_TOKEN
- Если утекло → удалить на GitHub и создать новый

---

## 5️⃣ ADMIN_BOT_TOKEN (Админ бот) — ОПЦИОНАЛЬНО

**Что это?** Токен отдельного админ-бота для управления (если есть)

**Где взять:**
- Точно так же как EDO_BOT_TOKEN (через @BotFather)

**Где использовать:**
```bash
# .env файл
ADMIN_BOT_TOKEN=... (если используется)

# Если НЕ используется → оставить пустым или не добавлять
```

---

## 6️⃣ CLIENT_BOT_TOKEN (Клиентский бот) — ОПЦИОНАЛЬНО

**Что это?** Токен отдельного бота для клиентов (если есть)

**Где взять:**
- Точно так же как EDO_BOT_TOKEN (через @BotFather)

**Где использовать:**
```bash
# .env файл
CLIENT_BOT_TOKEN=... (если используется)
```

---

## 📋 ПОЛНЫЙ СПИСОК ДЛЯ .env

```bash
# ════════════════════════════════════════════════════════════════
# 🤖 LegalAuto Bot — Complete Configuration
# ════════════════════════════════════════════════════════════════

# Telegram Bots
EDO_BOT_TOKEN=8789664869:AAG3KlYjIvt8L_cvsSi0LV4IAZqTTn_qrhc
ADMIN_BOT_TOKEN=                    # (опционально, если есть)
CLIENT_BOT_TOKEN=                   # (опционально, если есть)

# AI APIs
OPENAI_API_KEY=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
ANTHROPIC_API_KEY=sk-ant-v1-Sx8Yd5tVXy4aB9cE2F3g4h5i6j7k8l9m0n1p2q3r4s5t6u7v8w9x0y1z

# Development Tools
GITHUB_TOKEN=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

# Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Optional: Railway-specific
RAILWAY_ENVIRONMENT_NAME=production
```

---

## 🔐 Безопасность

### Что МОЖНО делать:
```bash
# ✅ Хранить в .env локально
# ✅ Добавить в Railway Variables
# ✅ Использовать через process.env.ПЕРЕМЕННАЯ
# ✅ Ротировать (удалить старый, создать новый)
```

### Что НЕЛЬЗЯ делать:
```bash
# ❌ Писать в коде: const API_KEY = 'sk-proj-...'
# ❌ Коммитить .env файл в Git
# ❌ Логировать токены: console.log(API_KEY)
# ❌ Отправлять по чату
# ❌ Делиться с неверным людям
```

---

## 🆘 Если токен утекет

### GitHub Token:
1. https://github.com/settings/tokens → Delete
2. Создать новый
3. Обновить в .env
4. Обновить в Railway Variables
5. Пушить код (Railway перезапустится)

### OpenAI Key:
1. https://platform.openai.com/account/api-keys → Delete
2. Создать новый
3. Обновить в .env
4. Обновить в Railway Variables
5. Пушить код

### Anthropic Key:
1. https://console.anthropic.com/account/keys → Delete
2. Создать новый
3. Обновить в .env
4. Обновить в Railway Variables
5. Пушить код

### Telegram Token:
1. @BotFather → /revoke
2. /newbot
3. Скопировать новый токен
4. Обновить в .env
5. Обновить в Railway Variables
6. Пушить код

---

## 💰 Стоимость в месяц (примерно)

| Сервис | Использование | Цена |
|--------|-----------|-------|
| OpenAI Image Gen | 100 изображений | $2 |
| OpenAI GPT-4o-mini | 100K токенов | $0.15 |
| Claude Haiku | 1M токенов | $0.80 |
| Telegram Bot | Unlimited | $0 |
| GitHub | Public repo | $0 |
| Railway | Hosting | $5-10 |
| **ИТОГО** | | **~$8-13/месяц** |

---

## ✅ Checklist

Перед тем как запустить проект:

- [ ] EDO_BOT_TOKEN скопирован
- [ ] OPENAI_API_KEY скопирован  
- [ ] ANTHROPIC_API_KEY скопирован
- [ ] GITHUB_TOKEN скопирован (опционально)
- [ ] .env файл создан (`cp .env.example .env`)
- [ ] Все значения вставлены в .env
- [ ] .env добавлен в .gitignore
- [ ] Railway Variables заполнены (для production)
- [ ] Код пушнут в main
- [ ] Railway deployment успешен ✅

---

**Последнее обновление:** 2026-06-22
**Версия:** 1.0


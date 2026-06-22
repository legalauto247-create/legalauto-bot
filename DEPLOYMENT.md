# 🚀 DEPLOYMENT GUIDE — LegalAuto Jarvis

## Быстрый старт (5 минут)

### Локально (для разработки)

```bash
# 1. Перейти в проект
cd /Users/edikkyrsnya/Desktop/legalauto-core

# 2. Создать .env из примера
cp .env.example .env

# 3. Открыть .env в редакторе и добавить реальные токены
nano .env
# или vim .env / code .env

# 4. Убедиться что файл не будет закоммичен
git status | grep ".env"  # Не должен выводить ".env"

# 5. Перейти в директорию бота и установить зависимости
cd legalauto-node-bot
npm install

# 6. Запустить локально
node index.js
```

---

## Production (Railway)

### Шаг 1: Убедиться что код чистый
```bash
# Проверить что нет токенов в коде
git log -S "ghp_" --source --all-match
git log -S "sk-proj" --source --all-match

# Если нашли → немедленно ротировать и очистить историю!
```

### Шаг 2: Добавить Variables на Railway

1. Открыть https://railway.app
2. Выбрать проект LegalAuto
3. Перейти в Settings → Variables
4. Добавить каждый ключ:

```
EDO_BOT_TOKEN         = 8789664869:AAG3KlYjIvt8L_...
ADMIN_BOT_TOKEN       = (если есть)
CLIENT_BOT_TOKEN      = (если есть)
OPENAI_API_KEY        = sk-proj-8y4F7uNJ4ASfMCKRRWbtH3-...
ANTHROPIC_API_KEY     = sk-ant-...
GITHUB_TOKEN          = ghp_... (если нужно)
NODE_ENV              = production
PORT                  = 3000
LOG_LEVEL             = info
```

### Шаг 3: Пушить в main (auto-deploy)
```bash
git add .
git commit -m "feat: update code for production"
git push origin main

# Railway автоматически:
# 1. Скачает код из GitHub
# 2. Установит dependencies
# 3. Запустит node index.js
# 4. Инжектирует Variables в контейнер
```

### Шаг 4: Проверить логи
```bash
# На railway.app → Logs вкладка
# Должно быть:
# ✅ Admin bot started
# ✅ Client bot started
# ✅ Partner Agent "Макс" инициализирован
```

---

## 🐛 Troubleshooting

### Проблема: "EDO_BOT_TOKEN не задан"
**Решение:**
```bash
# Локально: убедиться что .env существует
ls -la .env

# На Railway: убедиться что Variable добавлена
# Settings → Variables → EDO_BOT_TOKEN = ваше_значение
```

### Проблема: "Bot not responding to messages"
**Решение:**
```bash
# Проверить что токен правильный
# Скопировать из @BotFather и убедиться что нет лишних пробелов
# EDO_BOT_TOKEN = 8789664869:AAG3KlYjIvt8L_... (без кавычек!)
```

### Проблема: Image generation зависает
**Решение:**
```bash
# Это известная проблема с gpt-image-2
# Варианты:
# 1. Увеличить timeout в imageGenAgent.js
# 2. Переключиться на Stability AI (бесплатный tier)
# 3. Использовать DALL-E 3 через другой endpoint
```

### Проблема: "Cannot find module '@anthropic-ai/sdk'"
**Решение:**
```bash
cd legalauto-node-bot
npm install @anthropic-ai/sdk
```

---

## 📊 Мониторинг

### Логи
```bash
# Локально:
node index.js 2>&1 | tee bot.log

# На Railway:
railway.app → Logs
```

### Метрики
```bash
# Отправить брифинг
POST /edo/briefing

# Проверить статус
curl http://localhost:3000/health

# или на Railway:
curl https://your-railway-app.up.railway.app/health
```

---

## 🔄 Updates и автоматический деплой

Railway **автоматически** перезапускает бота когда ты пушишь в main:

```bash
# 1. Сделать изменение в коде
vim agents/imageGenAgent.js

# 2. Закоммитить
git add agents/imageGenAgent.js
git commit -m "fix: improve image generation timeout"

# 3. Пушить
git push origin main

# 4. Railway видит push и автоматически:
#    - Скачивает новый код
#    - Пересобирает контейнер
#    - Перезапускает бота
#    - Это займет 30-60 секунд
```

**Проверить что деплой успешен:**
```bash
# На railway.app → Deployments → View latest
# Должна быть зеленая галочка ✅
```

---

## 🛡️ Безопасность в Production

### Что делать:
- ✅ Все токены в Railway Variables (НЕ в коде)
- ✅ .env в .gitignore
- ✅ Использовать https (Railway предоставляет бесплатно)
- ✅ Включить GitHub Secret Scanning
- ✅ Регулярно ротировать токены

### Что НЕ делать:
- ❌ Коммитить .env файлы
- ❌ Писать токены в коде
- ❌ Логировать токены
- ❌ Делиться ключами по чату
- ❌ Использовать personal access tokens с admin правами

---

## 💾 Backup и Восстановление

### Если что-то сломалось:

```bash
# 1. Откатиться на предыдущий commit
git revert HEAD
git push origin main

# 2. Railway автоматически вернет старую версию

# 3. Если надо откатиться еще дальше
git log --oneline | head -10
# Выбрать нужный commit
git revert COMMIT_HASH
git push origin main
```

### Если потерялись токены:

```bash
# 1. Ротировать на GitHub.com, OpenAI, Anthropic
# 2. Обновить Railway Variables
# 3. Railway перезапустит контейнер с новыми ключами
```

---

## 🧹 Очистка

### Удалить все данные (если нужно полностью пересоздать):

```bash
# На Railway: убить контейнер
# railway.app → Settings → Danger Zone → Remove Service

# Создать новый сервис
# railway.app → New → GitHub Repo

# Добавить Variables заново
# И пушить код
```

---

## 📝 Checklist перед Production

- [ ] .env в .gitignore
- [ ] Все токены НЕ в коде
- [ ] .env.example создан (только примеры)
- [ ] Railway Variables установлены
- [ ] Код запушен в main
- [ ] Railway deployment ✅ (зеленая галочка)
- [ ] Бот отвечает на сообщения
- [ ] Логи не содержат ошибок
- [ ] GitHub Secret Scanning включен

---

## 🆘 Emergency

Если бот упал и не восстанавливается:

```bash
# 1. Проверить Railway статус
# railway.app → Deployment logs

# 2. Если есть ошибка → посмотреть точный текст ошибки
# Часто это "variable not found" → проверить Variables

# 3. Откатиться на предыдущий commit
git revert HEAD
git push origin main

# 4. Если совсем плохо → удалить и создать заново
# (см. выше "Очистка")
```

---

**Документ обновлен:** 2026-06-22
**Версия:** 1.0
**Статус:** 🟢 ГОТОВО К ИСПОЛЬЗОВАНИЮ


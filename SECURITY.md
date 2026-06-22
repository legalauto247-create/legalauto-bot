# 🔐 SECURITY GUIDELINES — LegalAuto Jarvis

## ⚠️ КРИТИЧЕСКИЕ ПРАВИЛА

### 1. НИКОГДА не коммитить токены в Git
```
❌ НЕПРАВИЛЬНО:
const TOKEN = 'ghp_xyz123abc456...';
export const API_KEY = 'sk-proj-123456...';

✅ ПРАВИЛЬНО:
const TOKEN = process.env.GITHUB_TOKEN;
const API_KEY = process.env.OPENAI_API_KEY;
```

### 2. .env файл ВСЕГДА в .gitignore
```bash
# .gitignore должен содержать:
.env
.env.local
.env.*.local
*.env
!.env.example  # МОЖНО коммитить пример
```

### 3. Если токен утек — сразу ротировать
```bash
# Проверить историю Git на утечки
git log -S "sk-proj" --source --all-match  # OpenAI ключи
git log -S "ghp_" --source --all-match     # GitHub токены
git log -S "sk-ant" --source --all-match   # Anthropic ключи

# Если нашли:
1. Ротировать токен немедленно
2. Пересоздать всех с новыми ключами
3. Запустить git filter-branch чтобы очистить историю
```

---

## 📁 Правильная структура проекта

```
/legalauto-core/
├── .env                    ← ❌ НЕ коммитить (локально)
├── .env.example            ← ✅ МОЖНО коммитить (пример)
├── .gitignore              ← ✅ ДОЛЖЕН содержать .env
├── SECURITY.md             ← ✅ Этот файл (инструкции)
├── legalauto-node-bot/
│   ├── index.js
│   ├── agents/
│   ├── bots/
│   └── package.json
└── push_jarvis.py          ← ✅ Теперь читает из .env
```

---

## 🚀 Как запустить проект локально

### Шаг 1: Создать .env файл
```bash
cd /Users/edikkyrsnya/Desktop/legalauto-core
cp .env.example .env
```

### Шаг 2: Добавить реальные значения в .env
```bash
# Открыть .env в редакторе и заполнить:
EDO_BOT_TOKEN=8789664869:AAG3KlYjIvt8L_cvsSi0LV4IAZqTTn_qrhc
OPENAI_API_KEY=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
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
```

### Шаг 3: Убедиться что .env в .gitignore
```bash
cat .gitignore | grep ".env"
# Должно вывести: .env ✅
```

### Шаг 4: Установить dependencies и запустить
```bash
cd legalauto-node-bot
npm install
node index.js
```

---

## 🔐 Railway (Production)

**Добавить переменные в Railway dashboard:**

1. Открыть railway.app
2. Выбрать проект → Variables
3. Добавить каждый ключ отдельно:
   - `EDO_BOT_TOKEN` = `8789664869:...`
   - `OPENAI_API_KEY` = `sk-proj-...`
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
   - `GITHUB_TOKEN` = `ghp_...` (если скрипт запускается на Railway)

**Важно:** Railway Variables автоматически инжектируются в контейнер. Git никогда их не видит.

---

## 🔄 GitHub Secret Scanning

GitHub автоматически сканирует историю на утечки ключей:

✅ **Если утечка найдена:**
```
GitHub будет блокировать коммиты с настоящими ключами
Warning: ghp_xxx was found in the repository history
```

**Решение:**
```bash
# 1. Ротировать токен на GitHub.com
# 2. Очистить историю Git
git filter-branch --tree-filter 'rm -f .env' HEAD

# 3. Пушить очищенную историю
git push -f origin main
```

---

## 📝 Правила для разработчиков

### ✅ ДА:
- Читать переменные из `process.env.VAR_NAME`
- Хранить примеры в `.env.example` (БЕЗ реальных значений)
- Использовать Railway Variables для продакшена
- Проверять `.gitignore` перед каждым коммитом

### ❌ НЕТ:
- Писать токены прямо в коде
- Коммитить `.env` файлы
- Делиться ключами по чату
- Логировать чувствительные данные (особенно в production)
- Пушить файлы с расширением `.key`, `.pem`, `.token`

---

## 🚨 Emergency Procedures

### Если ключ скомпрометирован:

1. **Немедленно:**
   ```bash
   # Ротировать на GitHub/OpenAI/Anthropic
   # (идти на сайты и нажать "Revoke")
   ```

2. **В Git:**
   ```bash
   # Очистить историю
   git filter-branch --tree-filter 'sed -i "s/YOUR_OLD_KEY/REDACTED/g" *' -- --all
   git push -f
   ```

3. **В Railway:**
   ```
   Обновить все Variables с новыми ключами
   Railway перезапустит контейнер автоматически
   ```

4. **Скрипты:**
   ```bash
   # Обновить .env локально
   # Обновить push_jarvis.py чтобы он читал из .env
   # Проверить что никакой скрипт не логирует токены
   ```

---

## 📊 Audit Checklist

Перед каждым пушем в main:

- [ ] `.env` НЕ в коммите (`git diff --cached | grep -E "TOKEN|KEY|PASS"`)
- [ ] `.env` в `.gitignore`
- [ ] Нет логирования токенов в коде
- [ ] Все API вызовы используют `process.env.*`
- [ ] `.env.example` содержит ТОЛЬКО примеры
- [ ] Railway Variables установлены в dashboard
- [ ] Последний коммит НЕ содержит токенов

```bash
# Проверить чистоту коммита:
git diff --cached | grep -E "TOKEN|KEY|PASS|sk-proj|ghp_|sk-ant"
# Если ничего не выводит → ✅ Безопасно пушить
```

---

## 📚 Дополнительные ресурсы

- [GitHub: Configuring secret scanning](https://docs.github.com/en/code-security/secret-scanning)
- [OWASP: Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Railway: Environment Variables](https://railway.app/docs/develop/variables)
- [Node.js: process.env](https://nodejs.org/en/knowledge/file-system/security/introduction/)

---

**Дата создания:** 2026-06-22
**Версия:** 1.0
**Статус:** 🟢 АКТИВНЫЙ


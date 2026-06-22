/**
 * LEGALAUTO CORE v1.3
 * Файл: 01_AI_Brain.gs
 *
 * Роутер AI:
 *   laAskAI(system, user)          → Gemini (бесплатно, быстро)
 *   laAskAI(system, user, "claude") → Claude Sonnet (качественно, платно)
 *
 * Когда использовать Claude:
 *   - Консультации по СБКТС / ЭПТС / таможне (точность важна)
 *   - Генерация постов для канала
 *   - Сложные вопросы клиентов
 */

function laAskAI(systemPrompt, userMessage, provider) {
  const p = provider || LA.AI_PROVIDER || "gemini";
  if (p === "claude") {
    return laAskClaude(systemPrompt, userMessage);
  }
  return laAskGemini(systemPrompt, userMessage);
}

// ─── CLAUDE (Anthropic) ──────────────────────────────────────────────────────

function laAskClaude(systemPrompt, userMessage, maxTokens) {
  var apiKey;
  try { apiKey = laSecret(LA.SECRETS.CLAUDE_API_KEY); }
  catch(e) { return "⚠️ CLAUDE_API_KEY не задан."; }

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens || 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }]
  };

  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const raw  = response.getContentText();

  if (code !== 200) {
    laSafeLog("ERROR", "AI", "Claude error", { code: code, body: raw.substring(0, 300) });
    return "⚠️ Claude временно недоступен. Код: " + code;
  }

  try {
    return JSON.parse(raw).content[0].text.trim();
  } catch(e) {
    laSafeLog("ERROR", "AI", "Claude parse error", { body: raw.substring(0, 200) });
    return "⚠️ Claude вернул пустой ответ.";
  }
}

// ─── ДИАЛОГ С ПАМЯТЬЮ (для клиентского бота) ────────────────────────────────
// history = [{role:"user"|"assistant", content:"..."}]

function laAskClaudeDialog(systemPrompt, history, maxTokens) {
  var apiKey;
  try { apiKey = laSecret(LA.SECRETS.CLAUDE_API_KEY); }
  catch(e) { return "⚠️ CLAUDE_API_KEY не задан."; }

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens || 800,
    system: systemPrompt,
    messages: history
  };

  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const raw  = response.getContentText();

  if (code !== 200) {
    laSafeLog("ERROR", "AI", "Claude dialog error", { code: code, body: raw.substring(0, 300) });
    return null; // null = ошибка, вызывающий код обработает
  }

  try {
    return JSON.parse(raw).content[0].text.trim();
  } catch(e) {
    return null;
  }
}

function laAskGemini(systemPrompt, userMessage) {
  const apiKey = laSecret(LA.SECRETS.GEMINI_API_KEY);

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    LA.GEMINI_MODEL +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userMessage }]
      }
    ],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 900
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const raw = response.getContentText();

  if (code !== 200) {
    laLog("ERROR", "AI", "Gemini error", { code: code, body: raw });
    return "⚠️ AI временно недоступен. Ошибка Gemini.";
  }

  const data = JSON.parse(raw);

  try {
    return data.candidates[0].content.parts[0].text.trim();
  } catch (e) {
    laLog("ERROR", "AI", "Gemini parse error", { body: raw });
    return "⚠️ AI вернул пустой ответ.";
  }
}

function TEST_AI() {
  const answer = laAskAI(
    "Ты помощник LegalAuto. Отвечай кратко.",
    "Проверка связи. Ты работаешь?"
  );

  Logger.log(answer);
}
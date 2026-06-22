/**
 * LegalAuto — AI Brain Orchestrator v1.0
 *
 * Мозг платформы: координирует всех агентов, квалифицирует лиды,
 * проводит утренний брифинг, консультирует клиентов автоматически.
 *
 * Экспорты:
 *   qualifyLead(leadData)                       — AI-оценка лида (горячий/холодный)
 *   runMorningBriefing(telegram, adminChatId)   — утренний AI-брифинг 9:00 МСК
 *   askBrain(question, context)                 — AI-запрос с контекстом платформы
 *   autoReplyToClient(clientData, botToken)     — AI-ответ клиенту до взятия в работу
 *   formatLeadQualification(result)             — форматирует оценку для Telegram
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const {
  CLAUDE_API_KEY,
  GEMINI_API_KEY,
  APPS_SCRIPT_API_URL,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// ── GAS API хелпер ────────────────────────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!APPS_SCRIPT_API_URL) return null;
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res  = await fetch(url.toString(), { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalAutoBot/1.0)' } });
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    console.error(`[Brain] gasGet(${action}) error:`, e.message);
    return null;
  }
}

// ── Вызов Claude с fallback на Gemini ────────────────────────────────────────
async function callAI(system, userMsg, maxTokens = 600) {
  // Сначала пробуем Claude
  if (claude) {
    try {
      const msg = await claude.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages:   [{ role: 'user', content: userMsg }],
      });
      return msg.content[0].text.trim();
    } catch (e) {
      console.warn('[Brain] Claude error, trying Gemini:', e.message);
    }
  }
  // Fallback: Gemini
  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        contents: [{ parts: [{ text: system + '\n\n' + userMsg }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      };
      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (e) {
      console.error('[Brain] Gemini fallback error:', e.message);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LEAD QUALIFIER
// ─────────────────────────────────────────────────────────────────────────────

const QUALIFY_SYSTEM = `Ты AI-квалификатор лидов для автосервиса LegalAuto.
Специализация: сертификация и оформление б/у автомобилей (СБКТС, ЭПТС), запчасти BMW/Geely/Li Auto.

Получаешь данные о новом лиде и возвращаешь JSON-оценку:
{
  "temperature": "горячий" | "тёплый" | "холодный",
  "priority": 1-10,
  "urgency": "срочно" | "в течение дня" | "не горит",
  "estimatedValue": "высокая" | "средняя" | "низкая",
  "suggestedAction": "одно чёткое действие которое нужно сделать прямо сейчас",
  "reason": "одна фраза почему такая оценка"
}

Критерии горячего лида: упоминает конкретную марку/модель, уже имеет авто, готов к оформлению, спрашивает стоимость/сроки.
Критерии холодного: просто интересуется, общие вопросы, нет конкретики.

Отвечай ТОЛЬКО JSON без markdown.`;

/**
 * Квалифицирует лид с помощью AI
 * @param {object} leadData - { service, car, client, phone, summary, username }
 * @returns {object} - { temperature, priority, urgency, estimatedValue, suggestedAction, reason }
 */
export async function qualifyLead(leadData) {
  const userMsg = `Лид:
Услуга: ${leadData.service || '—'}
Авто: ${leadData.car || '—'}
Клиент: ${leadData.client || leadData.username || '—'}
Телефон: ${leadData.phone || '—'}
Запрос: ${leadData.summary || '—'}`;

  const raw = await callAI(QUALIFY_SYSTEM, userMsg, 300);
  if (!raw) {
    return {
      temperature: 'тёплый',
      priority: 5,
      urgency: 'в течение дня',
      estimatedValue: 'средняя',
      suggestedAction: 'Связаться с клиентом и уточнить детали',
      reason: 'AI недоступен — стандартная оценка',
    };
  }
  try {
    // Убираем возможный markdown code block
    const clean = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      temperature: 'тёплый',
      priority: 5,
      urgency: 'в течение дня',
      estimatedValue: 'средняя',
      suggestedAction: 'Связаться с клиентом и уточнить детали',
      reason: raw.slice(0, 100),
    };
  }
}

/**
 * Форматирует оценку лида для отправки в Telegram
 */
export function formatLeadQualification(q) {
  const tempEmoji = {
    'горячий': '🔥',
    'тёплый':  '🌡',
    'холодный':'🧊',
  }[q.temperature] || '📊';

  const valueEmoji = {
    'высокая': '💎',
    'средняя': '💰',
    'низкая':  '💵',
  }[q.estimatedValue] || '💰';

  return (
    `\n🧠 *AI Квалификация:*\n` +
    `${tempEmoji} ${q.temperature.toUpperCase()} · Приоритет: ${q.priority}/10\n` +
    `⏱ ${q.urgency} · ${valueEmoji} Ценность: ${q.estimatedValue}\n` +
    `💡 ${q.suggestedAction}\n` +
    `_${q.reason}_`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MORNING BRIEFING
// ─────────────────────────────────────────────────────────────────────────────

const BRIEFING_SYSTEM = `Ты AI-аналитик бизнеса LegalAuto — автосервис сертификации и запчастей.
Готовишь утренний брифинг для владельца (Эдо).

На основе данных платформы дай чёткий бизнес-анализ в формате:

🎯 ГЛАВНОЕ НА СЕГОДНЯ
[3 пункта — самое важное что нужно сделать]

📊 СИТУАЦИЯ
[2-3 предложения о текущем состоянии бизнеса]

🔥 ГОРЯЧИЕ ЛИДЫ
[список активных лидов требующих внимания]

💡 AI РЕКОМЕНДАЦИЯ
[одна конкретная рекомендация по росту/оптимизации]

Пиши кратко, по делу, на русском. Без лишних слов.`;

/**
 * Запускает утренний AI-брифинг
 * @param {object} telegram - Telegraf telegram instance
 * @param {string} adminChatId
 */
export async function runMorningBriefing(telegram, adminChatId) {
  if (!adminChatId) return;
  console.log('[Brain] Running morning briefing...');

  try {
    // Собираем данные из GAS
    const [statusData, leadsData, carsData] = await Promise.all([
      gasGet('status'),
      gasGet('leads'),
      gasGet('cars'),
    ]);

    const leads = leadsData?.leads || [];
    const cars  = carsData?.cars  || [];
    const now   = Date.now();
    const day   = 24 * 60 * 60 * 1000;

    // Фильтруем активные лиды (за последние 7 дней)
    const weekLeads = leads.filter(l => l.created_at && (now - new Date(l.created_at).getTime()) < 7 * day);
    const newToday  = leads.filter(l => l.created_at && (now - new Date(l.created_at).getTime()) < day);

    // Активные авто (не "готово" и не "выдано")
    const activeCars = cars.filter(c => {
      const s = (c.stage || '').toLowerCase();
      return !s.includes('готов') && !s.includes('выдач') && !s.includes('закрыт');
    });

    // Формируем контекст для AI
    const dataContext = `
Данные платформы на ${new Date().toLocaleDateString('ru-RU')}:

ЗАПЧАСТИ:
- Всего: ${statusData?.parts_total || '?'}
- Опубликовано: ${statusData?.parts_published || '?'}

ЛИДЫ:
- За сегодня: ${newToday.length}
- За неделю: ${weekLeads.length}
- Всего в базе: ${leads.length}

АКТИВНЫЕ АВТО В РАБОТЕ (${activeCars.length} шт):
${activeCars.slice(0, 8).map(c => `- ${c.car || '—'} | ${c.client || '—'} | этап: ${c.stage || '—'} | ${c.note ? c.note.slice(0, 50) : ''}`).join('\n') || 'нет активных'}

НОВЫЕ ЗАЯВКИ СЕГОДНЯ:
${newToday.length === 0 ? 'нет' : newToday.map(l => `- ${l.client_name || l.username || '—'}: ${(l.request || '').slice(0, 80)}`).join('\n')}

ЗАЯВКИ ЗА НЕДЕЛЮ:
${weekLeads.slice(0, 5).map(l => `- ${l.client_name || '—'}: ${(l.request || '').slice(0, 60)} | статус: ${l.status || 'новая'}`).join('\n') || 'нет'}
`;

    const briefingText = await callAI(BRIEFING_SYSTEM, dataContext, 800);

    const header = `☀️ *Доброе утро, Эдо!*\n_${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}_\n\n`;
    const footer = `\n\n_Следующий брифинг завтра в 09:00 МСК_`;

    await telegram.sendMessage(
      adminChatId,
      header + (briefingText || '⚠️ AI недоступен — проверь подключение.') + footer,
      { parse_mode: 'Markdown' }
    );

    console.log('[Brain] ✅ Morning briefing sent');
  } catch (e) {
    console.error('[Brain] Morning briefing error:', e.message);
    await telegram.sendMessage(
      adminChatId,
      `☀️ *Доброе утро!* Брифинг не удалось загрузить: ${e.message}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AI AUTO-REPLY TO CLIENT
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_REPLY_SYSTEM = `Ты AI-консультант LegalAuto. Помогаешь клиентам с:
- Сертификацией б/у авто из Китая и других стран (СБКТС, ЭПТС, ПТС)
- Запчастями для BMW, Geely, Li Auto, Toyota, Mercedes и других марок
- Подбором запчастей по OEM-номерам
- Информацией о процессе оформления документов

Отвечай по-русски, дружелюбно, кратко (2-4 предложения).
Если вопрос специфический — скажи что передашь менеджеру.
НЕ называй конкретные цены (скажи "уточним индивидуально").
Завершай ответ приглашением оставить заявку или уточнить детали.`;

/**
 * Генерирует AI-ответ клиенту
 * @param {object} clientData - { message, car, service, username }
 * @param {string} botToken - CLIENT_BOT_TOKEN
 * @param {string} chatId - chat_id клиента
 */
export async function autoReplyToClient(clientData, botToken, chatId) {
  if (!botToken || !chatId) return;

  const userMsg = clientData.message || '';
  if (!userMsg || userMsg.length < 5) return;

  const context = [
    clientData.car     && `Авто клиента: ${clientData.car}`,
    clientData.service && `Интересует: ${clientData.service}`,
  ].filter(Boolean).join('\n');

  const prompt = context ? `${context}\n\nВопрос: ${userMsg}` : userMsg;

  const reply = await callAI(CLIENT_REPLY_SYSTEM, prompt, 200);
  if (!reply) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    String(chatId),
        text:       reply,
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(8000),
    });
    console.log('[Brain] autoReply sent to', chatId);
  } catch (e) {
    console.error('[Brain] autoReply send error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GENERAL BRAIN QUERY (для admin /brain команды)
// ─────────────────────────────────────────────────────────────────────────────

const BRAIN_SYSTEM = `Ты AI-директор LegalAuto — платформы сертификации и запчастей.
Знаешь весь бизнес: CRM, склад запчастей, клиенты, агенты.
Отвечаешь кратко и конкретно. Даёшь чёткие рекомендации.
Если нужны данные которых нет — скажи что именно нужно проверить.`;

/**
 * Общий AI-запрос с контекстом платформы
 * @param {string} question
 * @param {object} context - дополнительный контекст (leads, cars, stats...)
 * @returns {string}
 */
export async function askBrain(question, context = {}) {
  const ctxLines = Object.entries(context)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v}`)
    .join('\n');

  const prompt = ctxLines ? `Контекст:\n${ctxLines}\n\nВопрос: ${question}` : question;
  const answer = await callAI(BRAIN_SYSTEM, prompt, 500);
  return answer || '⚠️ AI временно недоступен. Попробуй позже.';
}

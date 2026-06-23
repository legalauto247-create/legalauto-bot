// ============================================================
// LEGAL AUTO — Dual Brain Agent
// Мозг 1: Claude (анализ, творчество, стратегия)
// Мозг 2: GPT-4o (перекрёстная проверка, альтернатива)
// Синтез: Claude выбирает лучшее из двух ответов
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import { getMemory } from './memoryAgent.js';

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });

const GPT_API_URL = 'https://api.openai.com/v1/chat/completions';
const GPT_MODEL   = 'gpt-4o-mini'; // экономичная но мощная модель

// ── Спросить Claude ────────────────────────────────────────────────────────
async function askClaude(systemPrompt, userMessage, maxTokens = 600) {
  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.error('[DualBrain] Claude error:', e.message);
    return null;
  }
}

// ── Спросить GPT-4o-mini ──────────────────────────────────────────────────
async function askGPT(systemPrompt, userMessage, maxTokens = 600) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch(GPT_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:      GPT_MODEL,
        max_tokens: maxTokens,
        messages:   [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
      }),
    });
    const data = await res.json();
    if (data.error) { console.error('[DualBrain] GPT error:', data.error.message); return null; }
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[DualBrain] GPT fetch error:', e.message);
    return null;
  }
}

// ── Синтез: Claude выбирает лучшее из двух ───────────────────────────────
async function synthesize(question, claudeAnswer, gptAnswer) {
  if (!gptAnswer) return claudeAnswer;
  if (!claudeAnswer) return gptAnswer;

  const prompt = `Тебе нужно синтезировать лучший ответ на вопрос, опираясь на два варианта.

Вопрос: ${question}

Вариант A (Claude): ${claudeAnswer}

Вариант B (GPT): ${gptAnswer}

Задача: Возьми самое точное и полезное из обоих ответов. Напиши итоговый ответ — короткий, конкретный, без упоминания что это синтез или какой вариант лучше.`;

  return await askClaude(
    'Ты синтезатор — создаёшь лучший ответ из нескольких вариантов. Отвечай кратко и по делу.',
    prompt,
    800
  ) || claudeAnswer;
}

// ══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════════════

/**
 * Сгенерировать продающий текст поста (для канала/рассылки)
 * Оба мозга пишут версию, Claude синтезирует лучшую
 */
export async function generateSalesPost(topic, context = '') {
  // Тянем актуальный контекст бизнеса из памяти
  let mem;
  try { mem = getMemory(); } catch { mem = null; }

  const managerUsername = process.env.MANAGER_USERNAME || 'LegalAuto247';
  const clientBot       = '@LegalAutoAssist_bot';
  const channel         = mem?.business?.channel || '@LegalAuto24';
  const learnedFacts    = mem?.learnedFacts?.slice(-10).map(f => `• ${f.fact}`).join('\n') || '';

  const system = `Ты — контент-маркетолог магазина автозапчастей LegalAuto.

БИЗНЕС:
• Магазин: LegalAuto — продаём оригинальные и б/у запчасти с разборок для иномарок
• Марки: BMW, Mercedes-Benz, Audi, Toyota, Geely, Li Auto, Chery, Haval, Kia, Hyundai
• Канал: ${channel}
• Бот для клиентов: ${clientBot}
• Менеджер: @${managerUsername}
• Сайт: legalauto.online
• Доставка: по всей России, работаем быстро

${learnedFacts ? `ВАЖНЫЕ ФАКТЫ О БИЗНЕСЕ:\n${learnedFacts}\n` : ''}
ПРАВИЛА ПОСТА:
• Длина: 5-8 строк, не больше
• 3-4 эмодзи в начале абзацев — не в середине предложений
• Стиль: как эксперт который сам ездит на этих машинах, живо и без рекламной шелухи
• Конкретика: называй марки, детали, цены если уместно
• В конце ВСЕГДА: призыв написать в ${clientBot} или менеджеру @${managerUsername}
• НЕ используй хэштеги
• Markdown: *жирный* для заголовка, _курсив_ для акцентов
• Пиши на русском, можно сленг автомобилистов`;

  const question = `Напиши продающий пост на тему: "${topic}".${context ? ' ' + context : ''}`;

  const [claudeAnswer, gptAnswer] = await Promise.all([
    askClaude(system, question, 600),
    askGPT(system, question, 600),
  ]);

  return await synthesize(question, claudeAnswer, gptAnswer);
}

/**
 * Ответ клиенту на сложный вопрос
 * Claude — тёплый и экспертный, GPT — точный и фактический
 */
export async function dualAnswer(clientQuestion, context = '') {
  const managerUsername = process.env.MANAGER_USERNAME || 'LegalAuto247';
  const system = `Ты менеджер магазина запчастей LegalAuto. Отвечаешь клиентам коротко и по делу.
Магазин продаёт оригинальные и б/у запчасти для иномарок (BMW, Mercedes, Audi, Toyota, Geely, Li Auto).
Доставка по всей России. Для связи: @LegalAutoAssist_bot или менеджер @${managerUsername}. ${context}`;

  const [claudeAnswer, gptAnswer] = await Promise.all([
    askClaude(system, clientQuestion, 400),
    askGPT(system, clientQuestion, 400),
  ]);

  return await synthesize(clientQuestion, claudeAnswer, gptAnswer);
}

/**
 * Бизнес-решение (стратегия, анализ ситуации)
 * Используется в masterAgent для принятия сложных решений
 */
export async function businessDecision(situation, options = []) {
  const system = `Ты бизнес-аналитик для малого бизнеса по продаже автозапчастей.
Анализируешь ситуации, предлагаешь конкретные действия. Без воды — только факты и шаги.`;

  const optText = options.length ? `\nВарианты: ${options.join(' / ')}` : '';
  const question = `Ситуация: ${situation}${optText}\n\nЧто делать? Дай конкретный совет (3-5 строк).`;

  const [claudeAnswer, gptAnswer] = await Promise.all([
    askClaude(system, question, 500),
    askGPT(system, question, 500),
  ]);

  return {
    claude:    claudeAnswer,
    gpt:       gptAnswer,
    synthesis: await synthesize(question, claudeAnswer, gptAnswer),
  };
}

/**
 * Оценить запрос клиента — это горячий лид или просто вопрос?
 * Быстрая классификация двумя мозгами
 */
export async function classifyLead(message) {
  const system = `Классифицируй сообщение клиента магазина запчастей.
Ответь ТОЛЬКО одним словом: HOT (готов купить), WARM (интересуется), COLD (просто смотрит).`;

  const [c, g] = await Promise.all([
    askClaude(system, message, 10),
    askGPT(system, message, 10),
  ]);

  // Если оба сошлись — возвращаем их ответ, иначе HOT на всякий случай
  const cv = (c || '').toUpperCase().includes('HOT') ? 'HOT' : (c || '').toUpperCase().includes('WARM') ? 'WARM' : 'COLD';
  const gv = (g || '').toUpperCase().includes('HOT') ? 'HOT' : (g || '').toUpperCase().includes('WARM') ? 'WARM' : 'COLD';

  if (cv === gv) return cv;
  if (cv === 'HOT' || gv === 'HOT') return 'HOT'; // если хоть один считает HOT — обрабатываем
  return 'WARM';
}

/**
 * Простой запрос к GPT без синтеза (для быстрых задач)
 */
export async function askGPTOnly(systemPrompt, userMessage, maxTokens = 400) {
  return await askGPT(systemPrompt, userMessage, maxTokens);
}

/**
 * Простой запрос к Claude без синтеза
 */
export async function askClaudeOnly(systemPrompt, userMessage, maxTokens = 400) {
  return await askClaude(systemPrompt, userMessage, maxTokens);
}

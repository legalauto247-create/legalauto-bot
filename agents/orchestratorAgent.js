/**
 * LegalAuto — Orchestrator Agent
 * Принимает команду от Эдо → понимает задачу → раздаёт агентам → возвращает результат
 *
 * Пример команд:
 *  "сделай пост про импорт Geely в @LegalAuto24"
 *  "опубликуй объявление на авто в @LegalAutoStore"
 *  "дай статистику за неделю"
 *  "сделай пост с картинкой про СБКТС"
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });

const CHANNELS = {
  legalAuto24:   process.env.NEWS_CHANNEL_ID    || '@LegalAuto24',
  parts24:       process.env.PARTS_CHANNEL_ID   || '@LegalAutoParts24',
  store:         process.env.STORE_CHANNEL_ID   || '@LegalAutoStore',
};

const BRAND = {
  colors: 'тёмно-зелёный #003b42, золотой #d4af37, белый',
  style:  'экспертный, лаконичный, с эмодзи, без воды',
  name:   'LegalAuto',
  tagline: 'Запчасти и импорт авто — честно и быстро',
};

// ── 1. Понять задачу (Claude Sonnet — "мозг") ────────────────────────────
async function parseIntent(userCommand) {
  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role:    'user',
      content: `Ты оркестратор платформы LegalAuto. Разбери команду и верни JSON.

Доступные действия:
- "news_post"     — новостной пост для @LegalAuto24 (импорт авто, таможня, СБКТС)
- "parts_post"    — пост о запчастях для @LegalAutoParts24
- "store_post"    — объявление об авто для @LegalAutoStore
- "image_post"    — пост с картинкой (указать канал)
- "analytics"     — статистика платформы
- "broadcast"     — рассылка во все каналы
- "custom"        — другое

Команда: "${userCommand}"

Верни ТОЛЬКО JSON без markdown:
{
  "action": "news_post",
  "channel": "@LegalAuto24",
  "topic": "о чём писать",
  "withImage": false,
  "urgent": false,
  "explanation": "что я буду делать"
}`
    }]
  });

  try {
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return { action: 'custom', channel: null, topic: userCommand, withImage: false, explanation: 'Выполняю задачу' };
  }
}

// ── 2. Генерация текста поста (Claude Haiku — быстро) ────────────────────
async function generatePostText(topic, channel, style = '') {
  const channelContext = {
    '@LegalAuto24':      'канал для импортёров авто. Тема: ввоз авто, таможня, СБКТС, параллельный импорт',
    '@LegalAutoParts24': 'канал о запчастях BMW, Geely, Li Auto. Тема: запчасти, цены, наличие',
    '@LegalAutoStore':   'канал продажи авто. Тема: конкретные автомобили на продажу',
  };

  const ctx = channelContext[channel] || 'общий канал LegalAuto';

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role:    'user',
      content: `Ты копирайтер Telegram-канала LegalAuto.
Бренд: ${BRAND.name} — ${BRAND.tagline}
Стиль: ${BRAND.style}
Контекст канала: ${ctx}
${style ? 'Особые указания: ' + style : ''}

Напиши Telegram-пост на тему: "${topic}"
- 4-7 строк
- 2-3 эмодзи уместно по тексту
- в конце призыв: написать @LegalAutoAssist_bot или ссылка на legalauto.online
- НЕ добавляй хэштеги`
    }]
  });

  return msg.content[0].text.trim();
}

// ── 3. Генерация картинки (DALL-E 3, если есть ключ) ────────────────────
async function generateImage(topic) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body:    JSON.stringify({
        model:   'dall-e-3',
        prompt:  `Professional automotive business image for "${topic}". Dark teal background #003b42, gold accents #d4af37. Modern, clean, no text. Premium brand aesthetic for LegalAuto car import company.`,
        n:       1,
        size:    '1024x1024',
        quality: 'standard',
      })
    });
    const data = await res.json();
    return data.data?.[0]?.url || null;
  } catch { return null; }
}

// ── 4. Публикация в Telegram ─────────────────────────────────────────────
async function publishText(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: false })
  });
  return (await res.json()).ok;
}

async function publishPhoto(token, chatId, photoUrl, caption) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' })
  });
  return (await res.json()).ok;
}

// ── 5. Главная функция ────────────────────────────────────────────────────
export async function orchestrate(userCommand, reportBack) {
  const token = process.env.ADMIN_BOT_TOKEN;

  try {
    // Шаг 1: понять задачу
    await reportBack(`🧠 Анализирую задачу...`);
    const intent = await parseIntent(userCommand);
    await reportBack(`📋 План: ${intent.explanation}`);

    // Шаг 2: выполнить
    let result = { ok: false, message: '' };

    if (intent.action === 'analytics') {
      // Аналитика
      const { getTopBotQueries } = await import('./trendingAgent.js');
      const top = getTopBotQueries(5);
      const text = `📊 *Топ запросов за неделю:*\n${top.map((q,i) => `${i+1}. ${q.name} — ${q.count} раз`).join('\n') || 'Данных пока нет'}`;
      await reportBack(text);
      return;
    }

    if (intent.action === 'broadcast') {
      // Рассылка во все каналы
      await reportBack(`📡 Готовлю рассылку...`);
      const text = await generatePostText(intent.topic, '@LegalAuto24', 'для всех каналов');
      for (const ch of Object.values(CHANNELS)) {
        await publishText(token, ch, text);
        await new Promise(r => setTimeout(r, 2000));
      }
      result = { ok: true, message: `✅ Опубликовано во все 3 канала!` };

    } else {
      // Один канал
      const channel = intent.channel || CHANNELS.legalAuto24;

      await reportBack(`✍️ Генерирую пост...`);
      const text = await generatePostText(intent.topic, channel);

      if (intent.withImage) {
        await reportBack(`🎨 Генерирую картинку...`);
        const imageUrl = await generateImage(intent.topic);

        if (imageUrl) {
          const ok = await publishPhoto(token, channel, imageUrl, text);
          result = { ok, message: ok ? `✅ Пост с картинкой опубликован в ${channel}` : `❌ Ошибка публикации` };
        } else {
          // Нет OpenAI ключа — публикуем только текст
          const ok = await publishText(token, channel, text);
          result = { ok, message: ok ? `✅ Текстовый пост опубликован в ${channel}\n_(картинки: добавь OPENAI_API_KEY)_` : `❌ Ошибка` };
        }
      } else {
        const ok = await publishText(token, channel, text);
        result = { ok, message: ok ? `✅ Пост опубликован в ${channel}` : `❌ Ошибка публикации` };
      }
    }

    await reportBack(result.message);

  } catch (e) {
    await reportBack(`❌ Ошибка: ${e.message}`);
    console.error('[Orchestrator]', e);
  }
}

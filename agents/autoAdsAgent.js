/**
 * LegalAuto — Auto Ads Agent v2
 *
 * Читает посты из партнёрских Telegram-каналов, переписывает через Claude
 * и публикует в твой канал/группу с одобрения Эдо.
 *
 * Как работает:
 *  1. Партнёрский канал публикует объявление об авто
 *  2. Бот (добавленный в канал) получает channel_post
 *  3. Claude анализирует — это объявление об авто? Да / нет
 *  4. Если да — переписывает под твою аудиторию
 *  5. Отправляет Эдо на одобрение → кнопки ✅/❌
 *  6. Эдо нажимает ✅ → публикуется в AUTO_ADS_CHANNEL
 *
 * Railway env:
 *   PARTNER_CHANNELS    = "@channel1,@channel2,-1001234567890"  (через запятую)
 *   AUTO_ADS_CHANNEL    = "@твоя_группа" или ID
 *   AUTO_ADS_ENABLED    = "true"
 *
 * Настройка:
 *   Добавь бота (@LegalAutoAssist_bot или @LegalAutoPartsBot) в каждый
 *   партнёрский канал как администратора (права: чтение сообщений).
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch     from 'node-fetch';

const {
  CLAUDE_API_KEY,
  ADMIN_BOT_TOKEN,
  ADMIN_CHAT_ID,
  AUTO_ADS_CHANNEL,
  PARTNER_CHANNELS,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

// Парсим список партнёрских каналов из env
function getPartnerChannels() {
  if (!PARTNER_CHANNELS) return [];
  return PARTNER_CHANNELS.split(',').map(s => s.trim()).filter(Boolean);
}

// Нормализуем ID канала для сравнения (@username → lowercase, числа → строка)
function normalizeChannelId(id) {
  return String(id).toLowerCase().replace(/^@/, '');
}

function isPartnerChannel(chatId, chatUsername) {
  const partners = getPartnerChannels();
  if (!partners.length) return false;

  const normalizedId       = normalizeChannelId(chatId);
  const normalizedUsername = chatUsername ? normalizeChannelId(chatUsername) : '';

  return partners.some(p => {
    const norm = normalizeChannelId(p);
    return norm === normalizedId || norm === normalizedUsername;
  });
}

// ── Дедупликация (не переобрабатываем одно и то же) ────────────────────────
const processedMessageIds = new Set(); // "channelId_messageId"

// ── Ожидающие одобрения объявления ─────────────────────────────────────────
export const pendingAds = new Map(); // id → { text, originalText, channelName }

export function getPendingAd(id)   { return pendingAds.get(String(id)); }
export function clearPendingAd(id) { pendingAds.delete(String(id)); }

// ── Проверка через Claude — это объявление об авто? ────────────────────────
async function isCarListing(text) {
  if (!claude) return isCarListingSimple(text);
  if (text.length < 30) return false;

  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content:
          `Это сообщение из Telegram-канала. Это объявление о продаже/покупке автомобиля?\n\n"${text.substring(0, 400)}"\n\nОтветь ТОЛЬКО: ДА или НЕТ.`,
      }],
    });
    return msg.content[0].text.trim().toUpperCase().startsWith('ДА');
  } catch {
    return isCarListingSimple(text);
  }
}

// Простая проверка без AI (если Claude недоступен)
function isCarListingSimple(text) {
  const lower = text.toLowerCase();
  const keywords = [
    'продаю', 'продам', 'продаётся', 'продается',
    'авто', 'автомобиль', 'машина', 'машину',
    'год выпуска', 'пробег', 'двигатель',
    'кузов', 'коробка', 'привод',
    'тыс км', 'т.км', 'л.с', 'литра', 'литр',
    'bmw', 'mercedes', 'geely', 'li auto', 'chery',
    'toyota', 'honda', 'hyundai', 'kia', 'audi',
    'volkswagen', 'volvo', 'lexus',
  ];
  return keywords.filter(kw => lower.includes(kw)).length >= 2;
}

// ── Переписать объявление под свою аудиторию ───────────────────────────────
async function rewriteForChannel(originalText, channelName) {
  if (!claude) return buildFallbackPost(originalText, channelName);

  try {
    const msg = await claude.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content:
          `Ты ведёшь Telegram-группу по продаже авто. Перепиши это объявление из партнёрского канала "${channelName}" как пост для своей аудитории.

Исходное объявление:
"${originalText.substring(0, 600)}"

Требования:
- Сохрани все технические данные (год, пробег, цена, марка, модель)
- Добавь 2-3 эмодзи
- Стиль: живой, как советует друг-автоэксперт
- Длина: 5-7 строк
- В конце одна из этих строк (выбери подходящую):
  "💬 Помощь с документами → @LegalAuto247"
  "📋 Оформим СБКТС/ЭПТС → @LegalAutoAssist_bot"
  "🚗 Вопросы по авто → @LegalAuto247"
- НЕ добавляй "Источник:" или "Из канала"`,
      }],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.error('[AutoAds] Claude rewrite error:', e.message);
    return buildFallbackPost(originalText, channelName);
  }
}

function buildFallbackPost(text, channelName) {
  return `${text.substring(0, 500)}\n\n💬 Помощь с документами → @LegalAuto247`;
}

// ── Отправить Эдо на одобрение ─────────────────────────────────────────────
async function sendForApproval(rewrittenText, originalText, channelName) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.log('[AutoAds] Нет ADMIN_BOT_TOKEN — публикую напрямую');
    return publishAd(rewrittenText);
  }

  const id = `autoads_${Date.now()}`;
  pendingAds.set(id, { text: rewrittenText, originalText, channelName });

  const preview = rewrittenText.length > 350
    ? rewrittenText.substring(0, 350) + '...'
    : rewrittenText;

  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    ADMIN_CHAT_ID,
        text:       `🚗 *Авто из канала "${channelName}"*\n\n${preview}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Опубликовать', callback_data: `autoads_approve_${id}` },
            { text: '❌ Пропустить',   callback_data: `autoads_reject_${id}`  },
            { text: '📄 Оригинал',     callback_data: `autoads_orig_${id}`    },
          ]],
        },
      }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[AutoAds] 📨 На одобрение: ${rewrittenText.substring(0, 60)}`);
    }
    return data.ok;
  } catch (e) {
    console.error('[AutoAds] sendForApproval error:', e.message);
    return false;
  }
}

// ── Прямая публикация в канал/группу ───────────────────────────────────────
export async function publishAd(text) {
  const channel = AUTO_ADS_CHANNEL;
  if (!channel || !ADMIN_BOT_TOKEN) {
    console.log('[AutoAds] AUTO_ADS_CHANNEL или ADMIN_BOT_TOKEN не задан');
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  channel,
        text,
        parse_mode:               'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (data.ok) console.log('[AutoAds] ✅ Опубликовано в канал');
    else         console.error('[AutoAds] ❌ Ошибка публикации:', data.description);
    return data.ok;
  } catch (e) {
    console.error('[AutoAds] publish error:', e.message);
    return false;
  }
}

// ── ГЛАВНАЯ ФУНКЦИЯ: вызывается из setupAdminBot/setupClientBot ─────────────
// Подключается к Telegraf боту и слушает channel_post
export function setupAutoAdsListener(bot, botName = 'bot') {
  if (process.env.AUTO_ADS_ENABLED !== 'true') {
    console.log(`[AutoAds] Выключено (AUTO_ADS_ENABLED≠true). Установи в Railway.`);
    return;
  }

  const partners = getPartnerChannels();
  if (!partners.length) {
    console.log('[AutoAds] ⚠️ PARTNER_CHANNELS не задан. Добавь каналы в Railway.');
    return;
  }

  console.log(`[AutoAds] 👂 Слушаю ${partners.length} партнёрских каналов через ${botName}: ${partners.join(', ')}`);

  // Слушаем посты из каналов
  bot.on('channel_post', async (ctx) => {
    try {
      const chat     = ctx.channelPost?.chat;
      const message  = ctx.channelPost;
      const text     = message?.text || message?.caption || '';

      if (!chat || !text) return;

      // Проверяем — это партнёрский канал?
      if (!isPartnerChannel(chat.id, chat.username)) return;

      const msgKey = `${chat.id}_${message.message_id}`;
      if (processedMessageIds.has(msgKey)) return;
      processedMessageIds.add(msgKey);
      // Чистим старые ключи (максимум 500)
      if (processedMessageIds.size > 500) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
      }

      const channelName = chat.title || chat.username || String(chat.id);
      console.log(`[AutoAds] 📩 Пост из "${channelName}": ${text.substring(0, 60)}`);

      // Проверяем — это объявление об авто?
      const isListing = await isCarListing(text);
      if (!isListing) {
        console.log(`[AutoAds] ⏭ Не объявление об авто — пропускаю`);
        return;
      }

      console.log(`[AutoAds] 🚗 Объявление найдено — переписываю через Claude`);
      const rewritten = await rewriteForChannel(text, channelName);
      await sendForApproval(rewritten, text, channelName);

    } catch (e) {
      console.error('[AutoAds] channel_post error:', e.message);
    }
  });
}

// ── Статус для adminBot ─────────────────────────────────────────────────────
export function getAutoAdsStatus() {
  const partners = getPartnerChannels();
  return {
    enabled:  process.env.AUTO_ADS_ENABLED === 'true',
    channel:  AUTO_ADS_CHANNEL || 'не задан',
    partners: partners.length,
    list:     partners,
    pending:  pendingAds.size,
  };
}

console.log('🚗 Auto Ads Agent v2 загружен (режим: Telegram партнёрские каналы)');

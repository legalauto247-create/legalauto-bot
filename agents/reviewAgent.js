/**
 * LegalAuto — Review Agent
 * Через 3-7 дней после закрытия заявки пишет клиенту в Telegram
 * и просит оставить отзыв в Google / Яндекс.
 *
 * Хранение: GAS-таблица лист "Reviews" — chatId, partName, closedAt, reviewSentAt
 * Запуск: scheduledReviewCheck() вызывается из index.js раз в сутки.
 */

const GOOGLE_MAPS_URL = process.env.GOOGLE_MAPS_URL || ''; // ссылка на Google Maps профиль
const YANDEX_MAP_URL  = process.env.YANDEX_MAP_URL  || ''; // ссылка на Яндекс Карты профиль

const REVIEW_DELAY_DAYS = 4;  // через сколько дней писать

// In-memory очередь (Railway — нет Redis, используем Map + интервал)
const reviewQueue = new Map(); // chatId → { partName, car, scheduledAt }

/**
 * Добавить клиента в очередь отзывов.
 * Вызывать когда менеджер закрывает заявку.
 */
export function scheduleReview({ chatId, partName, car }) {
  const scheduledAt = Date.now() + REVIEW_DELAY_DAYS * 24 * 60 * 60 * 1000;
  reviewQueue.set(String(chatId), { partName, car, scheduledAt, sent: false });
  console.log(`[ReviewAgent] Запланирован отзыв для ${chatId} через ${REVIEW_DELAY_DAYS} дн.`);
}

/**
 * Проверить и отправить накопившиеся отзывы.
 * Запускается раз в час из index.js.
 */
export async function runReviewCheck(bot) {
  const now  = Date.now();
  let   sent = 0;

  for (const [chatId, entry] of reviewQueue.entries()) {
    if (entry.sent) continue;
    if (now < entry.scheduledAt) continue;

    try {
      await sendReviewRequest(bot, chatId, entry.partName, entry.car);
      entry.sent = true;
      sent++;
    } catch (e) {
      console.error(`[ReviewAgent] Ошибка отправки для ${chatId}:`, e.message);
    }
  }

  if (sent) console.log(`[ReviewAgent] Отправлено запросов отзывов: ${sent}`);

  // Чистим старые записи (> 30 дней)
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  for (const [chatId, entry] of reviewQueue.entries()) {
    if (entry.sent && entry.scheduledAt < cutoff) reviewQueue.delete(chatId);
  }
}

async function sendReviewRequest(bot, chatId, partName, car) {
  const part = partName || 'запчасть';
  const carStr = car ? ` для ${car}` : '';

  let text =
    `👋 Привет!\n\n` +
    `Недавно вы заказывали у нас *${part}*${carStr}.\n\n` +
    `Если всё прошло хорошо — нам очень поможет ваш отзыв! 🙏\n` +
    `Это занимает 1 минуту и помогает другим автовладельцам нас найти.\n\n`;

  const buttons = [];

  if (GOOGLE_MAPS_URL) {
    buttons.push({ text: '⭐ Отзыв в Google', url: GOOGLE_MAPS_URL });
  }
  if (YANDEX_MAP_URL) {
    buttons.push({ text: '⭐ Отзыв в Яндекс', url: YANDEX_MAP_URL });
  }

  // Если нет настроенных ссылок — просим написать отзыв в бот
  if (!buttons.length) {
    text += `Напишите нам как всё прошло — ваше мнение важно! 👇`;
  }

  await bot.telegram.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: buttons.length
      ? { inline_keyboard: [buttons] }
      : undefined,
  });

  console.log(`[ReviewAgent] Отправлен запрос отзыва → ${chatId}`);
}

/**
 * Настройка планировщика (вызвать один раз в index.js)
 */
export function setupReviewScheduler(bot) {
  // Проверяем каждый час
  setInterval(() => runReviewCheck(bot), 60 * 60 * 1000);
  console.log('⭐ Review scheduler запущен (каждые 1ч)');
}

export { reviewQueue };

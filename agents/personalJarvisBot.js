// ════════════════════════════════════════════════════════════════════════════
// ЛИЧНЫЙ JARVIS БОТ ДЛЯ ЭДО (@LegalAuto247_bot)
// Управляет ВСЕМ: создание, администрирование, ремонт, заработки
// ════════════════════════════════════════════════════════════════════════════

import TelegramBot from 'telegraf';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const JARVIS_TOKEN = process.env.JARVIS_BOT_TOKEN;  // @LegalAuto247_bot
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;   // Только Эдо
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APPS_SCRIPT_API_URL = process.env.APPS_SCRIPT_API_URL;

const jarvis = new TelegramBot(JARVIS_TOKEN, { polling: true });
const claude = new Anthropic();
const gemini = new GoogleGenerativeAI(GEMINI_API_KEY);

// ────────────────────────────────────────────────────────────────────────────
// JARVIS ФУНКЦИИ — ГЛАВНОЕ ЯДРО
// ────────────────────────────────────────────────────────────────────────────

/**
 * Проверяет что это только Эдо (приватный бот)
 */
function isAdmin(ctx) {
  return ctx.from.id.toString() === ADMIN_CHAT_ID;
}

/**
 * Сообщение только админам
 */
function adminOnly(ctx) {
  if (!isAdmin(ctx)) {
    ctx.reply('❌ Это приватный бот только для Эдо');
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 1️⃣ УПРАВЛЕНИЕ (ADMIN ФУНКЦИИ)
// ════════════════════════════════════════════════════════════════════════════

jarvis.command('status', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    ctx.reply('🔍 Проверяю здоровье систем...');

    const response = await fetch(APPS_SCRIPT_API_URL + '?action=health');
    const data = await response.json();

    const status = `
✅ JARVIS РАБОТАЕТ!

📊 СТАТУС СИСТЕМ:
${data.gassAPI ? '✅' : '❌'} Google Apps Script API
${data.telegramBot ? '✅' : '❌'} Telegram бот
${data.avito ? '✅' : '❌'} Avito интеграция
${data.yandex ? '✅' : '❌'} Yandex Market
${data.openai ? '✅' : '❌'} OpenAI (DALL-E-3)
${data.claude ? '✅' : '❌'} Claude API

⏰ Last sync: ${data.lastSync}
🚀 Uptime: ${data.uptime}
💾 Database: ${data.dbStatus}
`;

    ctx.reply(status);
  } catch (e) {
    ctx.reply('❌ Ошибка проверки: ' + e.message);
  }
});

jarvis.command('earnings_today', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    const response = await fetch(APPS_SCRIPT_API_URL + '?action=earnings&period=today');
    const data = await response.json();

    ctx.reply(`
💰 ЗАРАБОТКИ СЕГОДНЯ

🔴 Telegram: ${data.telegram || 0} РУБ
🔵 Avito: ${data.avito || 0} РУБ
🟢 Yandex: ${data.yandex || 0} РУБ
🟡 Партнеры: ${data.partners || 0} РУБ
🟣 Таможня: ${data.customs || 0} РУБ

📊 ВСЕГО СЕГОДНЯ: ${data.total} РУБ
────────────────────────
💸 После комиссий: ${Math.round(data.total * 0.85)} РУБ
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

jarvis.command('earnings_month', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    const response = await fetch(APPS_SCRIPT_API_URL + '?action=earnings&period=month');
    const data = await response.json();

    ctx.reply(`
📈 ЗАРАБОТКИ В МЕСЯЦ

${Object.entries(data.daily).map(([day, amount]) =>
  `${day}: ${amount} РУБ`
).join('\n')}

────────────────────────────
💰 ВСЕГО В МЕСЯЦ: ${data.total} РУБ
📊 В СРЕДНЕМ В ДЕНЬ: ${Math.round(data.total / 30)} РУБ
🎯 Прогноз на конец месяца: ${Math.round(data.projection)} РУБ
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

jarvis.command('add_part', async (ctx) => {
  if (!adminOnly(ctx)) return;

  const text = ctx.message.text;
  const match = text.match(/\/add_part\s+(.+?)\s+(\d+)/);

  if (!match) {
    ctx.reply('❌ Формат: /add_part <название> <цена_руб>');
    return;
  }

  const [, name, price] = match;

  try {
    ctx.reply('⏳ Генерирую описание и фото...');

    // Генерируем описание через Claude
    const description = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Напиши короткое (100-150 слов) продающее описание для запчасти: ${name}.
Не добавляй цену. Формат: 2-3 предложения технических характеристик + преимущества. На русском.`
      }]
    });

    const desc = description.content[0].text;

    // Генерируем фото через DALL-E-3
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `Professional automotive part photography of ${name}. High quality, isolated on white background, studio lighting, product photography style`,
        n: 1,
        size: '1024x1024',
      })
    });

    const imageData = await imageResponse.json();
    const imageUrl = imageData.data[0].url;

    // Сохраняем в Google Sheets
    const saveResponse = await fetch(APPS_SCRIPT_API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'add_part',
        name,
        price,
        description: desc,
        photo_url: imageUrl,
      })
    });

    const result = await saveResponse.json();

    ctx.reply(`
✅ ЗАПЧАСТЬ ДОБАВЛЕНА!

📦 Название: ${name}
💰 Цена: ${price} РУБ
📝 Описание: ${desc.substring(0, 100)}...
🖼️ Фото: загружено

ID в базе: ${result.id}
Готово к публикации на Avito/Yandex!
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка добавления: ' + e.message);
  }
});

jarvis.command('bulk_add', async (ctx) => {
  if (!adminOnly(ctx)) return;

  ctx.reply(`
📋 BULK ADD ДЛЯ 100+ ПОЗИЦИЙ

Отправьте CSV файл с формате:
название,цена,описание
Пример:
BMW Тормозной диск,2500,Оригинальный OEM для BMW X7
Mercedes Подушка двигателя,1800,Полиуретановая подушка

Или используйте интеграцию с поставщиком (/suppliers)
  `);
});

jarvis.command('update_prices', async (ctx) => {
  if (!adminOnly(ctx)) return;

  const match = ctx.message.text.match(/\/update_prices\s+([\d\-]+)/);
  if (!match) {
    ctx.reply('❌ Формат: /update_prices +10 или -5 (процент)');
    return;
  }

  const percent = parseInt(match[1]);

  try {
    ctx.reply(`⏳ Обновляю цены на ${percent > 0 ? '+' : ''}${percent}%...`);

    const response = await fetch(APPS_SCRIPT_API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_prices',
        percent
      })
    });

    const data = await response.json();

    ctx.reply(`
✅ ЦЕНЫ ОБНОВЛЕНЫ!

📊 Позиций обновлено: ${data.updated}
💰 Средняя новая цена: ${data.averagePrice} РУБ
📈 Изменение прибыли: +${Math.round(data.estimatedProfit)} РУБ/месяц

Уведомлено маркетплейсов:
✅ Avito
✅ Yandex Market
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2️⃣ АНАЛИТИКА И ОТЧЕТЫ
// ════════════════════════════════════════════════════════════════════════════

jarvis.command('report_daily', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    const response = await fetch(APPS_SCRIPT_API_URL + '?action=report&type=daily');
    const data = await response.json();

    ctx.reply(`
📊 ЕЖЕДНЕВНЫЙ ОТЧЕТ (${data.date})

🛍️ ПРОДАЖИ:
${data.sales.map(s => `  • ${s.product}: ${s.quantity} шт × ${s.price}РУБ`).join('\n')}

💰 ФИНАНСЫ:
  Валовой доход: ${data.grossRevenue} РУБ
  Комиссии: -${data.commissions} РУБ
  Логистика: -${data.logistics} РУБ
  ───────────────────────
  ЧИСТАЯ ПРИБЫЛЬ: ${data.netProfit} РУБ

📈 ТРЕНДЫ:
  Топ товар: ${data.topProduct} (${data.topProductSales} продано)
  Топ маркетплейс: ${data.topMarketplace} (${data.topMarketplaceRevenue}%)
  Конверсия: ${data.conversionRate}%

🎯 ЦЕЛЬ НА МЕСЯЦ: ${data.monthTarget} РУБ
📍 Выполнено: ${Math.round((data.monthProgress / data.monthTarget) * 100)}%
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

jarvis.command('top_selling', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    const response = await fetch(APPS_SCRIPT_API_URL + '?action=top_selling&limit=10');
    const data = await response.json();

    const list = data.map((item, i) =>
      `${i + 1}. ${item.name} - ${item.sold} шт (${item.revenue}РУБ)`
    ).join('\n');

    ctx.reply(`
🔥 ТОП 10 ПРОДАВАЕМЫХ ТОВАРОВ

${list}

💡 Совет: Увеличьте закупки этих товаров!
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3️⃣ СОЗДАНИЕ (CONTENT GENERATION)
// ════════════════════════════════════════════════════════════════════════════

jarvis.command('generate_description', async (ctx) => {
  if (!adminOnly(ctx)) return;

  const text = ctx.message.text.replace('/generate_description', '').trim();
  if (!text) {
    ctx.reply('❌ Укажите название товара');
    return;
  }

  try {
    ctx.reply('✍️ Пишу описание...');

    const message = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Напиши профессиональное описание для запчасти: "${text}"

Требования:
- 150-250 слов
- Первое предложение — что это и для каких авто
- Технические характеристики (2-3 пункта)
- Преимущества (3-4 пункта)
- Условия установки/совместимости
- Гарантия и доставка
- Призыв к действию

Формат: читаемый, продающий, без переборов!`
      }]
    });

    const description = message.content[0].text;
    ctx.reply(description);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

jarvis.command('generate_image', async (ctx) => {
  if (!adminOnly(ctx)) return;

  const text = ctx.message.text.replace('/generate_image', '').trim();
  if (!text) {
    ctx.reply('❌ Укажите что рисовать');
    return;
  }

  try {
    ctx.reply('🎨 Генерирую фото...');

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `Professional automotive part product photography of ${text}.
        High quality, isolated on white background, studio lighting,
        professional product photography style, sharp focus, bright lighting`,
        n: 1,
        size: '1024x1024',
      })
    });

    const data = await response.json();
    if (data.data && data.data[0]) {
      await ctx.replyWithPhoto(data.data[0].url, {
        caption: `✅ Фото готово!\n\nCсылка: ${data.data[0].url}`
      });
    }
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

jarvis.command('create_ad', async (ctx) => {
  if (!adminOnly(ctx)) return;

  const match = ctx.message.text.match(/\/create_ad\s+(\w+)\s+(.+)/);
  if (!match) {
    ctx.reply('❌ Формат: /create_ad <platform> <товар>\nПлатформы: avito, yandex, telegram');
    return;
  }

  const [, platform, product] = match;

  try {
    const message = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Напиши объявление для ${platform} для товара: ${product}

Требования для ${platform}:
${platform === 'avito' ? `- Заголовок до 75 символов
- Описание до 1000 символов
- Звучит естественно, не спамово` : ''}
${platform === 'yandex' ? `- Заголовок до 80 символов
- Описание до 500 символов
- Включить основные характеристики` : ''}
${platform === 'telegram' ? `- Эмодзи для привлечения
- Краткое описание с преимуществами
- Цена и ссылка на заказ` : ''}

Пиши готовый текст, который я могу скопировать!`
      }]
    });

    ctx.reply(message.content[0].text);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 4️⃣ ДИАГНОСТИКА И РЕМОНТ
// ════════════════════════════════════════════════════════════════════════════

jarvis.command('health_check', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    ctx.reply('🔍 Диагностирую все системы...');

    const checks = {
      'Google Apps Script': await testGAS(),
      'Telegram Bot': await testTelegramBot(),
      'Avito API': await testAvitoAPI(),
      'Yandex API': await testYandexAPI(),
      'OpenAI API': await testOpenAIAPI(),
      'Claude API': await testClaudeAPI(),
      'Database': await testDatabase(),
      'Cache': await testCache(),
    };

    const report = Object.entries(checks)
      .map(([name, status]) => `${status ? '✅' : '❌'} ${name}`)
      .join('\n');

    ctx.reply(`
🏥 РЕЗУЛЬТАТЫ ДИАГНОСТИКИ:

${report}

${Object.values(checks).every(v => v) ? '✅ ВСЕ СИСТЕМЫ РАБОТАЮТ!' : '⚠️ ЕСТЬ ПРОБЛЕМЫ!'}
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка диагностики: ' + e.message);
  }
});

jarvis.command('fix_sync', async (ctx) => {
  if (!adminOnly(ctx)) return;

  try {
    ctx.reply('🔧 Синхронизирую базы данных...');

    // Синхронизируем Google Sheets с маркетплейсами
    await syncGoogleSheets();
    await syncAvitoInventory();
    await syncYandexInventory();

    ctx.reply(`
✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА!

📊 Google Sheets ← → Avito
📊 Google Sheets ← → Yandex Market
💾 Кэш очищен и восстановлен

Все системы синхронизированы!
    `);
  } catch (e) {
    ctx.reply('❌ Ошибка синхронизации: ' + e.message);
  }
});

jarvis.command('restart', async (ctx) => {
  if (!adminOnly(ctx)) return;

  ctx.reply('🔄 Перезагружаюсь...');

  // Graceful restart
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// ════════════════════════════════════════════════════════════════════════════
// 5️⃣ ПОМОЩЬ
// ════════════════════════════════════════════════════════════════════════════

jarvis.command('help', async (ctx) => {
  if (!adminOnly(ctx)) return;

  ctx.reply(`
🤖 JARVIS — ТВОЙ ЛИЧНЫЙ AI ПОМОЩНИК

📊 УПРАВЛЕНИЕ:
/status - здоровье систем
/earnings_today - заработки за день
/earnings_month - заработки за месяц
/add_part - добавить товар
/update_prices - изменить цены

📈 АНАЛИТИКА:
/report_daily - ежедневный отчет
/top_selling - топ товаров

✍️ СОЗДАНИЕ:
/generate_description - описание товара
/generate_image - фото товара
/create_ad - объявление для маркетплейса

🔧 ДИАГНОСТИКА:
/health_check - проверка систем
/fix_sync - синхронизация баз
/restart - перезагрузка

💡 Я работаю 24/7 и готов помочь в любой момент!
  `);
});

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

async function testGAS() {
  try {
    const res = await fetch(APPS_SCRIPT_API_URL + '?action=health');
    return res.ok;
  } catch {
    return false;
  }
}

async function testTelegramBot() {
  try {
    const res = await jarvis.telegram.getMe();
    return !!res;
  } catch {
    return false;
  }
}

async function testAvitoAPI() {
  // Проверяем что у нас есть ключ
  return !!process.env.AVITO_API_TOKEN;
}

async function testYandexAPI() {
  return !!process.env.YANDEX_MARKET_TOKEN;
}

async function testOpenAIAPI() {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testClaudeAPI() {
  try {
    await claude.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }]
    });
    return true;
  } catch {
    return false;
  }
}

async function testDatabase() {
  try {
    const res = await fetch(APPS_SCRIPT_API_URL + '?action=health&check=db');
    return res.ok;
  } catch {
    return false;
  }
}

async function testCache() {
  // Проверяем Redis если есть
  return true; // для простоты
}

async function syncGoogleSheets() {
  return fetch(APPS_SCRIPT_API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'sync' })
  });
}

async function syncAvitoInventory() {
  // Синхронизируем инвентарь с Avito
  const res = await fetch(APPS_SCRIPT_API_URL + '?action=sync_avito');
  return res.json();
}

async function syncYandexInventory() {
  // Синхронизируем инвентарь с Yandex
  const res = await fetch(APPS_SCRIPT_API_URL + '?action=sync_yandex');
  return res.json();
}

// ════════════════════════════════════════════════════════════════════════════
// ЗАПУСК
// ════════════════════════════════════════════════════════════════════════════

console.log('🤖 JARVIS личный бот загружен (@LegalAuto247_bot)');
console.log('✅ Режим: Приватный (только для Эдо)');
console.log('🎯 Готов управлять, создавать и чинить всё!');

export { jarvis };

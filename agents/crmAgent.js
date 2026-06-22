/**
 * LegalAuto — CRM Agent
 *
 * Парсит естественный язык → структурированная CRM-запись об автомобиле
 * Пример: "BMW X5 клиент Иванов лаборатория 15 июня"
 *         → { car: "BMW X5", client: "Иванов", stage: "лаборатория", date: "15 июня" }
 *
 * Сохраняет запись в Google Sheets через Apps Script API
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const {
  CLAUDE_API_KEY,
  APPS_SCRIPT_API_URL,
} = process.env;

const claude = CLAUDE_API_KEY ? new Anthropic({ apiKey: CLAUDE_API_KEY }) : null;

const CRM_SYSTEM = `Ты парсер CRM для автосервиса LegalAuto.

Получаешь произвольный текст о клиенте/автомобиле. Извлеки данные в JSON:
{
  "car":     "марка модель (например BMW X5 2020)",
  "client":  "имя клиента или компании",
  "phone":   "телефон если есть",
  "stage":   "этап работы (лаборатория/оформление/готово/оплата/выдача)",
  "note":    "комментарий",
  "date":    "дата если упомянута"
}

Правила:
- Если поле не найдено — ставь null
- stage определяй по ключевым словам: лаборатория/испытания → "лаборатория", оформление/документы → "оформление", готово/выдать → "готово", оплата/счёт → "оплата"
- Отвечай ТОЛЬКО JSON, без markdown, без пояснений`;

/**
 * Парсит текст → CRM-объект через Claude
 * @param {string} text - произвольный текст
 * @returns {object|null}
 */
export async function parseCrmEntry(text) {
  if (!claude) {
    // Простой regex-парсер как fallback
    return basicParse(text);
  }

  try {
    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 300,
      system:     CRM_SYSTEM,
      messages:   [{ role: 'user', content: text }],
    });
    const raw = msg.content[0].text.trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error('[CrmAgent] parse error:', e.message);
    return basicParse(text);
  }
}

// ── Простой fallback парсер без AI ────────────────────────────────────────
function basicParse(text) {
  const stageMap = {
    'лаборатор': 'лаборатория',
    'испытан':   'лаборатория',
    'оформлен':  'оформление',
    'документ':  'оформление',
    'готов':     'готово',
    'выдач':     'готово',
    'оплат':     'оплата',
    'счёт':      'оплата',
  };
  let stage = null;
  const lower = text.toLowerCase();
  for (const [key, val] of Object.entries(stageMap)) {
    if (lower.includes(key)) { stage = val; break; }
  }

  // Поиск марки авто
  const carMatch = text.match(/\b(BMW|Geely|Li Auto|Toyota|Mercedes|Audi|Hyundai|Kia|Nissan|Honda)\b/i);
  const dateMatch = text.match(/\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i);
  const phoneMatch = text.match(/[\+\d][\d\s\-\(\)]{9,}/);

  return {
    car:    carMatch ? carMatch[0] : null,
    client: null,
    phone:  phoneMatch ? phoneMatch[0].trim() : null,
    stage:  stage,
    note:   text.substring(0, 200),
    date:   dateMatch ? dateMatch[0] : null,
  };
}

/**
 * Сохраняет CRM-запись в Google Sheets
 * @param {object} entry - результат parseCrmEntry
 * @param {string} chatId
 */
export async function saveCrmEntry(entry, chatId) {
  if (!APPS_SCRIPT_API_URL || !entry) return false;
  try {
    const url = new URL(APPS_SCRIPT_API_URL);
    url.searchParams.set('action', 'save_car');
    url.searchParams.set('chat_id', chatId || '');
    url.searchParams.set('car',     entry.car || '');
    url.searchParams.set('client',  entry.client || '');
    url.searchParams.set('phone',   entry.phone || '');
    url.searchParams.set('stage',   entry.stage || '');
    url.searchParams.set('note',    entry.note || '');
    url.searchParams.set('date',    entry.date || '');
    await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalAutoBot/1.0)' } });
    return true;
  } catch (e) {
    console.error('[CrmAgent] saveCrmEntry error:', e.message);
    return false;
  }
}

/**
 * Полный цикл: текст → parse → save
 * @returns {string} - текст для ответа пользователю
 */
export async function handleCrmText(text, chatId) {
  const entry = await parseCrmEntry(text);
  if (!entry || (!entry.car && !entry.client)) {
    return null; // не похоже на CRM-запись
  }
  await saveCrmEntry(entry, chatId);
  const parts = [
    entry.car     && `🚗 ${entry.car}`,
    entry.client  && `👤 ${entry.client}`,
    entry.stage   && `📍 ${entry.stage}`,
    entry.date    && `📅 ${entry.date}`,
    entry.phone   && `📞 ${entry.phone}`,
  ].filter(Boolean);
  return `✅ CRM запись создана:\n${parts.join('\n')}`;
}

// ── Проверяем, похож ли текст на CRM-команду ──────────────────────────────
export function looksCrmCommand(text) {
  const lower = (text || '').toLowerCase();
  const carBrands = ['bmw', 'geely', 'li auto', 'toyota', 'mercedes', 'audi', 'hyundai', 'nissan'];
  const crmWords  = ['клиент', 'заявка', 'авто', 'машина', 'лаборатор', 'оформлен', 'готов', 'оплат', 'выдач'];
  return carBrands.some(b => lower.includes(b)) && crmWords.some(w => lower.includes(w));
}

/**
 * LegalAuto — Document Agent
 * Генерирует PDF счёт/накладную когда менеджер подтверждает заказ.
 *
 * Использует: встроенный HTML→PDF через Puppeteer (уже есть на Railway).
 * Формат: счёт на оплату с реквизитами, деталью, ценой.
 *
 * Вызов: generateInvoicePdf({ ... }) → Buffer (PDF)
 * В adminBot: кнопка "📄 Создать счёт" → бот присылает PDF файлом.
 */

import { execSync } from 'child_process';
import puppeteer from 'puppeteer-core';

// Реквизиты компании из env
const COMPANY_NAME = process.env.COMPANY_NAME || 'ИП LegalAuto';
const COMPANY_INN  = process.env.COMPANY_INN  || '';
const COMPANY_BANK = process.env.COMPANY_BANK || '';
const COMPANY_RS   = process.env.COMPANY_RS   || '';
const COMPANY_BIK  = process.env.COMPANY_BIK  || '';
const COMPANY_PHONE= process.env.COMPANY_PHONE|| '';

function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  try { return execSync('find /nix/store -maxdepth 4 -name "chromium" -type f 2>/dev/null | head -1').toString().trim() || null; } catch { return null; }
}

// ── HTML шаблон счёта ─────────────────────────────────────────────────────────
function buildInvoiceHtml({ invoiceNum, date, clientName, clientPhone, partName, car, price, quantity = 1 }) {
  const total    = price * quantity;
  const totalStr = total.toLocaleString('ru-RU');
  const priceStr = price.toLocaleString('ru-RU');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; margin: 40px; color: #111; }
  h1   { font-size: 20px; text-align: center; margin-bottom: 4px; }
  .sub { text-align: center; color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th   { background: #f4f4f4; font-weight: bold; }
  .total-row td { font-weight: bold; background: #f9f9f9; }
  .section { margin: 18px 0 6px; font-weight: bold; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .row { display: flex; gap: 40px; margin: 4px 0; }
  .label { color: #555; min-width: 140px; }
  .stamp { margin-top: 40px; display: flex; justify-content: space-between; }
  .sign  { border-top: 1px solid #111; width: 200px; text-align: center; padding-top: 4px; font-size: 11px; color: #555; }
</style>
</head>
<body>

<h1>СЧЁТ НА ОПЛАТУ № ${invoiceNum}</h1>
<div class="sub">от ${date}</div>

<div class="section">Продавец</div>
<div class="row"><span class="label">Наименование:</span><span>${COMPANY_NAME}</span></div>
${COMPANY_INN  ? `<div class="row"><span class="label">ИНН:</span><span>${COMPANY_INN}</span></div>` : ''}
${COMPANY_PHONE? `<div class="row"><span class="label">Телефон:</span><span>${COMPANY_PHONE}</span></div>` : ''}

<div class="section">Покупатель</div>
<div class="row"><span class="label">Имя / компания:</span><span>${clientName || 'Физическое лицо'}</span></div>
${clientPhone ? `<div class="row"><span class="label">Телефон:</span><span>${clientPhone}</span></div>` : ''}
${car         ? `<div class="row"><span class="label">Автомобиль:</span><span>${car}</span></div>`         : ''}

<div class="section">Товар / услуга</div>
<table>
  <tr>
    <th>#</th><th>Наименование</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th>
  </tr>
  <tr>
    <td>1</td>
    <td>${partName}</td>
    <td>${quantity} шт.</td>
    <td>${priceStr}</td>
    <td>${priceStr}</td>
  </tr>
  <tr class="total-row">
    <td colspan="4" style="text-align:right">ИТОГО:</td>
    <td>${totalStr} ₽</td>
  </tr>
</table>

${COMPANY_BANK || COMPANY_RS ? `
<div class="section">Реквизиты для оплаты</div>
${COMPANY_BANK ? `<div class="row"><span class="label">Банк:</span><span>${COMPANY_BANK}</span></div>` : ''}
${COMPANY_RS   ? `<div class="row"><span class="label">Расчётный счёт:</span><span>${COMPANY_RS}</span></div>` : ''}
${COMPANY_BIK  ? `<div class="row"><span class="label">БИК:</span><span>${COMPANY_BIK}</span></div>` : ''}
` : ''}

<div class="stamp">
  <div class="sign">Подпись / Печать</div>
  <div style="font-size:12px; color:#555; text-align:right">
    Счёт действителен 3 дня<br>
    Оплата = согласие с условиями
  </div>
</div>

</body>
</html>`;
}

// ── Генерация PDF ─────────────────────────────────────────────────────────────
export async function generateInvoicePdf(params) {
  const executablePath = findChromium();
  if (!executablePath) throw new Error('Chromium не найден — PDF недоступен');

  const html = buildInvoiceHtml(params);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
    return pdf; // Buffer
  } finally {
    if (browser) await browser.close();
  }
}

// ── Номер счёта ───────────────────────────────────────────────────────────────
let invoiceCounter = 1000 + new Date().getDate() * 10; // простой счётчик
export function nextInvoiceNum() {
  return `LA-${new Date().getFullYear()}-${++invoiceCounter}`;
}

// ── Форматировать дату ────────────────────────────────────────────────────────
export function todayStr() {
  return new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

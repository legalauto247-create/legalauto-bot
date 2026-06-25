/**
 * Детерминированное извлечение цены авто из текста объявления.
 * Нужно, потому что Claude путается в формате «24.770.000» и может занизить цену.
 * Возвращает «24 770 000 ₽» строго по цифрам из поста, либо '' если цена ненадёжна.
 */
export function extractPriceFromText(text) {
  const t = String(text || '');
  const m = t.match(/стоимост[ьи][^\d]{0,40}?([\d][\d.,\s]{4,}\d)\s*(?:руб|₽|р\.)/i)
         || t.match(/цена[^\d]{0,20}?([\d][\d.,\s]{4,}\d)\s*(?:руб|₽|р\.)/i)
         || t.match(/([\d][\d.,\s]{5,}\d)\s*(?:руб|₽)/i);
  if (!m) return '';
  const digits = m[1].replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 9) return '';
  const n = Number(digits);
  if (n < 300000) return '';   // битая цена в источнике (опечатка) — не показываем неверную
  return n.toLocaleString('ru-RU') + ' ₽';
}

/**
 * LegalAuto — расчёт растаможки + утильсбора (Россия, 2026).
 *
 * calcImport({ engineCc, hp, ageYears, priceEur, eurRate, fuel, commercial })
 *   → { util, duty, clearance, exciseNote, totalRub, breakdown, disclaimer }
 *
 * Утильсбор — из реальной таблицы 2026 (agents/data/utilFee2026.json).
 * Пошлина — ЕТП (единая ставка) для физлиц / совокупный платёж — оценка.
 * Это ПРЕДВАРИТЕЛЬНЫЙ расчёт; точную сумму подтверждает менеджер LegalAuto.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UTIL = JSON.parse(readFileSync(join(__dirname, 'data', 'utilFee2026.json'), 'utf8'));

// Выбор секции таблицы по типу/объёму двигателя
function utilSection(engineCc, fuel) {
  if (fuel === 'electric' || fuel === 'hybrid') return UTIL[0];
  if (engineCc <= 1000) return UTIL[1];
  if (engineCc <= 2000) return UTIL[2];
  if (engineCc <= 3000) return UTIL[3];
  if (engineCc <= 3500) return UTIL[4];
  return UTIL[5];
}
// Парсим "100,01 - 129,99 л.с." → [min,max]
function hpRange(s) {
  const nums = (s.match(/[\d.,]+/g) || []).map(x => parseFloat(x.replace(',', '.')));
  if (/не выше/.test(s)) return [0, nums[0]];
  if (/и более/.test(s) && nums.length === 1) return [nums[0], Infinity];
  return [nums[0], nums[1] ?? Infinity];
}
export function utilFee({ engineCc, hp, ageYears, fuel, commercial }) {
  const sec = utilSection(engineCc, fuel);
  const row = sec.rows.find(r => { const [a, b] = hpRange(r.hp); return hp >= a && hp <= b; })
            || sec.rows[sec.rows.length - 1];
  // Правила 2026 (Пост. № 1713, методика с 01.12.2025): льгота физлица
  // (3400/5200) действует ТОЛЬКО при мощности ≤160 л.с. Свыше — полный тариф.
  if (commercial) {
    return ageYears < 3 ? row.commercial.new : row.commercial.old;
  }
  // физлицо / личное пользование
  if (row.personal && row.personal.new != null) {
    // таблица уже знает льготу/тариф (электро ≤80 л.с., ДВС ≤1000 см³)
    return ageYears < 3 ? row.personal.new : row.personal.old;
  }
  // секции >1000 см³ без данных льготы: ≤160 л.с. → льгота, иначе полный тариф
  if (hp <= 160) return ageYears < 3 ? 3400 : 5200;
  return ageYears < 3 ? row.commercial.new : row.commercial.old;
}

// Пошлина для физлица (ЕТП), евро на см³ или % от стоимости
function dutyEur({ engineCc, ageYears, priceEur }) {
  if (ageYears < 3) {
    const t = priceEur <= 8500 ? [0.54, 2.5]
      : priceEur <= 16700 ? [0.48, 3.5]
      : priceEur <= 42300 ? [0.48, 5.5]
      : priceEur <= 84500 ? [0.48, 7.5]
      : priceEur <= 169000 ? [0.48, 15] : [0.48, 20];
    return Math.max(priceEur * t[0], engineCc * t[1]);
  }
  const perCc = ageYears <= 5
    ? (engineCc <= 1000 ? 1.5 : engineCc <= 1500 ? 1.7 : engineCc <= 1800 ? 2.5 : engineCc <= 2300 ? 2.7 : engineCc <= 3000 ? 3.0 : 3.6)
    : (engineCc <= 1000 ? 3.0 : engineCc <= 1500 ? 3.2 : engineCc <= 1800 ? 3.5 : engineCc <= 2300 ? 4.8 : engineCc <= 3000 ? 5.0 : 5.7);
  return engineCc * perCc;
}

// Таможенный сбор за оформление (по стоимости, руб)
function clearanceFee(valueRub) {
  const t = [[200000,1067],[450000,2134],[1200000,4269],[2700000,11746],[4200000,16524],[5500000,21344],[7000000,27540],[8000000,30000],[9000000,32626],[10000000,35181],[Infinity,40557]];
  for (const [lim, fee] of t) if (valueRub <= lim) return fee;
  return 40557;
}

export function calcImport({ engineCc, hp, ageYears, priceEur, eurRate = 100, fuel = 'petrol', commercial = false }) {
  engineCc = Number(engineCc) || 0; hp = Number(hp) || 0; ageYears = Number(ageYears) || 0;
  priceEur = Number(priceEur) || 0; eurRate = Number(eurRate) || 100;

  const util = utilFee({ engineCc, hp, ageYears, fuel, commercial });
  const dutyR = Math.round(dutyEur({ engineCc, ageYears, priceEur }) * eurRate);
  const valueRub = Math.round(priceEur * eurRate);
  const clearance = clearanceFee(valueRub);
  const totalRub = util + dutyR + clearance;

  return {
    valueRub, util, duty: dutyR, clearance, totalRub,
    breakdown: [
      ['Таможенная пошлина (ЕТП)', dutyR],
      ['Утилизационный сбор 2026', util],
      ['Таможенный сбор за оформление', clearance],
    ],
    disclaimer: 'Предварительный расчёт для физлица. Точную сумму с учётом акциза/НДС подтвердит менеджер LegalAuto.',
  };
}

export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';

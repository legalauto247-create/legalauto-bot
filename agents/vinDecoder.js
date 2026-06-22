/**
 * LegalAuto — VIN Декодер + AI Поиск запчастей
 *
 * VIN структура: WMI(3) + VDS(6) + VIS(8) = 17 символов
 * NHTSA API — бесплатный, без ключа
 *
 * Использование в боте:
 *   import { decodeVin, searchParts } from './agents/vinDecoder.js';
 */

import fetch from 'node-fetch';
import Anthropic from '@anthropic-ai/sdk';

const claude = process.env.CLAUDE_API_KEY
  ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
  : null;

// ── WMI таблица производителей (расширенная) ──────────────────────────────
const WMI_MAP = {
  'WBA': { make: 'BMW',       country: 'Германия' },
  'WBS': { make: 'BMW M',     country: 'Германия' },
  'WBY': { make: 'BMW',       country: 'Германия' },
  'WDC': { make: 'Mercedes',  country: 'Германия' },
  'WDD': { make: 'Mercedes',  country: 'Германия' },
  'WAU': { make: 'Audi',      country: 'Германия' },
  'WVW': { make: 'VW',        country: 'Германия' },
  'JHM': { make: 'Honda',     country: 'Япония'   },
  'JN1': { make: 'Nissan',    country: 'Япония'   },
  'JT2': { make: 'Toyota',    country: 'Япония'   },
  'JT3': { make: 'Toyota',    country: 'Япония'   },
  'JTD': { make: 'Toyota',    country: 'Япония'   },
  'KNA': { make: 'Kia',       country: 'Корея'    },
  'KNB': { make: 'Kia',       country: 'Корея'    },
  'KMH': { make: 'Hyundai',   country: 'Корея'    },
  'LVV': { make: 'Volvo China', country: 'Китай'  },
  'LSG': { make: 'Geely',     country: 'Китай'    },
  'LSJ': { make: 'Geely',     country: 'Китай'    },
  'LFV': { make: 'VW China',  country: 'Китай'    },
  'L6T': { make: 'Li Auto',   country: 'Китай'    },
  'XTA': { make: 'Lada',      country: 'Россия'   },
  'X7L': { make: 'Lada',      country: 'Россия'   },
  'X9F': { make: 'UAZ',       country: 'Россия'   },
  '1HG': { make: 'Honda',     country: 'США'      },
  '1G1': { make: 'Chevrolet', country: 'США'      },
  '1FA': { make: 'Ford',      country: 'США'      },
};

// Год по 10-му символу VIN
const YEAR_MAP = {
  'A':2010,'B':2011,'C':2012,'D':2013,'E':2014,'F':2015,'G':2016,
  'H':2017,'J':2018,'K':2019,'L':2020,'M':2021,'N':2022,'P':2023,
  'R':2024,'S':2025,'T':2026,'V':2027,
  '1':2001,'2':2002,'3':2003,'4':2004,'5':2005,'6':2006,'7':2007,
  '8':2008,'9':2009,
};

/**
 * Декодирует VIN номер
 * @param {string} vin
 * @returns {object} информация об автомобиле
 */
export async function decodeVin(vin) {
  const v = String(vin || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

  if (v.length !== 17) {
    return { ok: false, error: `VIN должен быть 17 символов (получено ${v.length})` };
  }

  const wmi    = v.substring(0, 3);
  const yearCh = v.charAt(9);
  const local  = WMI_MAP[wmi] || { make: 'Неизвестно', country: '—' };
  const year   = YEAR_MAP[yearCh] || null;

  // Пробуем NHTSA API (бесплатный)
  let nhtsaData = null;
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${v}?format=json`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      nhtsaData = parseNhtsa(json.Results || []);
    }
  } catch (e) {
    // NHTSA недоступен — используем локальные данные
  }

  const make  = nhtsaData?.make  || local.make;
  const model = nhtsaData?.model || '';
  const yr    = nhtsaData?.year  || year;

  return {
    ok: true,
    vin: v,
    make,
    model,
    year:    yr,
    country: local.country,
    body:    nhtsaData?.body || '',
    engine:  nhtsaData?.engine || '',
    trim:    nhtsaData?.trim || '',
    full:    [make, model, yr].filter(Boolean).join(' '),
  };
}

function parseNhtsa(results) {
  const get = (var_) => {
    const r = results.find(x => x.Variable === var_);
    return r && r.Value && r.Value !== 'Not Applicable' ? r.Value : null;
  };
  return {
    make:   get('Make'),
    model:  get('Model'),
    year:   get('Model Year') ? Number(get('Model Year')) : null,
    body:   get('Body Class'),
    engine: get('Displacement (L)') ? get('Displacement (L)') + 'L' : null,
    trim:   get('Trim'),
  };
}

/**
 * AI поиск запчастей по естественному языку
 * @param {string} query - текст запроса
 * @param {object} vinInfo - результат decodeVin (опционально)
 * @returns {object} структурированный поисковый запрос
 */
export async function parseSearchQuery(query, vinInfo) {
  if (!claude) {
    return basicParse(query, vinInfo);
  }

  const vinCtx = vinInfo?.ok
    ? `Автомобиль клиента: ${vinInfo.full} (VIN: ${vinInfo.vin})`
    : '';

  const prompt = `Ты парсер поисковых запросов для магазина автозапчастей LegalAuto (BMW, Geely, Li Auto).

${vinCtx}

Запрос покупателя: "${query}"

Извлеки в JSON (только JSON, без markdown):
{
  "brand": "марка авто или null",
  "model": "модель или null",
  "year_from": число или null,
  "year_to": число или null,
  "part_name": "название детали на русском",
  "oem": "OEM артикул если указан или null",
  "condition": "новое|бу|любое",
  "price_max": число или null,
  "search_text": "текст для поиска по каталогу"
}`;

  try {
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return basicParse(query, vinInfo);
  }
}

function basicParse(query, vinInfo) {
  const q = query.toLowerCase();
  const brands = ['bmw', 'geely', 'li auto', 'toyota', 'mercedes', 'audi', 'hyundai', 'kia', 'nissan', 'honda'];
  const found = brands.find(b => q.includes(b));
  const priceMatch = q.match(/до\s*(\d+)/);
  return {
    brand:       vinInfo?.make || (found ? found.toUpperCase() : null),
    model:       vinInfo?.model || null,
    part_name:   query,
    oem:         null,
    condition:   'любое',
    price_max:   priceMatch ? Number(priceMatch[1]) : null,
    search_text: query,
  };
}

/**
 * Форматирует результат VIN декодирования для Telegram
 */
export function formatVinResult(info) {
  if (!info.ok) return `❌ ${info.error}`;
  const lines = [
    `🔍 *VIN: ${info.vin}*`,
    '',
    `🚗 *${info.full || info.make}*`,
    info.body   ? `Кузов: ${info.body}`    : '',
    info.engine ? `Двигатель: ${info.engine}` : '',
    info.trim   ? `Комплектация: ${info.trim}` : '',
    `🌍 Страна: ${info.country}`,
    '',
    `_Подобрать запчасти для этого авто — просто напишите название детали_`,
  ].filter(l => l !== undefined);
  return lines.join('\n').replace(/\n\n\n/g, '\n\n');
}

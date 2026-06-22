/**
 * 🛠️ Helper Functions — LegalAuto Jarvis
 * Вспомогательные функции для работы системы
 */

// ════════════════════════════════════════════════════════════════════════════
// ФОРМАТИРОВАНИЕ
// ════════════════════════════════════════════════════════════════════════════

export function formatPrice(price) {
  if (!price) return '₽0';
  return `₽${Math.round(price).toLocaleString('ru-RU')}`;
}

export function formatPercent(value) {
  if (!value) return '0%';
  return `${Math.round(value)}%`;
}

export function formatDate(date = new Date()) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTime(date = new Date()) {
  return new Date(date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(date = new Date()) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function truncate(str, length = 100) {
  if (!str) return '';
  return str.length > length ? str.slice(0, length) + '...' : str;
}

// ════════════════════════════════════════════════════════════════════════════
// ПРОВЕРКИ И ВАЛИДАЦИЯ
// ════════════════════════════════════════════════════════════════════════════

export function isValidPrice(price) {
  return typeof price === 'number' && price > 0 && price < 1000000;
}

export function isValidPercent(percent) {
  return typeof percent === 'number' && percent >= 0 && percent <= 100;
}

export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isDuring(hour, minHour, maxHour) {
  const now = new Date().getHours();
  return now >= minHour && now < maxHour;
}

export function isMorning() {
  return isDuring(new Date().getHours(), 6, 12);
}

export function isEvening() {
  return isDuring(new Date().getHours(), 18, 24);
}

// ════════════════════════════════════════════════════════════════════════════
// СЛУЧАЙНЫЕ ВЫБОРЫ
// ════════════════════════════════════════════════════════════════════════════

export function random(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ════════════════════════════════════════════════════════════════════════════
// РАБОТА СО СТРОКАМИ
// ════════════════════════════════════════════════════════════════════════════

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function cleanString(str) {
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-\.]/g, '');
}

// ════════════════════════════════════════════════════════════════════════════
// РАБОТА С МАССИВАМИ
// ════════════════════════════════════════════════════════════════════════════

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
}

export function unique(arr, key = null) {
  if (!key) return [...new Set(arr)];
  const seen = new Set();
  return arr.filter(item => {
    const val = item[key];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

export function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

export function avg(arr) {
  return arr.length === 0 ? 0 : sum(arr) / arr.length;
}

export function min(arr) {
  return arr.length === 0 ? null : Math.min(...arr);
}

export function max(arr) {
  return arr.length === 0 ? null : Math.max(...arr);
}

// ════════════════════════════════════════════════════════════════════════════
// РАБОТА С ОБЪЕКТАМИ
// ════════════════════════════════════════════════════════════════════════════

export function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (key in obj) acc[key] = obj[key];
    return acc;
  }, {});
}

export function omit(obj, keys) {
  return Object.entries(obj)
    .filter(([k]) => !keys.includes(k))
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

export function merge(obj1, obj2) {
  return { ...obj1, ...obj2 };
}

export function deepMerge(obj1, obj2) {
  const result = { ...obj1 };
  for (const key in obj2) {
    if (typeof obj2[key] === 'object' && obj2[key] !== null) {
      result[key] = deepMerge(result[key] || {}, obj2[key]);
    } else {
      result[key] = obj2[key];
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// ЗАДЕРЖКИ И TIMEOUT
// ════════════════════════════════════════════════════════════════════════════

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry(fn, maxAttempts = 3, delay = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await sleep(delay * (i + 1));
    }
  }
}

export function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ]);
}

// ════════════════════════════════════════════════════════════════════════════
// ЛОГИРОВАНИЕ
// ════════════════════════════════════════════════════════════════════════════

export function log(tag, msg, level = 'info') {
  const levels = { info: '📘', warn: '⚠️', error: '🔴', success: '✅' };
  const icon = levels[level] || '📘';
  const time = formatTime();
  console.log(`${icon} [${tag}] ${time}: ${msg}`);
}

export function logSuccess(tag, msg) {
  log(tag, msg, 'success');
}

export function logError(tag, msg) {
  log(tag, msg, 'error');
}

export function logWarn(tag, msg) {
  log(tag, msg, 'warn');
}

// ════════════════════════════════════════════════════════════════════════════
// КЭШИРОВАНИЕ
// ════════════════════════════════════════════════════════════════════════════

const cache = new Map();

export function memoize(fn, ttl = 60000) {
  return async function (...args) {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      const { value, expires } = cache.get(key);
      if (Date.now() < expires) {
        return value;
      }
      cache.delete(key);
    }

    const value = await fn(...args);
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  };
}

export function clearCache() {
  cache.clear();
}

console.log('✅ Utils загружены');

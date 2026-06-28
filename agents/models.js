/**
 * Единый выбор «мозга» для всех агентов LegalAuto.
 * Берём из Railway env (уже заданы), с разумными дефолтами.
 *
 *   HEAVY — сильная модель для КОНТЕНТА (новости, посты, объявления) → качество
 *   SMART — баланс для диалогов
 *   FAST  — дешёвая для классификации/фильтров (да/нет, релевантность)
 */
export const HEAVY = process.env.CLAUDE_HEAVY_MODEL || 'claude-opus-4-8';
export const SMART = process.env.CLAUDE_MODEL       || 'claude-sonnet-4-6';
export const FAST  = process.env.FAST_MODEL         || 'claude-haiku-4-5-20251001';

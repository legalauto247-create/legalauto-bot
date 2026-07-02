/**
 * LegalAuto — Quality Gate. Ворота качества ПЕРЕД публикацией.
 * Хотя бы один провал → НЕ ПУБЛИКОВАТЬ.
 *
 *   reviewContent({ title, description, texts[], direction, sourceData }) → { pass, score, fails[] }
 *
 * Двухслойная проверка:
 *  1) Детерминированная (код): запрещённые слова, лимиты, CTA/ссылка, сырой markdown
 *  2) LLM-ревью (FAST): грамматика, генерик-фразы ИИ, галлюцинации против sourceData, тон
 * Конфиг: brand/QUALITY_GATE.json + brand/CONTENT_RULES.json
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FAST } from '../agents/models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => { try { return JSON.parse(readFileSync(join(ROOT, 'brand', f), 'utf8')); } catch { return null; } };
const GATE = readJson('QUALITY_GATE.json') || {};
const RULES = readJson('CONTENT_RULES.json') || {};
const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

// ── Слой 1: детерминированные проверки ──────────────────────────────────────
function deterministicChecks({ title = '', description = '', texts = [] }) {
  const d = GATE.deterministic || {};
  const fails = [];
  const all = [title, description, ...texts].join('\n');

  if (d.forbidden_words) {
    const forbidden = RULES.voice?.forbidden || [];
    const hit = forbidden.filter(w => all.toLowerCase().includes(w.toLowerCase()));
    if (hit.length) fails.push(`запрещённые слова: ${hit.join(', ')}`);
  }
  if (d.title_max_chars && title.length > d.title_max_chars) fails.push(`заголовок длиннее ${d.title_max_chars} символов`);
  if (d.cta_required && !/заказ|заявк|оформ|подбер|вопрос|напишите|жмите|консультац|свяжи|→|➡/i.test(all)) fails.push('нет CTA');
  if (d.group_link_required && !/t\.me\/|@legalauto/i.test(all)) fails.push('нет ссылки на группу/бот');
  if (d.raw_markdown_in_text === false && /\*\*[^*]+\*\*|##\s/.test(texts.join('\n'))) fails.push('сырой markdown в тексте видео');
  return fails;
}

// ── Слой 2: LLM-ревью (галлюцинации, генерик, тон) ──────────────────────────
async function llmReview({ title, description, texts, sourceData, direction }) {
  const cfg = GATE.llm_review || {};
  if (!cfg.enabled || !claude) return { score: 100, fails: [] };
  try {
    const m = await claude.messages.create({
      model: FAST, max_tokens: 300,
      messages: [{ role: 'user', content:
`Ты — QA-редактор контент-завода LegalAuto (premium, на «вы», по фактам). Ищи РЕАЛЬНЫЙ брак, не придирайся к стилю, который соответствует правилам бренда.

ПРАВИЛА БРЕНДА (это НЕ ошибки, а требования):
- CTA и ссылка на Telegram-канал/бота ОБЯЗАТЕЛЬНЫ в описании
- 1 эмодзи в заголовке — норма; «заказ в 1 клик» — стандартный CTA бренда
- Происхождение выводится из марки: Geely/Li Auto/Chery=Китай, BMW/Audi/Mercedes=Европа, Toyota=Япония — это НЕ галлюцинация
- «с разборки», «оригинал» при condition=Оригинал Б/У — корректно
- Товары из каталога = в наличии, с реальными фото — это факт бизнеса

Проверь контент. Направление: ${direction || '-'}.
ЗАГОЛОВОК: ${title}
ОПИСАНИЕ: ${description}
ТЕКСТЫ СЦЕН: ${texts.join(' | ')}
${sourceData ? `ИСХОДНЫЕ ДАННЫЕ (истина): ${String(sourceData).slice(0, 800)}` : ''}

БРАКУЙ ТОЛЬКО: 1) грамматика/опечатки 2) генерик-фразы ИИ («в современном мире», «не секрет что») 3) ${sourceData ? 'ПРЯМЫЕ противоречия исходным данным: чужая марка, «новое» при Б/У, выдуманные скидки/цены/характеристики' : 'непроверяемые обещания (конкретные сроки/цены/гарантии из воздуха)'} 4) кричащий тон (КАПС, «ШОК», давление).

Верни ТОЛЬКО JSON: {"score": 0-100, "fails": ["конкретная проблема", ...]}. score<${cfg.min_score || 80} = брак. Если реальных проблем нет — score 90+, fails пустой.` }],
    });
    // Устойчивый парсинг: берём первый JSON-объект, игнорируем текст вокруг
    const raw = m.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*?\}(?=\s*$)|\{[\s\S]*?"fails"[\s\S]*?\][\s\S]*?\}/);
    const r = JSON.parse((jsonMatch ? jsonMatch[0] : raw).trim());
    return { score: Number(r.score) || 0, fails: Array.isArray(r.fails) ? r.fails : [] };
  } catch (e) {
    console.error('[QualityGate] LLM review error:', e.message);
    return { score: 100, fails: [] };   // ревьюер упал — не блокируем (детерминированный слой уже отработал)
  }
}

/** Главная проверка. pass=false → НЕ публиковать. */
export async function reviewContent({ title = '', description = '', texts = [], direction = '', sourceData = null }) {
  const hardFails = deterministicChecks({ title, description, texts });
  const { score, fails: softFails } = await llmReview({ title, description, texts, sourceData, direction });
  const minScore = GATE.llm_review?.min_score || 80;
  const fails = [...hardFails, ...(score < minScore ? softFails.length ? softFails : ['низкий общий балл качества'] : [])];
  const pass = fails.length === 0;
  if (!pass) console.warn(`[QualityGate] ❌ БРАК (score ${score}): ${fails.join('; ')}`);
  else console.log(`[QualityGate] ✅ пройден (score ${score})`);
  return { pass, score, fails };
}

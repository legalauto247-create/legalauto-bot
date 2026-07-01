/**
 * LegalAuto — JARVIS BRAIN (агент на мозгах, не на скриптах).
 *
 * Claude Opus = оркестратор: понимает запрос Эдо и САМ вызывает инструменты.
 * OpenAI gpt-image = рисует. Gemini = длинный контекст / второе мнение.
 * Память = memoryAgent (+ claude-mem на уровне Claude Code).
 *
 * jarvisThink(userText, { telegram, chatId }) → текст ответа (картинки шлёт сам)
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HEAVY } from './models.js';

const __d = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__d, '..');

// Дизайн-память: спека, извлечённая из шаблонов Эдо (brand/templates-spec.md) + токены
function loadDesignMemory() {
  let spec = '', style = '';
  try { if (existsSync(join(ROOT, 'brand', 'templates-spec.md'))) spec = readFileSync(join(ROOT, 'brand', 'templates-spec.md'), 'utf8').slice(0, 1800); } catch {}
  try {
    const t = JSON.parse(readFileSync(join(ROOT, 'brand', 'tokens.json'), 'utf8'));
    style = `Фирстиль: чёрный фон ${t.color?.bg}, золото ${t.color?.gold}, серебро ${t.color?.silver}, шрифт ${t.font?.display?.family}. Эмблема — щит LA.`;
  } catch {}
  return { spec, style };
}
const DESIGN = loadDesignMemory();
// Префикс стиля для gpt-image — чтобы картинки выходили как в шаблонах Эдо
const IMG_STYLE = `Premium LegalAuto brand style: deep black background, gold (#D4AF37) and silver accents, elegant cinematic, matches LegalAuto premium templates. `;
import { getStats, formatReport } from './analyticsAgent.js';
import { calcImport, fmt } from './customsCalc.js';
import { generateImage } from './imageGenAgent.js';
import { getAutoAdsStatus, pollPublicChannels } from './autoAdsAgent.js';
import { prepareAutoPost, publishToChannel } from './postAgent.js';
import { learnFact, buildSystemPrompt, addConversation } from './memoryAgent.js';
import { makeProductShort } from './contentAgent.js';

const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const TOOLS = [
  { name: 'platform_status', description: 'Статус платформы: автообъявления, каналы, очереди.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_analytics', description: 'Аналитика бизнеса: запчасти, публикации, лиды, выручка.', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today','week','month','all'] } } } },
  { name: 'calc_customs', description: 'Рассчитать растаможку+утильсбор авто (РФ 2026).', input_schema: { type: 'object', properties: { engineCc: { type: 'number' }, hp: { type: 'number' }, ageYears: { type: 'number' }, priceEur: { type: 'number' } }, required: ['engineCc','hp','ageYears','priceEur'] } },
  { name: 'generate_image', description: 'Нарисовать изображение через OpenAI gpt-image (фон, баннер, иллюстрация). Сразу отправляет картинку Эдо.', input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'scan_partner_cars', description: 'Просканировать канал партнёра и прислать свежие авто на одобрение.', input_schema: { type: 'object', properties: {} } },
  { name: 'post_part', description: 'Опубликовать одну запчасть в канал запчастей сейчас.', input_schema: { type: 'object', properties: {} } },
  { name: 'ask_gemini', description: 'Спросить Gemini (длинный контекст, второе мнение, анализ больших данных).', input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'remember', description: 'Запомнить факт/решение Эдо навсегда.', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'make_short', description: 'Сделать и выложить вирусный Short про запчасти (реальные запчасти из каталога + музыка + субтитры) на YouTube и/или Telegram. ВАЖНО: если Эдо просит конкретную тему (кузовные, оптика/фары, двигатель, подвеска, тормоза, электрика, салон, трансмиссия) — ОБЯЗАТЕЛЬНО передай её в theme, иначе ролик будет про случайные запчасти. Запчасти перемешиваются и не повторяются от ролика к ролику.', input_schema: { type: 'object', properties: { platforms: { type: 'array', items: { type: 'string', enum: ['youtube', 'telegram'] } }, theme: { type: 'string', description: 'Тема/категория запчастей из запроса Эдо, напр. "кузовные", "оптика", "двигатель". Пусто — любые.' } } } },
];

async function runTool(name, input, ctx) {
  try {
    switch (name) {
      case 'platform_status': {
        const a = getAutoAdsStatus();
        return `Автообъявления: ${a.enabled ? 'вкл' : 'выкл'}, каналов-партнёров ${a.partners}, на одобрении ${a.pending}. Канал авто: ${a.channel}.`;
      }
      case 'get_analytics': {
        const st = await getStats(input.period || 'week');
        return formatReport(st, input.period || 'week');
      }
      case 'calc_customs': {
        const r = calcImport({ ...input, eurRate: Number(process.env.EUR_RATE || 105) });
        return `Растаможка+утиль:\n- Пошлина: ${fmt(r.duty)}\n- Утильсбор: ${fmt(r.util)}\n- Сбор: ${fmt(r.clearance)}\n- ИТОГО: ${fmt(r.totalRub)}`;
      }
      case 'generate_image': {
        // Всегда рисуем в фирменном стиле LegalAuto (по шаблонам Эдо)
        const styledPrompt = `${IMG_STYLE}${input.prompt}. No text, no words, no letters.`;
        const img = await generateImage(styledPrompt, { size: '1024x1536' });
        const buf = img?.buffer || (img?.url ? null : null);
        if (buf && ctx?.telegram && ctx?.chatId) {
          await ctx.telegram.sendPhoto(ctx.chatId, { source: buf }, { caption: '🎨 Готово' }).catch(() => {});
          return 'Картинка сгенерирована и отправлена Эдо.';
        }
        return img?.url ? `Картинка: ${img.url}` : 'Не удалось сгенерировать изображение.';
      }
      case 'scan_partner_cars': {
        await pollPublicChannels();
        return 'Просканировал каналы партнёров — свежие авто ушли на одобрение (если были новые).';
      }
      case 'post_part': {
        const res = await prepareAutoPost('jarvis');
        if (!res.ok) return `Не удалось: ${res.error}`;
        if (ctx?.telegram) await publishToChannel(ctx.telegram, res.post);
        return `Опубликована запчасть: ${res.post?.part?.brand} ${res.post?.part?.name}`;
      }
      case 'ask_gemini': {
        if (!gemini) return 'Gemini не подключён.';
        const m = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const r = await m.generateContent(input.prompt);
        return r.response.text().slice(0, 1500);
      }
      case 'remember': {
        learnFact(input.fact);
        return `Запомнил: ${input.fact}`;
      }
      case 'make_short': {
        const platforms = input.platforms?.length ? input.platforms : ['youtube'];
        const theme = String(input.theme || '').trim();
        // Рендер долгий — запускаем в фоне, сообщаем результат отдельным сообщением
        makeProductShort({ platforms, theme }).then((r) => {
          const txt = r.ok
            ? `✅ Ролик готов!${theme ? ` (тема: ${theme})` : ''}\n${r.ytUrl || ''}${r.tgOk ? '\n+ выложен в Telegram' : ''}\nЗапчасти: ${(r.partsUsed || []).slice(0, 4).join(', ')}`
            : `❌ Не вышло: ${r.error}`;
          ctx?.telegram?.sendMessage(ctx.chatId, txt).catch(() => {});
        }).catch((e) => ctx?.telegram?.sendMessage(ctx.chatId, '❌ Ошибка генерации: ' + e.message).catch(() => {}));
        return `Запустил генерацию ролика${theme ? ` по теме «${theme}»` : ''} (${platforms.join(', ')}) — пришлю ссылку через ~5 минут, рендер идёт.`;
      }
      default: return `Неизвестный инструмент: ${name}`;
    }
  } catch (e) {
    return `Ошибка инструмента ${name}: ${e.message}`;
  }
}

const PERSONA =
`Ты — JARVIS, личный AI-управляющий автоимперией LegalAuto (владелец — Эдо).
Говоришь с Эдо по-человечески, как умный напарник: коротко, по делу, на «ты».
Ты не меню и не скрипт — ты думаешь и САМ вызываешь нужные инструменты, чтобы выполнить задачу.
Если задача из нескольких шагов — выполняешь по очереди. Если данных не хватает — спрашиваешь одним вопросом.
Бренд: пригон авто (@LegalAutoStore), запчасти (@LegalAutoParts24), новости для импортёров (@LegalAuto24), документы СБКТС/ЭПТС/утиль.
Факт 2026: льготный утильсбор физлица 3400/5200 ₽ — ТОЛЬКО при мощности ≤160 л.с. и 1 авто/год; свыше 160 л.с. физлицо платит полный тариф (как юрлицо). Не вводи в заблуждение.`;

export async function jarvisThink(userText, ctx = {}) {
  if (!claude) return 'Мозг недоступен: не задан CLAUDE_API_KEY.';
  const designBlock = `\n\n## Дизайн (бери из шаблонов Эдо, не выдумывай свой)\n${DESIGN.style}\nКогда делаешь картинку/пост — следуй фирстилю и структуре шаблонов:\n${DESIGN.spec}`;
  const system = `${PERSONA}${designBlock}\n\n${(() => { try { return buildSystemPrompt(); } catch { return ''; } })()}`;
  let messages = [{ role: 'user', content: userText }];

  try {
    for (let i = 0; i < 6; i++) {
      const resp = await claude.messages.create({ model: HEAVY, max_tokens: 1500, system, tools: TOOLS, messages });
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const results = [];
        for (const b of resp.content) {
          if (b.type === 'tool_use') {
            const out = await runTool(b.name, b.input || {}, ctx);
            results.push({ type: 'tool_result', tool_use_id: b.id, content: String(out) });
          }
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      try { addConversation('user', userText); addConversation('assistant', text); } catch {}
      return text || 'Готово.';
    }
    return 'Слишком много шагов — уточни задачу, пожалуйста.';
  } catch (e) {
    return `Сбой мозга: ${e.message}`;
  }
}

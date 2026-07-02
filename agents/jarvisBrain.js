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
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HEAVY } from './models.js';

const __d = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__d, '..');

// Дизайн-память: машиночитаемые правила бренда (JSON — единый источник правды)
// CONTENT_RULES.json — тон/лимиты/запреты; VIDEO_TEMPLATES.json — библиотека шаблонов;
// IMAGE_STYLE_GUIDE.json — стиль AI-картинок. Плюс legacy: templates-spec.md, tokens.json.
function loadDesignMemory() {
  let spec = '', style = '', rules = '';
  const readJson = (f) => { try { return JSON.parse(readFileSync(join(ROOT, 'brand', f), 'utf8')); } catch { return null; } };
  try { if (existsSync(join(ROOT, 'brand', 'templates-spec.md'))) spec = readFileSync(join(ROOT, 'brand', 'templates-spec.md'), 'utf8').slice(0, 1200); } catch {}
  try {
    const t = readJson('tokens.json');
    style = `Фирстиль: чёрный фон ${t?.color?.bg}, золото ${t?.color?.gold}, серебро ${t?.color?.silver}, шрифт ${t?.font?.display?.family}. Эмблема — щит LA.`;
  } catch {}
  const cr = readJson('CONTENT_RULES.json');
  const vt = readJson('VIDEO_TEMPLATES.json');
  if (cr) {
    rules += `\n## CONTENT_RULES v${cr.version} (соблюдать ЖЁСТКО)\n` +
      `Тон: на «${cr.voice?.address}», ${cr.voice?.tone}. Запрещено: ${(cr.voice?.forbidden || []).join(', ')}.\n` +
      `Факты: ${(cr.voice?.hard_facts || []).join(' | ')}\n` +
      `Направления: ${Object.entries(cr.directions || {}).map(([k, d]) => `${k}=${d.brand_line} ${d.channel} ${d.accent}`).join('; ')}\n` +
      `Short: хук ≤${cr.formats?.short_video?.hook_max_words} слов, заголовок YT ≤${cr.formats?.short_video?.yt_title_max_chars} симв, хэштегов ${cr.formats?.short_video?.hashtags}, deep-link заявки обязателен.`;
  }
  if (vt) {
    rules += `\n## VIDEO_TEMPLATES v${vt.version}\n` +
      Object.entries(vt).filter(([k]) => !k.startsWith('_') && k !== 'version')
        .map(([k, t]) => `${k} (${t.composition}): ${t.use_for}`).join('\n');
  }
  const dt = readJson('DESIGN_TOKENS.json');
  if (dt) {
    rules += `\n## DESIGN_TOKENS v${dt.version} — все цвета/шрифты ТОЛЬКО отсюда\n` +
      `Цвета: ${Object.entries(dt.colors || {}).map(([k, v]) => `${k}=${v}`).join(', ')}. ` +
      `Шрифт: ${dt.fonts?.title?.family}. Лого: ${dt.logo?.mark} (${dt.logo?.position_video}).`;
  }
  const cg = readJson('CONTENT_GRAPH.json');
  if (cg) {
    rules += `\n## CONTENT_GRAPH v${cg.version} — цепочку выбираешь ТЫ по типу контента\n` +
      Object.entries(cg).filter(([k]) => !k.startsWith('_') && !['version', 'ctas'].includes(k))
        .map(([k, g]) => `${k}: ${g.direction} → ${g.video_template} → музыка ${(g.music_genre || []).join('/')} → CTA "${(cg.ctas || {})[g.cta] || g.cta}" → ${Object.values(g.publish || {}).join(' + ')}`).join('\n');
  }
  const al = readJson('ASSET_LIBRARY.json');
  if (al) {
    const music = Object.entries(al.music || {}).filter(([k]) => !k.startsWith('_')).map(([g, m]) => `${g}(${(m.files || []).length})`).join(', ');
    rules += `\n## ASSET_LIBRARY v${al.version} — используй ассеты по ID, НЕ ищи в интернете\n` +
      `Фоны: ${Object.keys(al.backgrounds || {}).join(', ')}. Музыка: ${music}. ` +
      `Фото товара: только из каталога (${al.product_photos?.count}). Лого: ${Object.keys(al.logos || {}).join(', ')}.`;
  }
  // TEMPLATE LIBRARY: templates/**/*.json — Эдо наполняет, Jarvis выбирает
  try {
    const cats = readdirSync(join(ROOT, 'templates'), { withFileTypes: true }).filter(d => d.isDirectory());
    const list = [];
    for (const c of cats) {
      for (const f of readdirSync(join(ROOT, 'templates', c.name)).filter(x => x.endsWith('.json'))) {
        try { const t = JSON.parse(readFileSync(join(ROOT, 'templates', c.name, f), 'utf8')); list.push(`${t.id} [${c.name}/${t.direction}]: ${t.use_for}`); } catch {}
      }
    }
    if (list.length) rules += `\n## TEMPLATE LIBRARY (выбирай шаблон по задаче)\n${list.join('\n')}`;
  } catch {}
  return { spec, style, rules };
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
import { makeProductShort, makeInfoShort, makeCinematicShort } from './contentAgent.js';
import { stateSummary, logEvent as stateEvent } from '../services/stateService.js';
import { runHealthCheck, formatHealth } from '../services/healthMonitor.js';

const claude = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const TOOLS = [
  { name: 'platform_health', description: 'ЗДОРОВЬЕ ПЛАТФОРМЫ — живые проверки ПРЯМО СЕЙЧАС: боты (getMe), YouTube-токен, ключи OpenAI/Claude, GAS-каталог, автопост, зависшие задачи (жнец). Вызывай на «здоровье платформы / что сломалось / всё ли работает / проверь систему». Возвращает: что живо, что сломано, что зависло, что требует действия Эдо.', input_schema: { type: 'object', properties: {} } },
  { name: 'platform_state', description: 'ЕДИНОЕ СОСТОЯНИЕ ПЛАТФОРМЫ: живые компоненты (heartbeat), задачи со статусами (created/processing/done/failed), последние провалы, журнал событий. ВСЕГДА вызывай ПЕРВЫМ на вопросы «что происходит / как дела / статус / что сегодня / всё ли работает» — отвечай ФАКТАМИ отсюда, не гадай.', input_schema: { type: 'object', properties: {} } },
  { name: 'platform_status', description: 'Статус платформы: автообъявления, каналы, очереди.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_analytics', description: 'Аналитика бизнеса: запчасти, публикации, лиды, выручка.', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today','week','month','all'] } } } },
  { name: 'calc_customs', description: 'Рассчитать растаможку+утильсбор авто (РФ 2026).', input_schema: { type: 'object', properties: { engineCc: { type: 'number' }, hp: { type: 'number' }, ageYears: { type: 'number' }, priceEur: { type: 'number' } }, required: ['engineCc','hp','ageYears','priceEur'] } },
  { name: 'generate_image', description: 'Нарисовать изображение через OpenAI gpt-image (фон, баннер, иллюстрация). Сразу отправляет картинку Эдо.', input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'scan_partner_cars', description: 'Просканировать канал партнёра и прислать свежие авто на одобрение.', input_schema: { type: 'object', properties: {} } },
  { name: 'post_part', description: 'Опубликовать одну запчасть в канал запчастей сейчас.', input_schema: { type: 'object', properties: {} } },
  { name: 'ask_gemini', description: 'Спросить Gemini (длинный контекст, второе мнение, анализ больших данных).', input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'save_template', description: 'Template Registry: сохранить НОВЫЙ шаблон контента в библиотеку templates/. ПОРЯДОК: сначала покажи Эдо черновик шаблона в чате и дождись его «да/сохраняй»; только после подтверждения вызывай с confirm=true. Категории: news/parts/shorts.', input_schema: { type: 'object', properties: { category: { type: 'string', enum: ['news', 'parts', 'shorts', 'docs', 'store'] }, id: { type: 'string', description: 'уникальный id, напр. docs_short_002' }, template_json: { type: 'string', description: 'JSON шаблона строкой (id, direction, use_for, structure, metrics)' }, confirm: { type: 'boolean', description: 'true ТОЛЬКО после явного подтверждения Эдо в чате' } }, required: ['category', 'id', 'template_json', 'confirm'] } },
  { name: 'remember', description: 'Запомнить НАВСЕГДА: предпочтение Эдо, его правку по стилю, решение или важный факт бизнеса. Вызывай ПРОАКТИВНО, без напоминаний — как только Эдо что-то поправил/попросил делать иначе/сообщил новый факт.', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'make_cinematic', description: 'ВЫСШИЙ УРОВЕНЬ. Сделать премиум КИНО-ролик на любую тему (документы, пригон авто, услуги, советы): каждая сцена — кинематографичная AI-картинка (gpt-image) + брендовый оверлей LegalAuto. Выглядит как дорогая реклама. Используй ЭТОТ инструмент, когда Эдо хочет качество/«высший уровень»/красивый ролик, а тема НЕ про конкретные запчасти из каталога. direction: docs/auto/parts.', input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Тема ролика словами Эдо.' }, direction: { type: 'string', enum: ['docs', 'auto', 'parts'] }, platforms: { type: 'array', items: { type: 'string', enum: ['youtube', 'telegram'] } }, group_link: { type: 'string' } }, required: ['topic'] } },
  { name: 'make_info_short', description: 'Сделать и выложить ИНФО-ролик (Short) на ЛЮБУЮ тему в фирстиле LegalAuto по брендбуку: документы (СБКТС/ЭПТС/утиль/таможня), пригон авто, полезные советы — НЕ из каталога запчастей. Сам пишет сценарий (хук + 4-5 пунктов + CTA), берёт музыку по направлению, добавляет ссылку на группу. Используй ЭТОТ инструмент для тем про документы/оформление/пригон/советы, а make_short — только для роликов про конкретные запчасти из каталога.', input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Тема ролика словами Эдо, напр. "как оформить СБКТС и ЭПТС", "растаможка авто из Китая".' }, direction: { type: 'string', enum: ['docs', 'auto', 'parts'], description: 'docs — документы (@LegalAuto24, бирюза); auto — пригон (@LegalAutoStore, золото); parts — запчасти (@LegalAutoParts24, оранж).' }, platforms: { type: 'array', items: { type: 'string', enum: ['youtube', 'telegram'] } }, group_link: { type: 'string', description: 'Ссылка на группу/канал, если Эдо дал конкретную (напр. t.me/LegalAuto24).' } }, required: ['topic'] } },
  { name: 'make_short', description: 'Сделать и выложить вирусный Short про запчасти (реальные запчасти из каталога + музыка + субтитры) на YouTube и/или Telegram. ВАЖНО: если Эдо просит конкретную тему (кузовные, оптика/фары, двигатель, подвеска, тормоза, электрика, салон, трансмиссия) — ОБЯЗАТЕЛЬНО передай её в theme, иначе ролик будет про случайные запчасти. Запчасти перемешиваются и не повторяются от ролика к ролику.', input_schema: { type: 'object', properties: { platforms: { type: 'array', items: { type: 'string', enum: ['youtube', 'telegram'] } }, theme: { type: 'string', description: 'Тема/категория запчастей из запроса Эдо, напр. "кузовные", "оптика", "двигатель". Пусто — любые.' } } } },
];

async function runTool(name, input, ctx) {
  try {
    switch (name) {
      case 'platform_health': {
        const res = await runHealthCheck();
        return formatHealth(res);
      }
      case 'platform_state': {
        return stateSummary();
      }
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
      case 'save_template': {
        if (!input.confirm) return 'Нужно подтверждение Эдо. Покажи ему черновик шаблона и спроси «сохранить?». Вызови снова с confirm=true после его «да».';
        try {
          const t = JSON.parse(input.template_json);
          if (!t.id || !t.use_for) return 'Шаблон должен содержать id и use_for.';
          if (!t.metrics) t.metrics = { runs: 0, views: null, ctr: null, leads: null, last_used: null };
          const { writeFileSync: wf, mkdirSync: mk } = await import('fs');
          const dir = join(ROOT, 'templates', input.category);
          mk(dir, { recursive: true });
          wf(join(dir, `${input.id}.json`), JSON.stringify(t, null, 2));
          stateEvent('template_saved', { note: `${input.category}/${input.id}` });
          return `Шаблон ${input.id} сохранён в templates/${input.category}/. Появится в моей библиотеке после следующего деплоя (или сразу при локальном чтении).`;
        } catch (e) { return 'Ошибка сохранения шаблона: ' + e.message; }
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
      case 'make_cinematic': {
        const platforms = input.platforms?.length ? input.platforms : ['youtube'];
        const topic = String(input.topic || '').trim();
        const direction = ['docs', 'auto', 'parts'].includes(input.direction) ? input.direction : 'auto';
        const groupUrl = input.group_link ? String(input.group_link).replace(/^https?:\/\//, '') : undefined;
        makeCinematicShort({ topic, direction, platforms, groupUrl }).then((r) => {
          const txt = r.ok
            ? `✅ Кино-ролик готов! (${direction}, ${r.scenes} сцен)\n${r.ytUrl || ''}${r.tgOk ? '\n+ выложен в Telegram' : ''}\nТема: ${topic}`
            : `❌ Не вышло: ${r.error}`;
          ctx?.telegram?.sendMessage(ctx.chatId, txt).catch(() => {});
        }).catch((e) => ctx?.telegram?.sendMessage(ctx.chatId, '❌ Ошибка генерации: ' + e.message).catch(() => {}));
        return `Запустил КИНО-ролик высшего уровня по теме «${topic}» (${direction}) — рендер + AI-кадры идут, пришлю ссылку через ~6-8 минут.`;
      }
      case 'make_info_short': {
        const platforms = input.platforms?.length ? input.platforms : ['youtube'];
        const topic = String(input.topic || '').trim();
        const direction = ['docs', 'auto', 'parts'].includes(input.direction) ? input.direction : 'docs';
        const groupUrl = input.group_link ? String(input.group_link).replace(/^https?:\/\//, '') : undefined;
        makeInfoShort({ topic, direction, platforms, groupUrl }).then((r) => {
          const txt = r.ok
            ? `✅ Инфо-ролик готов! (${direction})\n${r.ytUrl || ''}${r.tgOk ? '\n+ выложен в Telegram' : ''}\nТема: ${topic}`
            : `❌ Не вышло: ${r.error}`;
          ctx?.telegram?.sendMessage(ctx.chatId, txt).catch(() => {});
        }).catch((e) => ctx?.telegram?.sendMessage(ctx.chatId, '❌ Ошибка генерации: ' + e.message).catch(() => {}));
        return `Запустил инфо-ролик по теме «${topic}» (${direction}, ${platforms.join(', ')}) — пришлю ссылку через ~5 минут.`;
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
Факт 2026: льготный утильсбор физлица 3400/5200 ₽ — ТОЛЬКО при мощности ≤160 л.с. и 1 авто/год; свыше 160 л.с. физлицо платит полный тариф (как юрлицо). Не вводи в заблуждение.

ВИДЕО-ЗАВОД — выбирай правильный инструмент по теме:
• Ролик про конкретные ЗАПЧАСТИ из каталога (кузовные, оптика, двигатель...) → make_short (theme=категория; тут реальные фото товара). В каталоге сейчас: BMW (~1165), Geely (34), Li Auto (2). В theme передавай марку И категорию, если названы (напр. «Geely кузовные», «BMW оптика»). Если Эдо просит марку, которой в каталоге нет — инструмент вернёт честный отказ со списком доступного; передай это Эдо, не подсовывай чужую марку. Состояние (новый/б/у), происхождение (Китай/Европа) и цены инструмент берёт из колонок таблицы автоматически — сам ничего про состояние деталей не выдумывай.
• Любой ролик про ДОКУМЕНТЫ/оформление/СБКТС/ЭПТС/утиль/таможню/ПРИГОН/услуги/советы → по умолчанию make_cinematic (ВЫСШИЙ УРОВЕНЬ: кино-AI-кадры + брендовый оверлей, выглядит как дорогая реклама). Указывай direction (docs/auto/parts) и topic.
• make_info_short — только если Эдо просит именно простой/быстрый инфо-ролик без AI-картинок.
Эдо требует «высший уровень» — поэтому по инфо/пригон-темам всегда бери make_cinematic, кроме явной просьбы о простом.
Всегда передавай group_link, если Эдо назвал конкретную ссылку на группу/канал.

КОНТЕНТ-ЗАВОД — жёсткая цепочка производства: Тема → определи тип по CONTENT_GRAPH → шаблон из TEMPLATE LIBRARY → ассеты по ID из ASSET_LIBRARY → генерация → Quality Gate (проверка кода перед публикацией — брак НЕ публикуется автоматически) → публикация. НЕ выдумывай оформление на лету — всё из графа и шаблонов. Если подходящего шаблона нет — предложи Эдо новый (save_template с его подтверждения).

ПРОАКТИВНОСТЬ: «здоровье платформы/что сломалось/проверь систему» → platform_health (живые проверки). «что происходит/как дела/что сегодня» → СНАЧАЛА вызови platform_state и отвечай его фактами (какие задачи идут, что провалилось, кто жив). Не отвечай о состоянии платформы по памяти.

ОБУЧЕНИЕ И ПАМЯТЬ: ты учишься на ходу. Как только Эдо поправил стиль, сказал предпочтение, дал новый факт о бизнесе или ссылку — СРАЗУ вызывай remember, чтобы не переспрашивать в будущем. Лучше запомнить лишнее, чем забыть важное.`;

export async function jarvisThink(userText, ctx = {}) {
  if (!claude) return 'Мозг недоступен: не задан CLAUDE_API_KEY.';
  const designBlock = `\n\n## Дизайн (бери из шаблонов Эдо, не выдумывай свой)\n${DESIGN.style}\n${DESIGN.rules || ''}\nКогда делаешь картинку/пост — следуй фирстилю и структуре шаблонов:\n${DESIGN.spec}`;
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

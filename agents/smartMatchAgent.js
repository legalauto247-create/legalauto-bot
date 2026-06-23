// ============================================================
// LEGAL AUTO â Smart Matching Agent
// ÐÐ»Ð¸ÐµÐ½Ñ Ð¿Ð¸ÑÐµÑ: Â«ÐÑÐ¶Ð½Ð° Ð¿ÑÐ°Ð²Ð°Ñ ÑÐ°ÑÐ° Ð½Ð° BMW X5 G05Â»
// Ð¡Ð¸ÑÑÐµÐ¼Ð° Ð¿Ð¾Ð½Ð¸Ð¼Ð°ÐµÑ, Ð¸ÑÐµÑ Ð² Supabase, Ð²Ð¾Ð·Ð²ÑÐ°ÑÐ°ÐµÑ ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY });
const db = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { transport: ws } })
  : null;

// ============================================================
// Ð¨Ð°Ð³ 1 â Claude Haiku ÑÐ°Ð·Ð±Ð¸ÑÐ°ÐµÑ Ð·Ð°Ð¿ÑÐ¾Ñ ÐºÐ»Ð¸ÐµÐ½ÑÐ°
// ============================================================

async function parseRequest(userText) {
  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Ð Ð°Ð·Ð±ÐµÑÐ¸ Ð·Ð°Ð¿ÑÐ¾Ñ ÐºÐ»Ð¸ÐµÐ½ÑÐ° Ð½Ð° Ð·Ð°Ð¿ÑÐ°ÑÑÐ¸. ÐÐµÑÐ½Ð¸ JSON Ð±ÐµÐ· Ð»Ð¸ÑÐ½ÐµÐ³Ð¾ ÑÐµÐºÑÑÐ°.

ÐÐ°Ð¿ÑÐ¾Ñ: "${userText}"

JSON ÑÐ¾ÑÐ¼Ð°Ñ:
{
  "category": "ÑÐ°ÑÐ°|Ð±Ð°Ð¼Ð¿ÐµÑ|Ð´Ð²Ð¸Ð³Ð°ÑÐµÐ»Ñ|ÐºÐ¾ÑÐ¾Ð±ÐºÐ°|Ð¿Ð¾Ð´Ð²ÐµÑÐºÐ°|ÑÐ¾ÑÐ¼Ð¾Ð·Ð°|ÐºÑÐ·Ð¾Ð²|ÑÐ°Ð»Ð¾Ð½|ÑÐ»ÐµÐºÑÑÐ¸ÐºÐ°|Ð´ÑÑÐ³Ð¾Ðµ",
  "side": "Ð»ÐµÐ²Ð°Ñ|Ð¿ÑÐ°Ð²Ð°Ñ|Ð¿ÐµÑÐµÐ´Ð½ÑÑ|Ð·Ð°Ð´Ð½ÑÑ|null",
  "brand": "BMW|Mercedes|Audi|Toyota|...|null",
  "model": "X5|C-Class|A4|Camry|...|null",
  "generation": "G05|W213|B9|XV70|...|null",
  "year": 2020|null,
  "oem": "63117214957|null",
  "keywords": ["ÑÐ°ÑÐ°", "x5", "g05"]
}`
    }]
  });

  try {
    const text = msg.content[0].text.trim();
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

// ============================================================
// Ð¨Ð°Ð³ 2 â ÐÐ¾Ð¸ÑÐº Ð² Supabase Ð¿Ð¾ ÑÐ°Ð·Ð¾Ð±ÑÐ°Ð½Ð½ÑÐ¼ Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ°Ð¼
// ============================================================

async function searchInDB(parsed) {
  if (!parsed || !db) return [];

  let query = db
    .from('parts')
    .select('id, sku, oem, name, brand, car_brand, car_model, year_from, year_to, price, stock_status, condition, images, compatibility')
    .eq('publish_status', 'published')
    .neq('stock_status', 'unavailable');

  // Ð¤Ð¸Ð»ÑÑÑÑ Ð¿Ð¾ Ð°Ð²ÑÐ¾
  if (parsed.brand) {
    query = query.ilike('car_brand', `%${parsed.brand}%`);
  }
  if (parsed.model) {
    query = query.ilike('car_model', `%${parsed.model}%`);
  }

  // ÐÐ¾Ð¸ÑÐº Ð¿Ð¾ ÐºÐ»ÑÑÐµÐ²ÑÐ¼ ÑÐ»Ð¾Ð²Ð°Ð¼ Ð² Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ð¸
  if (parsed.keywords?.length > 0) {
    const kw = parsed.keywords[0]; // Ð±ÐµÑÑÐ¼ Ð³Ð»Ð°Ð²Ð½Ð¾Ðµ ÐºÐ»ÑÑÐµÐ²Ð¾Ðµ ÑÐ»Ð¾Ð²Ð¾
    query = query.ilike('name', `%${kw}%`);
  }

  // OEM ÑÐ¾ÑÐ½ÑÐ¹ Ð¿Ð¾Ð¸ÑÐº
  if (parsed.oem) {
    query = query.or(`oem.eq.${parsed.oem}`);
  }

  const { data, error } = await query.limit(5);
  if (error) console.error('DB search error:', error);
  return data || [];
}

// ============================================================
// Ð¨Ð°Ð³ 3 â Claude Haiku ÑÐ¾ÑÐ¼Ð¸ÑÑÐµÑ ÐºÑÐ°ÑÐ¸Ð²ÑÐ¹ Ð¾ÑÐ²ÐµÑ ÐºÐ»Ð¸ÐµÐ½ÑÑ
// ============================================================

async function formatResponse(userText, parsed, parts) {
  if (parts.length === 0) {
    // ÐÐ¸ÑÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°ÑÐ»Ð¸ â ÑÐ¾Ð·Ð´Ð°ÑÐ¼ Ð»Ð¸Ð´
    return {
      found: false,
      text: `ð ÐÐ¾ Ð·Ð°Ð¿ÑÐ¾ÑÑ Â«${userText}Â» Ð² Ð½Ð°Ð»Ð¸ÑÐ¸Ð¸ Ð½ÐµÑ, Ð½Ð¾ Ð¼Ñ Ð¼Ð¾Ð¶ÐµÐ¼ Ð½Ð°Ð¹ÑÐ¸ Ð¿Ð¾Ð´ Ð·Ð°ÐºÐ°Ð·!\n\nð ÐÐ°ÑÐ²ÐºÐ° Ð¿ÑÐ¸Ð½ÑÑÐ°. ÐÐµÐ½ÐµÐ´Ð¶ÐµÑ ÑÐ²ÑÐ¶ÐµÑÑÑ Ð² ÑÐµÑÐµÐ½Ð¸Ðµ 30 Ð¼Ð¸Ð½ÑÑ.\n\nð¬ ÐÐ»Ð¸ Ð½Ð°Ð¿Ð¸ÑÐ¸ Ð½Ð°Ð¼: @LegalAutoBot`,
      parsed
    };
  }

  const partsText = parts.map((p, i) =>
    `${i + 1}. ${p.name}\n   SKU: ${p.sku}${p.oem ? ' | OEM: ' + p.oem : ''}\n   Ð¡Ð¾ÑÑÐ¾ÑÐ½Ð¸Ðµ: ${p.condition === 'new' ? 'ð ÐÐ¾Ð²Ð°Ñ' : p.condition === 'used' ? 'ð Ð/Ñ' : 'â»ï¸ ÐÐ¾ÑÑÑÐ°Ð½Ð¾Ð²Ð»ÐµÐ½Ð½Ð°Ñ'}\n   Ð¦ÐµÐ½Ð°: ${p.price ? p.price.toLocaleString('ru-RU') + ' â½' : 'Ð¿Ð¾ Ð·Ð°Ð¿ÑÐ¾ÑÑ'}\n   ÐÐ°Ð»Ð¸ÑÐ¸Ðµ: ${p.stock_status === 'in_stock' ? 'â Ð Ð½Ð°Ð»Ð¸ÑÐ¸Ð¸' : 'ð¦ ÐÐ¾Ð´ Ð·Ð°ÐºÐ°Ð·'}`
  ).join('\n\n');

  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Ð¢Ñ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ Ð¼Ð°Ð³Ð°Ð·Ð¸Ð½Ð° Ð·Ð°Ð¿ÑÐ°ÑÑÐµÐ¹ LegalAuto. ÐÐ»Ð¸ÐµÐ½Ñ Ð¸ÑÐºÐ°Ð»: "${userText}"
ÐÑ Ð½Ð°ÑÐ»Ð¸ ${parts.length} Ð²Ð°ÑÐ¸Ð°Ð½Ñ(Ð°). ÐÐ°Ð¿Ð¸ÑÐ¸ ÐºÐ¾ÑÐ¾ÑÐºÐ¸Ð¹ Ð¿ÑÐ¾Ð´Ð°ÑÑÐ¸Ð¹ Ð¾ÑÐ²ÐµÑ (3-5 ÑÑÑÐ¾Ðº) Ñ ÑÐ¼Ð¾Ð´Ð·Ð¸, Ð±ÐµÐ· Ð²Ð¾Ð´Ñ.
Ð£Ð¿Ð¾Ð¼ÑÐ½Ð¸ ÑÑÐ¾ Ñ Ð½Ð°Ñ Ð³Ð°ÑÐ°Ð½ÑÐ¸Ñ Ð¸ Ð±ÑÑÑÑÐ°Ñ Ð´Ð¾ÑÑÐ°Ð²ÐºÐ°. Ð¡ÑÐ¸Ð»Ñ: ÑÐºÑÐ¿ÐµÑÑÐ½ÑÐ¹, Ð´ÑÑÐ¶ÐµÐ»ÑÐ±Ð½ÑÐ¹.`
    }]
  });

  const intro = msg.content[0].text.trim();

  return {
    found: true,
    text: `${intro}\n\n${partsText}\n\nð¬ ÐÐ°Ð¿Ð¸ÑÐ°ÑÑ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÑ: @LegalAutoBot`,
    parts,
    parsed
  };
}

// ============================================================
// Ð¨Ð°Ð³ 4 â Ð¡Ð¾Ð·Ð´Ð°ÑÑ Ð»Ð¸Ð´ Ð² Supabase
// ============================================================

async function saveLead(telegramId, userText, parsed, matchedParts) {
  if (!db) return null;
  try {
    //ÐÐ°ÑÐ¾Ð´Ð¸Ð¼ Ð¸Ð»Ð¸ ÑÐ¾Ð·Ð´Ð°ÑÐ¼ Ð¿Ð¾Ð»ÑÐ·Ð¾Ð²Ð°ÑÐµÐ»Ñ
    let { data: user } = await db.from('users').select('id').eq('telegram_id', telegramId).single();

    if (!user) {
      const { data: newUser } = await db.from('users')
        .insert({ telegram_id: telegramId, role: 'client', source: 'bot' })
        .select('id').single();
      user = newUser;
    }

    if (!user) return null;

    const { data: lead } = await db.from('leads').insert({
      user_id: user.id,
      source: 'bot',
      request_text: userText,
      category: 'parts',
      status: matchedParts.length > 0 ? 'qualified' : 'new',
      car_brand: parsed?.brand || null,
      car_model: parsed?.model || null,
      matched_parts: matchedParts.map(p => p.id),
      match_score: matchedParts.length > 0 ? 0.85 : 0.0
    }).select('id').single();

    return lead;
  } catch (err) {
    console.error('saveLead error:', err);
    return null;
  }
}

// ============================================================
// ÐÐÐÐÐÐÐ¯ Ð¤Ð£ÐÐÐ¦ÐÐ¯ â Ð²ÑÐ·ÑÐ²Ð°ÐµÑÑÑ Ð¸Ð· clientBot
// ============================================================

export async function smartMatch(telegramId, userText) {
  try {
    console.log(`ð SmartMatch: "${userText}" Ð¾Ñ ${telegramId}`);

    // 1. Ð Ð°Ð·Ð±Ð¸ÑÐ°ÐµÐ¼ Ð·Ð°Ð¿ÑÐ¾Ñ
    const parsed = await parseRequest(userText);
    console.log('Parsed:', JSON.stringify(parsed));

    // 2. ÐÑÐµÐ¼ Ð² Ð±Ð°Ð·Ðµ
    const parts = await searchInDB(parsed);
    console.log(`Found ${parts.length} parts`);

    // 3. Ð¡Ð¾ÑÑÐ°Ð½ÑÐµÐ¼ Ð»Ð¸Ð´
    const lead = await saveLead(telegramId, userText, parsed, parts);
    console.log('Lead created:', lead?.id);

    // 4. Ð¤Ð¾ÑÐ¼Ð¸ÑÑÐµÐ¼ Ð¾ÑÐ²ÐµÑ
    const result = await formatResponse(userText, parsed, parts);

    return {
      ...result,
      leadId: lead?.id
    };

  } catch (err) {
    console.error('SmartMatch error:', err);
    return {
      found: false,
      text: 'â ï¸ ÐÑÐ¾Ð¸Ð·Ð¾ÑÐ»Ð° Ð¾ÑÐ¸Ð±ÐºÐ° Ð¿ÑÐ¸ Ð¿Ð¾Ð¸ÑÐºÐµ. ÐÐ°Ð¿Ð¸ÑÐ¸ÑÐµ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÑ: @LegalAutoBot',
      error: err.message
    };
  }
}

// ============================================================
// ÐÑÐ¾Ð²ÐµÑÐºÐ° â ÑÐ²Ð»ÑÐµÑÑÑ Ð»Ð¸ ÑÐ¾Ð¾Ð±ÑÐµÐ½Ð¸Ðµ Ð·Ð°Ð¿ÑÐ¾ÑÐ¾Ð¼ Ð½Ð° Ð·Ð°Ð¿ÑÐ°ÑÑÑ
// ============================================================

export function isPartsRequest(text) {
  const triggers = [
    'Ð½ÑÐ¶Ð½', 'Ð¸ÑÑ', 'Ð½Ð°Ð¹Ð´Ð¸', 'ÐµÑÑÑ Ð»Ð¸', 'ÐºÑÐ¿Ð»Ñ', 'ÑÐ¾ÑÑ ÐºÑÐ¿Ð¸ÑÑ',
    'ÑÐ°ÑÐ°', 'Ð±Ð°Ð¼Ð¿ÐµÑ', 'ÐºÐ°Ð¿Ð¾Ñ', 'Ð´Ð²ÐµÑÑ', 'Ð·ÐµÑÐºÐ°Ð»Ð¾', 'ÑÑÐµÐºÐ»Ð¾',
    'Ð´Ð²Ð¸Ð³Ð°ÑÐµÐ»Ñ', 'Ð¼Ð¾ÑÐ¾Ñ', 'ÐºÐ¿Ð¿', 'ÐºÐ¾ÑÐ¾Ð±ÐºÐ°', 'Ð°ÐºÐ¿Ð¿', 'Ð¼ÐºÐ¿Ð¿',
    'Ð¿Ð¾Ð´Ð²ÐµÑÐºÐ°', 'Ð°Ð¼Ð¾ÑÑÐ¸Ð·Ð°ÑÐ¾Ñ', 'Ð¿ÑÑÐ¶Ð¸Ð½Ð°', 'ÑÑÑÐ°Ð³', 'ÑÐ°Ð¹Ð»ÐµÐ½Ñ',
    'ÑÐ¾ÑÐ¼Ð¾Ð·Ð°', 'ÑÑÐ¿Ð¿Ð¾ÑÑ', 'Ð´Ð¸ÑÐº', 'ÐºÐ¾Ð»Ð¾Ð´ÐºÐ¸',
    'Ð·Ð°Ð¿ÑÐ°ÑÑÑ', 'Ð´ÐµÑÐ°Ð»Ñ', 'Ð¾ÐµÐ¼', 'oem', 'Ð°ÑÑÐ¸ÐºÑÐ»',
    'bmw', 'mercedes', 'audi', 'toyota', 'honda', 'kia', 'hyundai',
    'porsche', 'lexus', 'volvo', 'volkswagen', 'skoda', 'mazda'
  ];
  const lower = text.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

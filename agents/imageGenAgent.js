const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const IMAGE_ADVANCED_MODEL = process.env.IMAGE_ADVANCED_MODEL || 'gpt-image-1';
const IMAGE_EXPERIMENTAL_MODEL = process.env.IMAGE_EXPERIMENTAL_MODEL || 'gpt-image-1';

// ════════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ — ПОДДЕРЖКА DALLE-3 И НОВЫХ МОДЕЛЕЙ
// ════════════════════════════════════════════════════════════════════════════

export async function generateImage(prompt, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY не задан');

  // Очистить prompt от команд
  let cleanPrompt = String(prompt)
    .replace(/^\/image\s*/i, '')
    .replace(/^\/img\s*/i, '')
    .trim();

  if (!cleanPrompt) cleanPrompt = 'Professional car photography';

  const enhancedPrompt = `${cleanPrompt}. Professional automotive photography, high quality, no text, no watermarks, no logos.`;

  console.log('[ImageGen] 🎨 Генерирую изображение');
  console.log(`[ImageGen] 📝 Тема: "${enhancedPrompt.slice(0, 80)}..."`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 сек

    // Разные модели требуют разные параметры
    // dall-e-3: НЕ поддерживает response_format (всегда URL)
    // dall-e-2/gpt-image-1/2: поддерживают response_format
    const requestBody = {
      model: IMAGE_MODEL,
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
    };

    // gpt-image-1 не поддерживает response_format (всегда b64_json)
    // dall-e-2 поддерживает response_format: 'url'
    if (IMAGE_MODEL === 'dall-e-2') {
      requestBody.response_format = 'url';
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[ImageGen] ❌ API Error:', res.status, errorText.slice(0, 200));
      throw new Error(`API Error ${res.status}`);
    }

    const data = await res.json();

    // Поддержка обоих форматов:
    // 1. DALL-E-3 format: { data: [{ url: "..." }] }
    // 2. Новые модели (gpt-image-1/2): { data: [{ b64_json: "..." }] }
    let url = data?.data?.[0]?.url;
    let b64_json = data?.data?.[0]?.b64_json;

    if (url) {
      console.log('[ImageGen] ✅ Image generated successfully (URL format)');
      return { url };
    }

    if (b64_json) {
      console.log('[ImageGen] ✅ Image generated successfully (b64_json format)');
      return { buffer: Buffer.from(b64_json, 'base64') };
    }

    console.error('[ImageGen] ❌ No URL or b64_json in response:', JSON.stringify(data).slice(0, 300));
    throw new Error('No image data returned');

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[ImageGen] ⏱️ TIMEOUT after 120 seconds');
      throw new Error('Image generation timeout - API too slow');
    }
    console.error('[ImageGen] 💥 Error:', err.message);
    throw err;
  }
}

export async function downloadImage(url) {
  if (!url) throw new Error('URL not provided');

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[ImageGen] Download error:', err.message);
    throw new Error(`Download failed: ${err.message}`);
  }
}

export async function generatePostImage(topic) {
  const cleanTopic = String(topic).replace(/^\/image\s*/i, '').trim() || 'car';
  return await generateImage(`Professional automotive social media post about ${cleanTopic}`);
}

export async function generateBanner(topic) {
  const cleanTopic = String(topic).replace(/^\/image\s*/i, '').trim() || 'parts';
  return await generateImage(`Professional auto parts store marketing banner for ${cleanTopic}`);
}

export async function testImageGen() {
  console.log('[ImageGen] 🧪 Testing...');
  return await generateImage('Red BMW luxury car professional photography');
}

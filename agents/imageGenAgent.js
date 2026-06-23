const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ════════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ — РАБОТАЮЩАЯ ВЕРСИЯ
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

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: enhancedPrompt,
        n: 1,
        size: '1024x1024',
        response_format: { type: 'url' },
      }),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[ImageGen] ❌ API Error:', res.status, errorText.slice(0, 200));
      throw new Error(`API Error ${res.status}`);
    }

    const data = await res.json();

    // Парсим URL безопасно
    const url = data?.data?.[0]?.url ||
                data?.url ||
                (data?.data?.[0] && typeof data.data[0] === 'string' ? data.data[0] : null);

    if (!url) {
      console.error('[ImageGen] ❌ No URL in response:', JSON.stringify(data).slice(0, 300));
      throw new Error('No image URL returned');
    }

    console.log('[ImageGen] ✅ Image generated successfully');
    return { url };

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
    return await res.buffer();
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

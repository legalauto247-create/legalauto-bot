/**
 * Cloudflare Worker — GAS Proxy для LegalAuto
 *
 * Зачем: Railway IP блокируется Google при обращении к script.google.com.
 * Cloudflare IPs Google пускает. Воркер проксирует запросы и возвращает JSON.
 *
 * Деплой:
 *   1. https://workers.cloudflare.com/ → Create application → Create Worker
 *   2. Вставить этот код
 *   3. Нажать Deploy
 *   4. Скопировать URL воркера (типа https://gas-proxy.YOUR.workers.dev)
 *   5. В Railway Variables поставить:
 *      APPS_SCRIPT_API_URL = https://gas-proxy.YOUR.workers.dev/?secret=la-proxy-key-2025
 *
 * Защита: простой секретный токен в параметре ?secret=
 */

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxo6RlEQZaDIkhFfo6AeHqCR_r2AABdVw3gGu6FVapCxSfsd7KzKwDtR4H05qiE2DbC/exec';

const SECRET = 'la-proxy-key-2025'; // поменяй если хочешь

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Простая защита от посторонних
    if (url.searchParams.get('secret') !== SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Строим URL для GAS: берём все параметры кроме secret
    const gasUrl = new URL(GAS_URL);
    for (const [k, v] of url.searchParams) {
      if (k !== 'secret') gasUrl.searchParams.set(k, v);
    }

    try {
      const resp = await fetch(gasUrl.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      });

      const text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

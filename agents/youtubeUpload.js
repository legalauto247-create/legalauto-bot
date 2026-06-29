/**
 * LegalAuto — загрузка видео на YouTube (Shorts) через Data API.
 * Использует YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN (в Railway).
 *
 *   uploadShort({ path, title, description, tags }) → { id, url } | null
 */
import { readFileSync, statSync } from 'fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function accessToken() {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) throw new Error('YT_* переменные не заданы');
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('refresh failed: ' + JSON.stringify(d));
  return d.access_token;
}

export async function uploadShort({ path, title, description = '', tags = [] }) {
  const at = await accessToken();
  const size = statSync(path).size;

  // 1) Resumable session
  const meta = {
    snippet: { title: title.slice(0, 100), description, tags, categoryId: '2' }, // 2 = Autos & Vehicles
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${at}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error('init upload: ' + (await init.text()).slice(0, 300));
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('нет upload URL');

  // 2) Upload bytes
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: readFileSync(path),
  });
  const res = await up.json();
  if (!res.id) throw new Error('upload failed: ' + JSON.stringify(res).slice(0, 300));
  return { id: res.id, url: `https://youtube.com/shorts/${res.id}` };
}

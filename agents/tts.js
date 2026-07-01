/**
 * LegalAuto — русская озвучка через OpenAI TTS (дёшево).
 *   speak(text, outPath, voice) → mp3 файл
 */
import { writeFileSync } from 'fs';

// Распознавание речи (голосовые Эдо) через OpenAI Whisper
export async function transcribe(buffer, filename = 'voice.ogg') {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_BACKUP;
  if (!key) throw new Error('OPENAI_API_KEY не задан');
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  fd.append('model', 'gpt-4o-mini-transcribe');
  fd.append('language', 'ru');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
  });
  const d = await res.json();
  if (!d.text) throw new Error('STT: ' + JSON.stringify(d).slice(0, 200));
  return d.text.trim();
}

export async function speak(text, outPath, voice = 'onyx') {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_BACKUP;
  if (!key) throw new Error('OPENAI_API_KEY не задан');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,                       // onyx — глубокий мужской; alloy/echo/nova — другие
      input: text,
      instructions: 'Говори по-русски бодро, уверенно, как ведущий вирусного ролика про авто. Энергично, без пафоса.',
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error('TTS: ' + (await res.text()).slice(0, 200));
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

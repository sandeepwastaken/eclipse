// Mission-control callouts voiced with ElevenLabs text-to-speech, written to public/audio/<id>.mp3.
//
//   ELEVENLABS_API_KEY=… node scripts/make_voice.mjs        (or put the key in .env.local)
//   optional: ELEVENLABS_VOICE_ID=… to pick another voice
//
// Thirteen short lines, a few hundred characters in all. The app plays them through a radio
// filter between Quindar tones; without these files it falls back to the browser's voice.
import fs from 'node:fs';
import lines from '../src/data/voice-lines.json' with { type: 'json' };

const envFile = new URL('../.env.local', import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '');
  }
}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY (environment or .env.local).');
  process.exit(1);
}
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb'; // "George": calm, clear narration
const dir = new URL('../public/audio/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });

for (const { id, text } of lines) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.15 } }),
  });
  if (!r.ok) {
    console.error(id, r.status, await r.text());
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(new URL(`${id}.mp3`, dir), Buffer.from(await r.arrayBuffer()));
  console.log('voiced', id);
}

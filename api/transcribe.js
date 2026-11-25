// Vercel function: turns a recorded answer into text using Groq's free Whisper model.
const hits = new Map();
const LIMIT = Number(process.env.HOURLY_LIMIT_AUDIO || 40);
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'anon';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= LIMIT) return res.status(429).json({ code: 'rate_limited' });
  list.push(now); hits.set(ip, list);

  const b64 = String((req.body && req.body.audio) || '');
  const type = String((req.body && req.body.type) || 'audio/mp4');
  if (!b64) return res.status(400).json({ code: 'empty' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ code: 'nokey' });
  try {
    const buf = Buffer.from(b64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf], { type }), type.includes('mp4') ? 'speech.m4a' : 'speech.webm');
    form.append('model', process.env.WHISPER_MODEL || 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('response_format', 'json');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      body: form,
      signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) return res.status(502).json({ code: 'upstream' });
    const d = await r.json();
    res.status(200).json({ text: d.text || '' });
  } catch (e) { res.status(500).json({ code: 'server' }); }
}

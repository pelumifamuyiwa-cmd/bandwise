// Vercel function: tries Gemini first, then Groq if Gemini fails or runs out. Keys stay private.
const hits = new Map();
const LIMIT = Number(process.env.HOURLY_LIMIT || 60);

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('nokey');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } } })
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const d = await r.json();
  const t = (((d.candidates || [])[0] || {}).content || {}).parts;
  if (!t) throw new Error('empty');
  return t.map(p => p.text || '').join('');
}

async function groq(prompt) {
  const key = process.env.GROQ_API_KEY; if (!key) throw new Error('nokey');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_tokens: 4000 })
  });
  if (!r.ok) throw new Error('groq ' + r.status);
  const d = await r.json();
  return (((d.choices || [])[0] || {}).message || {}).content || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'anon';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= LIMIT) return res.status(429).json({ code: 'rate_limited' });
  list.push(now); hits.set(ip, list);

  const prompt = String((req.body && req.body.prompt) || '').slice(0, 8000);
  if (!prompt) return res.status(400).json({ code: 'empty' });

  for (const provider of [gemini, groq]) {
    try { const text = await provider(prompt); if (text) return res.status(200).json({ text }); } catch (e) { /* try the next one */ }
  }
  res.status(503).json({ code: 'busy' }); // the app then uses its built-in question bank
}

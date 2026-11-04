const { authorize } = require('../lib/api-shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!authorize(req, res)) return;
  const { audio } = req.body || {};
  if (typeof audio !== 'string' || audio.length > 3_000_000) return res.status(400).json({ error: 'Missing or oversized audio segment.' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'GROQ_API_KEY is not configured for transcription.' });
  const wav = Buffer.from(audio, 'base64');
  if (wav.length < 44 || wav.subarray(0, 4).toString() !== 'RIFF') return res.status(400).json({ error: 'Audio must be a WAV file.' });
  const model = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  let upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!upstream.ok && model !== 'whisper-large-v3') {
    form.set('model', 'whisper-large-v3');
    upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  }
  if (!upstream.ok) return res.status(502).json({ error: `Groq transcription failed (${upstream.status}).` });
  const result = await upstream.json();
  const text = (result.text || '').trim();
  const clean = text.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  const hallucinations = ['thank you', 'thanks', 'you', 'bye', 'goodbye', 'thanks for watching', 'watching', 'subtitles by', 'thank you so much', 'thank you for watching', 'silence', 'so'];
  return res.status(200).json({ text: clean.length >= 2 && !hallucinations.includes(clean) ? text : '', model });
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } }, maxDuration: 30 };

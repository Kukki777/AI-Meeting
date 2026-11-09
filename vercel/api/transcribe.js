module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const { audio } = req.body || {};
  if (typeof audio !== 'string' || audio.length > 3_000_000) return res.status(400).json({ error: 'Missing or oversized audio segment.' });
  const key = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!key && !geminiKey) return res.status(503).json({ error: 'Configure GROQ_API_KEY or GEMINI_API_KEY for transcription.' });
  const wav = Buffer.from(audio, 'base64');
  if (wav.length < 44 || wav.subarray(0, 4).toString() !== 'RIFF') return res.status(400).json({ error: 'Audio must be a WAV file.' });
  const model = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  let text = '';
  let provider = '';
  if (key) {
    try {
      let upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      if (!upstream.ok && model !== 'whisper-large-v3') {
        form.set('model', 'whisper-large-v3');
        upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      }
      if (upstream.ok) {
        const result = await upstream.json();
        text = (result.text || '').trim();
        provider = 'groq';
      } else if (!geminiKey) {
        return res.status(502).json({ error: `Groq transcription failed (${upstream.status}).` });
      }
    } catch (error) {
      if (!geminiKey) return res.status(502).json({ error: `Groq transcription failed: ${error.message}` });
    }
  }
  if (!text && geminiKey) {
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: 'audio/wav', data: audio } },
          { text: 'Transcribe the spoken audio exactly, with punctuation. Return only the spoken words, not an answer or summary. If there is no intelligible speech, return an empty response.' }
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 }
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) return res.status(502).json({ error: `Gemini transcription failed (${upstream.status}).` });
    const result = await upstream.json();
    text = (result.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
    provider = 'gemini';
  }
  if (!provider && key && !geminiKey) {
    return res.status(502).json({ error: 'Groq transcription failed and no Gemini fallback is configured.' });
  }
  const clean = text.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  const hallucinations = ['thank you', 'thanks', 'you', 'bye', 'goodbye', 'thanks for watching', 'watching', 'subtitles by', 'thank you so much', 'thank you for watching', 'silence', 'so'];
  return res.status(200).json({ text: clean.length >= 2 && !hallucinations.includes(clean) ? text : '', model: provider === 'groq' ? model : process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite', provider });
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } }, maxDuration: 30 };

const RoleEngine = require('./role-engine');
const crypto = require('node:crypto');

function authorize(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(503).json({ error: 'Deployment is not configured: set APP_PASSWORD in Vercel environment variables.' });
    return false;
  }
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Enter the app password to continue.' });
    return false;
  }
  return true;
}

function systemPrompt(role) {
  const engine = new RoleEngine();
  if (role && typeof role === 'object') engine.setCustomRole(role);
  return engine.generateSystemPrompt();
}

function selectGroqModel(query) {
  const q = (query || '').toLowerCase();
  if (['design', 'architect', 'scale', 'distributed', 'tradeoff', 'trade-off'].some(x => q.includes(x))) return 'openai/gpt-oss-120b';
  if (['implement', 'code', 'algorithm', 'complexity', 'leetcode', 'write a'].some(x => q.includes(x))) return 'openai/gpt-oss-20b';
  if (['tell me about', 'describe a time', 'experience with', 'how did you'].some(x => q.includes(x))) return 'openai/gpt-oss-120b';
  return process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
}

function sse(res, event, payload) { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); }

async function forwardProviderStream({ provider, query, history, role, signal, onStart, onToken }) {
  const prompt = systemPrompt(role);
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY is not configured.');
    const models = [...new Set([selectGroqModel(query), process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'].filter(Boolean))];
    const messages = [{ role: 'system', content: prompt }, ...history.slice(-6).map(h => ({ role: h.speaker === 'interviewer' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: query }];
    let response;
    let model;
    for (const candidate of models) {
      const attempt = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: candidate, messages, temperature: 0.2, max_completion_tokens: 1000, stream: true }), signal
      });
      if (attempt.ok) { response = attempt; model = candidate; break; }
      const details = await attempt.text();
      if (attempt.status < 500 && ![400, 404, 422].includes(attempt.status)) throw new Error(`Groq error (${attempt.status}): ${details.slice(0, 300)}`);
    }
    if (!response) throw new Error(`All configured Groq models failed (${models.join(', ')}). Check the API key, model availability, and Groq account access.`);
    onStart(`Groq (${model})`);
    return readSSE(response, data => data.choices?.[0]?.delta?.content, onToken);
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
  const contents = [...history.slice(-4).map(h => ({ role: h.speaker === 'interviewer' ? 'user' : 'model', parts: [{ text: h.text }] })), { role: 'user', parts: [{ text: query }] }];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 800 } }), signal
  });
  if (!response.ok) throw new Error(`Gemini error (${response.status}): ${(await response.text()).slice(0, 300)}`);
  onStart(`Gemini (${model})`);
  return readSSE(response, data => data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(''), onToken);
}

async function readSSE(response, extract, onToken) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let fullText = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
      try { const token = extract(JSON.parse(raw)); if (token) { fullText += token; onToken(token, fullText); } } catch (_) {}
    }
  }
  return fullText;
}

module.exports = { authorize, selectGroqModel, sse, forwardProviderStream };

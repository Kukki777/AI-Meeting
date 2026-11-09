const { sse, forwardProviderStream } = require('../lib/api-shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const { question, role, history = [] } = req.body || {};
  if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'Question is required.' });
  if (!Array.isArray(history) || history.length > 20) return res.status(400).json({ error: 'Invalid conversation history.' });

  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const started = Date.now();
  let firstTokenMs = null;
  let fullText = '';
  try {
    sse(res, 'start', { question: question.trim() });
    const primary = process.env.PRIMARY_LLM || 'groq';
    const providers = primary === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
    let lastError;
    for (const provider of providers) {
      if (provider === 'groq' && !process.env.GROQ_API_KEY) continue;
      if (provider === 'gemini' && !process.env.GEMINI_API_KEY) continue;
      try {
        fullText = await forwardProviderStream({
          provider, query: question.trim(), role, history, signal: controller.signal,
          onStart: model => sse(res, 'model', { model }),
          onToken: (delta, accumulatedText) => {
            if (firstTokenMs === null) firstTokenMs = Date.now() - started;
            sse(res, 'token', { delta, accumulatedText, firstTokenMs });
          }
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (controller.signal.aborted) return res.end();
      }
    }
    if (lastError) throw lastError;
    sse(res, 'done', { fullText, firstTokenMs, totalTimeMs: Date.now() - started });
    res.end();
  } catch (error) {
    if (!res.writableEnded) { sse(res, 'error', { error: error.message || 'AI request failed.' }); res.end(); }
  }
};

module.exports.config = { maxDuration: 60 };

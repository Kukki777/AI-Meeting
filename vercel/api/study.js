const { authorize } = require('../lib/api-shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!authorize(req, res)) return;
  const { image = '', question = '', subject = 'General' } = req.body || {};
  if (typeof image !== 'string' || image.length > 3_800_000 || (image && !/^data:image\/(jpeg|png|webp);base64,/i.test(image))) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image under 3 MB.' });
  }
  if (!image && (typeof question !== 'string' || !question.trim())) return res.status(400).json({ error: 'Add an image or type a study question.' });
  if (typeof question !== 'string' || question.length > 4000 || typeof subject !== 'string') return res.status(400).json({ error: 'Invalid study request.' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'GROQ_API_KEY is not configured.' });

  try {
    const task = question.trim() || 'Read the question shown in the image, answer it, and explain the reasoning step by step.';
    const requestBody = JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: `You are a patient study tutor. The subject is ${subject.slice(0, 80)}. Read the supplied image carefully, identify the question, and provide the answer with a clear explanation and steps. For multiple choice, state the option and explain why. If text is unclear, say exactly what is unreadable instead of guessing. Match the learner's language when practical.` },
          { role: 'user', content: [{ type: 'text', text: task }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])] }
        ],
        temperature: 0.3, max_completion_tokens: 1400, reasoning_effort: 'low', stream: false
      });
    let upstream;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: requestBody, signal: AbortSignal.timeout(25000)
        });
        break;
      } catch (error) {
        if (attempt === 1) throw new Error(`Could not reach Groq for the image request. Check the connection and try again. (${error.message})`);
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
    if (!upstream.ok) return res.status(502).json({ error: `Groq study request failed (${upstream.status}): ${(await upstream.text()).slice(0, 300)}` });
    const data = await upstream.json();
    const answer = data.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: 'The model returned an empty answer. Try a clearer image or add a question.' });
    return res.status(200).json({ answer });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Study request failed.' });
  }
};

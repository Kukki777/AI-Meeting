module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const { image = '', question = '', subject = 'General' } = req.body || {};
  if (typeof image !== 'string' || image.length > 3_800_000 || (image && !/^data:image\/(jpeg|png|webp);base64,/i.test(image))) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image under 3 MB.' });
  }
  if (!image && (typeof question !== 'string' || !question.trim())) return res.status(400).json({ error: 'Add an image or type a study question.' });
  if (typeof question !== 'string' || question.length > 4000 || typeof subject !== 'string') return res.status(400).json({ error: 'Invalid study request.' });
  const key = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!key && !geminiKey) return res.status(503).json({ error: 'Set GROQ_API_KEY or GEMINI_API_KEY in Vercel environment variables.' });

  try {
    const task = question.trim() || 'Read the image and answer the question. Be concise: give the answer first, then only the key steps.';
    const requestBody = JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: `You are a fast, accurate tutor. Subject: ${subject.slice(0, 80)}. Read the image and answer directly. Put the answer first, then give only the essential explanation in at most 5 short bullet points. For multiple choice, give the option and one reason. If unreadable, say so. Use the learner's language.` },
          { role: 'user', content: [{ type: 'text', text: task }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])] }
        ],
        temperature: 0.2, max_completion_tokens: 700, reasoning_effort: 'none', stream: false
      });
    let groqError = 'Groq image request failed.';
    let upstream;
    if (key) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: requestBody, signal: AbortSignal.timeout(12000)
          });
          break;
        } catch (error) {
          groqError = `Groq connection failed: ${error.message}`;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
        }
      }
    }
    if (upstream?.ok) {
      const data = await upstream.json();
      const answer = data.choices?.[0]?.message?.content;
      if (answer) return res.status(200).json({ answer });
      groqError = 'Groq returned an empty answer.';
    } else if (upstream) groqError = `Groq returned ${upstream.status}: ${(await upstream.text()).slice(0, 240)}`;

    if (!geminiKey) return res.status(502).json({ error: `${groqError}. Configure GEMINI_API_KEY to enable image fallback.` });
    const parsedImage = image.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    const parts = [{ text: question.trim() || 'Read the image and answer the question. Be concise: give the answer first, then only the key steps.' }];
    if (parsedImage) parts.push({ inlineData: { mimeType: parsedImage[1], data: parsedImage[2] } });
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.5-flash-lite';
    const fallbackBody = JSON.stringify({
        systemInstruction: { parts: [{ text: `You are a fast, accurate tutor. Subject: ${subject.slice(0, 80)}. Read the image and answer directly. Put the answer first, then give only the essential explanation in at most 5 short bullet points. For multiple choice, give the option and one reason. If unreadable, say so. Use the learner's language.` }] },
        contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
      });
    let fallback;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fallback = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: fallbackBody, signal: AbortSignal.timeout(25000)
        });
        if (fallback.status !== 503 || attempt === 1) break;
      } catch (error) { if (attempt === 1) throw new Error(`${groqError}; Gemini fallback could not connect: ${error.message}`); }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!fallback.ok) return res.status(502).json({ error: `${groqError}; Gemini fallback failed (${fallback.status}): ${(await fallback.text()).slice(0, 240)}` });
    const result = await fallback.json();
    const answer = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!answer) return res.status(502).json({ error: `${groqError}; Gemini returned an empty answer.` });
    return res.status(200).json({ answer });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Study request failed.' });
  }
};

/**
 * Ultra-Low Latency Streaming LLM Service
 * Native SSE Streaming using Node 22 global fetch (zero heavy SDK dependencies)
 * Supports Groq LPU (Llama 3.3 70B / 8B - ~150ms TTFT) and Google Gemini 2.0 Flash
 */

const { EventEmitter } = require('events');

class LLMStreamService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.activeAbortController = null;
  }

  /**
   * Main entry point to stream responses for a query given conversational history and persona
   */
  async streamResponse(userQuery, roleSystemPrompt, conversationHistory = []) {
    // Abort previous in-flight stream if new question arrives immediately
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    const groqKey = process.env.GROQ_API_KEY || this.config.groqApiKey;
    const geminiKey = process.env.GEMINI_API_KEY || this.config.geminiApiKey;

    // Prefer Groq for ultra-low latency (~150ms TTFT) if key exists; fallback to Gemini
    if (groqKey && this.config.primaryLLM === 'groq') {
      try {
        return await this._streamGroq(userQuery, roleSystemPrompt, conversationHistory, groqKey, signal);
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Groq streaming failed, falling back to Gemini:', err.message);
        if (geminiKey) {
          return await this._streamGemini(userQuery, roleSystemPrompt, conversationHistory, geminiKey, signal);
        }
        throw err;
      }
    } else if (geminiKey) {
      return await this._streamGemini(userQuery, roleSystemPrompt, conversationHistory, geminiKey, signal);
    } else if (groqKey) {
      return await this._streamGroq(userQuery, roleSystemPrompt, conversationHistory, groqKey, signal);
    } else {
      throw new Error('No API keys configured. Please add GROQ_API_KEY or GEMINI_API_KEY in your .env file.');
    }
  }

  /**
   * Stream audio directly to Gemini (Multimodal Audio Ingestion)
   * Listens to the interviewer's actual voice, transcribes and answers simultaneously!
   */
  async streamAudioResponse(audioBuffer, systemPrompt, conversationHistory = []) {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    const apiKey = process.env.GEMINI_API_KEY || this.config.geminiApiKey;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for direct audio streaming.');
    }

    const model = this.config.geminiModel || 'gemini-2.0-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const base64Audio = Buffer.isBuffer(audioBuffer) 
      ? audioBuffer.toString('base64') 
      : Buffer.from(audioBuffer).toString('base64');

    const contents = [
      ...conversationHistory.slice(-2).map(h => ({
        role: h.speaker === 'interviewer' ? 'user' : 'model',
        parts: [{ text: h.text }]
      })),
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: base64Audio
            }
          },
          {
            text: `Analyze this audio from the interviewer.
1. If the speaker asked a question or instruction, answer it authoritatively following the candidate persona.
Strictly format your response into the 3 glanceable blocks:
🎯 [SPEAK FIRST]: 1-2 sentences the candidate should say immediately.
⚡ [KEY TECHNICAL POINTS]: 3-4 bullet points detailing internal mechanics, algorithms, or architecture.
💻 [CODE / ARCHITECTURE]: (If applicable) Clean production code or design flow.

2. If the audio is silent or only background noise, reply with: NO_QUESTION.`
          }
        ]
      }
    ];

    const startTime = Date.now();
    let firstTokenTime = null;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800
        }
      }),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Audio API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    this.emit('start', { model: `Gemini Audio (${model})`, timestamp: startTime });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const parts = json.candidates?.[0]?.content?.parts;
            if (parts && parts.length > 0) {
              const text = parts.map(p => p.text || '').join('');
              if (text) {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now() - startTime;
                  this.emit('first-token', { latencyMs: firstTokenTime });
                }
                accumulatedText += text;
                this.emit('token', { delta: text, accumulatedText });
              }
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    this.emit('done', {
      fullText: accumulatedText,
      totalTimeMs: Date.now() - startTime,
      firstTokenMs: firstTokenTime
    });

    return accumulatedText;
  }

  /**
   * Picks the best Groq model based on detected question type.
   * Heavy reasoning questions → 70B. Code/DSA → 8B (3-4x faster). Default → configured model.
   */
  _selectGroqModel(userQuery) {
    const q = (userQuery || '').toLowerCase();
    // System design / architecture → needs deep reasoning, use 70B
    if (q.includes('design') || q.includes('architect') || q.includes('scale') ||
        q.includes('distributed') || q.includes('tradeoff') || q.includes('trade-off')) {
      return 'llama-3.3-70b-versatile';
    }
    // Code / DSA → 8B is plenty fast and accurate
    if (q.includes('implement') || q.includes('code') || q.includes('algorithm') ||
        q.includes('complexity') || q.includes('leetcode') || q.includes('write a')) {
      return 'llama-3.1-8b-instant';
    }
    // Behavioral → 70B for coherent narrative
    if (q.includes('tell me about') || q.includes('describe a time') ||
        q.includes('experience with') || q.includes('how did you')) {
      return 'llama-3.3-70b-versatile';
    }
    // Default to configured model
    return this.config.groqModel || 'llama-3.3-70b-versatile';
  }

  /**
   * Stream via Groq LPU (OpenAI-compatible SSE)
   */
  async _streamGroq(userQuery, systemPrompt, history, apiKey, signal) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6).map(h => ({
        role: h.speaker === 'interviewer' ? 'user' : 'assistant',
        content: h.text
      })),
      { role: 'user', content: userQuery }
    ];

    const candidateModels = [
      this._selectGroqModel(userQuery),  // Smart-routed primary model
      this.config.groqModel,
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ].filter(Boolean).filter((m, i, arr) => arr.indexOf(m) === i); // dedupe

    const startTime = Date.now();
    let response = null;
    let chosenModel = '';

    for (const m of candidateModels) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: m,
            messages: messages,
            temperature: 0.2,
            max_tokens: 1000,
            stream: true
          }),
          signal
        });

        if (res.ok) {
          response = res;
          chosenModel = m;
          break;
        } else {
          const errText = await res.text();
          console.warn(`[Groq] Model ${m} rejected (${res.status}): ${errText.slice(0, 100)}`);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }

    if (!response) {
      throw new Error('All candidate Groq models failed or are blocked at project limits.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    let firstTokenTime = null;
    this.emit('start', { model: `Groq (${chosenModel})`, timestamp: startTime });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial trailing line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment or ping
        if (trimmed === 'data: [DONE]') {
          break;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              if (!firstTokenTime) {
                firstTokenTime = Date.now() - startTime;
                this.emit('first-token', { latencyMs: firstTokenTime });
              }
              accumulatedText += delta;
              this.emit('token', { delta, accumulatedText });
            }
          } catch (e) {
            // ignore partial JSON parse errors
          }
        }
      }
    }

    this.emit('done', {
      fullText: accumulatedText,
      totalTimeMs: Date.now() - startTime,
      firstTokenMs: firstTokenTime
    });

    return accumulatedText;
  }

  /**
   * Stream via Google Gemini (REST SSE)
   */
  async _streamGemini(userQuery, systemPrompt, history, apiKey, signal) {
    const model = this.config.geminiModel || 'gemini-2.0-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const contents = [
      ...history.slice(-4).map(h => ({
        role: h.speaker === 'interviewer' ? 'user' : 'model',
        parts: [{ text: h.text }]
      })),
      {
        role: 'user',
        parts: [{ text: userQuery }]
      }
    ];

    const startTime = Date.now();
    let firstTokenTime = null;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800
        }
      }),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    this.emit('start', { model: `Gemini (${model})`, timestamp: startTime });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const parts = json.candidates?.[0]?.content?.parts;
            if (parts && parts.length > 0) {
              const text = parts.map(p => p.text || '').join('');
              if (text) {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now() - startTime;
                  this.emit('first-token', { latencyMs: firstTokenTime });
                }
                accumulatedText += text;
                this.emit('token', { delta: text, accumulatedText });
              }
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    this.emit('done', {
      fullText: accumulatedText,
      totalTimeMs: Date.now() - startTime,
      firstTokenMs: firstTokenTime
    });

    return accumulatedText;
  }

  abort() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }
}

module.exports = LLMStreamService;

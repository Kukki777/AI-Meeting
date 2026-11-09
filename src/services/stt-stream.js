/**
 * Ultra-Low Latency Speech-to-Text Service
 * Zero-Disk-I/O in-memory streaming supporting Groq Whisper (295ms)
 * and Deepgram Nova-2 (WebSocket)
 */

const { EventEmitter } = require('events');

class STTStreamService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.deepgramWs = null;
    this.isListening = false;
  }

  /**
   * Start Deepgram WebSocket streaming connection
   */
  startDeepgramSession() {
    const apiKey = process.env.DEEPGRAM_API_KEY || this.config.deepgramApiKey;
    if (!apiKey) {
      this.emit('status', { provider: 'deepgram', ready: false, message: 'No DEEPGRAM_API_KEY found' });
      return false;
    }

    try {
      const WebSocket = globalThis.WebSocket;
      const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true&endpointing=300&encoding=linear16&sample_rate=16000';
      
      this.deepgramWs = new WebSocket(url, {
        headers: { 'Authorization': `Token ${apiKey}` }
      });

      this.deepgramWs.onopen = () => {
        this.isListening = true;
        this.emit('ready', { provider: 'deepgram' });
      };

      this.deepgramWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          if (transcript) {
            const isFinal = data.is_final;
            if (isFinal) {
              this.emit('transcript', { text: transcript.trim(), isFinal: true });
            } else {
              this.emit('interim', { text: transcript.trim() });
            }
          }
        } catch (e) {
          // ignore parsing error
        }
      };

      this.deepgramWs.onerror = (err) => {
        this.emit('error', { provider: 'deepgram', error: err.message });
      };

      this.deepgramWs.onclose = () => {
        this.isListening = false;
        this.emit('closed', { provider: 'deepgram' });
      };

      return true;
    } catch (error) {
      this.emit('error', { provider: 'deepgram', error: error.message });
      return false;
    }
  }

  /**
   * Send live PCM chunk to active Deepgram WebSocket
   */
  sendAudioChunk(pcm16Buffer) {
    if (this.deepgramWs && this.deepgramWs.readyState === 1) { // 1 = OPEN
      this.deepgramWs.send(pcm16Buffer);
    }
  }

  /**
   * Filters out known OpenAI Whisper phantom/hallucination phrases produced during ambient silence
   */
  isSilenceHallucination(text) {
    if (!text) return true;
    const clean = text.toLowerCase().trim().replace(/[.,!?;:]/g, '');
    if (clean.length < 2) return true;

    const phantomPhrases = [
      'thank you', 'thanks', 'you', 'bye', 'goodbye', 
      'thanks for watching', 'watching', 'subtitles by', 
      'thank you so much', 'thank you for watching',
      'silence', 'so'
    ];

    return phantomPhrases.includes(clean);
  }

  /** Transcribe a discrete in-memory WAV segment, preferring Groq Whisper. */
  async transcribeWavInMemory(wavBuffer) {
    const groqKey = process.env.GROQ_API_KEY || this.config.groqApiKey;
    const geminiKey = process.env.GEMINI_API_KEY || this.config.geminiApiKey;
    if (!groqKey && !geminiKey) throw new Error('Add GROQ_API_KEY or GEMINI_API_KEY for speech transcription.');

    const preferredModel = this.config.groqWhisperModel || 'whisper-large-v3-turbo';
    const fallbackModel = 'whisper-large-v3';
    let transcript = '';
    let provider = '';
    let duration = 0;

    const tryTranscribe = async (modelName) => {
      const formData = new FormData();
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      formData.append('file', blob, 'speech.wav');
      formData.append('model', modelName);
      formData.append('response_format', 'json');
      formData.append('temperature', '0.0');

      const startTime = Date.now();
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq Whisper (${modelName}) error (${response.status}): ${err}`);
      }

      const json = await response.json();
      const transcript = (json.text || '').trim();
      return { transcript, duration: Date.now() - startTime, model: modelName };
    };

    if (groqKey) {
      try {
        let result;
        try {
          result = await tryTranscribe(preferredModel);
        } catch (primaryErr) {
          console.warn(`[STT] ${preferredModel} failed, trying ${fallbackModel}:`, primaryErr.message);
          result = await tryTranscribe(fallbackModel);
        }
        transcript = result.transcript;
        duration = result.duration;
        provider = `groq-${result.model}`;
      } catch (error) {
        if (!geminiKey) throw error;
        console.warn('[STT] Groq transcription failed, trying Gemini audio transcription:', error.message);
      }
    }

    if (!provider && geminiKey) {
      const model = process.env.GEMINI_MODEL || this.config.geminiModel || 'gemini-2.0-flash-lite';
      const base64Audio = Buffer.from(wavBuffer).toString('base64');
      const started = Date.now();
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
            { text: 'Transcribe the spoken audio exactly, with punctuation. Return only the spoken words, not an answer or summary. If there is no intelligible speech, return an empty response.' }
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 512 }
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini transcription failed (${response.status}): ${errorText.slice(0, 240)}`);
      }
      const json = await response.json();
      transcript = (json.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
      duration = Date.now() - started;
      provider = 'gemini-audio-transcription';
    }

    if (!transcript || this.isSilenceHallucination(transcript)) return '';
    this.emit('transcript', { text: transcript, isFinal: true, latencyMs: duration, provider });
    return transcript;
  }

  close() {
    if (this.deepgramWs) {
      try {
        this.deepgramWs.close();
      } catch (_) {}
      this.deepgramWs = null;
    }
    this.isListening = false;
  }
}

module.exports = STTStreamService;

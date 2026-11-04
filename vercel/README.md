# Vercel web version

This is a separate browser app. It preserves the desktop app's role-aware prompt, Groq Whisper transcription, Groq/Gemini streaming and fallback, smart Groq model routing, voice activity detection, push-to-listen, manual question entry, stop control, and conversation history.

## Deploy

1. In Vercel, import the `Kukki777/AI-Meeting` GitHub repository.
2. Set **Root Directory** to `vercel`.
3. Configure environment variables in Vercel Project Settings:
   - `APP_PASSWORD`: a long, unique password (required; requests fail closed without it).
   - `GROQ_API_KEY`: required for Whisper and recommended for Groq chat.
   - `PRIMARY_LLM=groq` (or `gemini`).
   - `GROQ_MODEL=openai/gpt-oss-20b` and `GROQ_WHISPER_MODEL=whisper-large-v3-turbo` (optional defaults).
   - `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-2.0-flash-lite` (optional fallback).
4. Deploy. Open the HTTPS URL, enter the app password, and grant microphone permission.

No API key is sent to browser JavaScript. The browser sends audio to this project's transcription endpoint; that endpoint calls Groq. AI text requests are streamed through the serverless endpoint. `APP_PASSWORD` is a shared access gate; keep the deployment URL and password limited to the intended team. Consider Vercel deployment protection for additional access control.

## Browser differences

Microphone access requires HTTPS (Vercel supplies it) and explicit permission. Automatic speech detection and push-to-listen are supported while the page is open. Browser security does not allow websites to stay above other applications, hide from screen capture, use system-wide hotkeys, or pass mouse clicks through the page. Those controls remain available only in the Electron desktop app. The web version uses keyboard shortcuts only while its page has focus.

## API routes

- `GET /api/session`: validates the shared app password without making a provider request.
- `POST /api/transcribe`: accepts an in-memory WAV payload and returns its transcript.
- `POST /api/ask`: streams server-sent events for model start, tokens, completion, or errors.

# Stealth Co-Pilot (Electron desktop app)

Stealth Co-Pilot is a desktop interview practice/assistance HUD built with Electron, HTML, CSS, and JavaScript. It can capture a spoken prompt, transcribe it, and show a streamed AI response in a compact overlay. The app includes role presets and a custom role profile so responses can be tailored to a target role.

> Use this tool transparently and in accordance with interview rules and the meeting platform's policies. Do not use it to misrepresent your abilities or to capture people without their knowledge or consent.

## How it works

1. `main.js` creates a frameless, transparent, always-on-top Electron window and registers global keyboard shortcuts.
2. `src/ui/` provides the HUD, its styles, and renderer logic. The renderer captures audio and detects speech segments, then calls the main process through the preload bridge.
3. `preload.js` exposes a limited `electronAPI` via `contextBridge`; IPC handlers in `main.js` accept text/audio, manage role settings, and relay streaming events.
4. `src/services/stt-stream.js` sends WAV audio to Groq's Whisper transcription endpoint. It also contains a Deepgram WebSocket implementation.
5. `src/services/llm-stream.js` sends prompts to Groq's OpenAI-compatible streaming endpoint or Gemini's streaming endpoint, parses SSE chunks, and emits tokens incrementally.
6. `src/core/role-engine.js` builds a role-specific system prompt; `src/core/config.js` reads environment variables and supplies defaults.

Conversation history is held in memory by the main process and is cleared on app exit. Provider APIs receive the audio or text required for their requests; review each provider's terms and data handling before use.

## Main skills and techniques

- **Electron desktop development:** BrowserWindow lifecycle, frameless transparent windows, global shortcuts, and OS-specific window behavior.
- **Secure renderer/main separation:** `contextIsolation`, disabled `nodeIntegration`, a preload bridge, and IPC handlers.
- **Audio processing:** Web Audio capture, speech activity detection using audio levels, WAV chunk handling, and speech-to-text integration.
- **Streaming APIs:** Fetch, `AbortController`, server-sent events (SSE), incremental UTF-8 decoding, token streaming, and fallback providers.
- **Prompt engineering:** Role/persona context, response structure, and question-type model routing.
- **Real-time UI:** Incremental DOM updates, status/latency feedback, transcription ticker, and cancellation controls.
- **Configuration and secrets:** Environment-based API configuration. Keep keys in a local `.env` file and never commit them.

## Run from source

Prerequisite: a Node.js version that supports the global `fetch`, `FormData`, and `Blob` APIs, plus npm.

```sh
cp .env.example .env
# Edit .env and add at least GROQ_API_KEY (Gemini can be configured as a fallback).
npm install
npm start
```

The packaged Windows executable in the supplied folder is intentionally not included in this source repository. Build/distribution scripts are not present in this extracted source, so the packaging workflow needs to be added before producing a new installer.

## Keyboard shortcuts

- `Ctrl/Cmd + Space`: start/stop push-to-listen capture
- `Ctrl/Cmd + Shift + X`: hide/show the HUD
- `Ctrl/Cmd + Shift + C`: toggle click-through
- `Ctrl/Cmd + Shift + R`: clear in-memory conversation history

## Configuration

See `.env.example` for supported variables. `GROQ_API_KEY` is used for Whisper and Groq chat; `GEMINI_API_KEY` enables Gemini responses/fallback; `DEEPGRAM_API_KEY` is used by the included Deepgram WebSocket service. Use keys issued to your team and rotate any key that has been placed in a distributed app bundle or shared repository.

## Deployment

This project is a native Electron desktop app, not a web app. Vercel does not package or host Electron desktop applications. To use Vercel, build a separate web application and server-side API, then store provider keys in Vercel environment variables. Do not put provider keys in browser code.

## Project layout

```text
main.js                     Electron main process and IPC handlers
preload.js                  Narrow renderer-to-main bridge
src/core/config.js          Environment configuration and defaults
src/core/role-engine.js     Role presets and prompt construction
src/services/               Speech-to-text and LLM streaming clients
src/ui/                     HUD markup, styles, and renderer behavior
```

## License

The packaged application includes an MIT license. Confirm your team's authorship and dependency license obligations before publishing this source publicly.

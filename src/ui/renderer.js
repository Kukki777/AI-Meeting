/**
 * Stealth Interview HUD Renderer Logic - Fluid Streaming Engine
 * Displays output simultaneously in a continuous, smooth word-by-word flow
 */

// DOM Elements
const roleBadgeBtn = document.getElementById('roleBadgeBtn');
const roleLabel = document.getElementById('roleLabel');
const latencyPill = document.getElementById('latencyPill');
const statusDot = document.getElementById('statusDot');
const tickerText = document.getElementById('tickerText');
const speakerTag = document.getElementById('speakerTag');
const responseViewport = document.getElementById('responseViewport');
const emptyState = document.getElementById('emptyState');
const streamCanvas = document.getElementById('streamCanvas');
const manualInput = document.getElementById('manualInput');
const sendBtn = document.getElementById('sendBtn');
const clickThroughBtn = document.getElementById('clickThroughBtn');
const panicBtn = document.getElementById('panicBtn');
const closeBtn = document.getElementById('closeBtn');
const imageBtn = document.getElementById('imageBtn');
const questionImage = document.getElementById('questionImage');
const imageChip = document.getElementById('imageChip');
const imageThumb = document.getElementById('imageThumb');
let attachedImage = '';

// Modal Elements
const roleModal = document.getElementById('roleModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const saveRoleBtn = document.getElementById('saveRoleBtn');
const customRoleTitle = document.getElementById('customRoleTitle');
const customSpecializations = document.getElementById('customSpecializations');
const customLanguage = document.getElementById('customLanguage');
const customContext = document.getElementById('customContext');

let currentRawAnswer = '';
let isClickThroughActive = false;
let isCurrentlyStreaming = false;

// ── Initial Setup & Role Loading ──
async function init() {
  if (window.electronAPI) {
    const role = await window.electronAPI.getRole();
    if (role && role.title) {
      roleLabel.textContent = role.title;
    }
  }

  setupEventListeners();
  setupIPCListeners();
  initRealAudioEngine();
}

/**
 * Fluid Real-Time Stream Renderer
 * Incrementally updates only the active section's text — no full DOM re-render per token.
 * Sections are created once, then only their text nodes are updated, eliminating flicker.
 */

// Track which sections have been created to avoid re-building the DOM every token
let _renderedSections = { speak: false, bullets: false, code: false };

function resetRenderState() {
  _renderedSections = { speak: false, bullets: false, code: false };
}

function renderFluidStream(rawText, isStreaming = true) {
  emptyState.style.display = 'none';
  streamCanvas.style.display = 'flex';

  const cursorHtml = isStreaming ? '<span class="streaming-cursor"></span>' : '';

  // ── Parse sections from accumulated text ──
  let speakContent = '';
  let bulletsContent = '';
  let codeContent = '';
  let activeSection = 'speak';

  const bulletsMarker = rawText.search(/⚡|\*{0,2}\[?KEY TECHNICAL/i);
  const codeMarker = rawText.search(/```/);

  if (bulletsMarker === -1 && codeMarker === -1) {
    speakContent = rawText;
    activeSection = 'speak';
  } else if (bulletsMarker !== -1 && (codeMarker === -1 || bulletsMarker < codeMarker)) {
    speakContent = rawText.substring(0, bulletsMarker);
    if (codeMarker !== -1) {
      bulletsContent = rawText.substring(bulletsMarker, codeMarker);
      codeContent = rawText.substring(codeMarker);
      activeSection = 'code';
    } else {
      bulletsContent = rawText.substring(bulletsMarker);
      activeSection = 'bullets';
    }
  } else if (codeMarker !== -1) {
    speakContent = rawText.substring(0, codeMarker);
    codeContent = rawText.substring(codeMarker);
    activeSection = 'code';
  }

  speakContent = speakContent.replace(/🎯\s*\*{0,2}\[?SPEAK FIRST\]?\*{0,2}:?/gi, '').trim();
  bulletsContent = bulletsContent.replace(/⚡\s*\*{0,2}\[?KEY TECHNICAL (?:POINTS|BULLETS)\]?\*{0,2}:?/gi, '').trim();

  // ── Incremental DOM — create sections only once, then update text ──

  // 1. Speak First card
  if (speakContent || activeSection === 'speak') {
    if (!_renderedSections.speak) {
      _renderedSections.speak = true;
      const div = document.createElement('div');
      div.className = 'stream-section speak-card';
      div.id = '_sec_speak';
      div.innerHTML = `<div class="section-badge">🎯 SPEAK FIRST (Say this immediately)</div><div class="section-content" id="_sec_speak_body"></div>`;
      streamCanvas.appendChild(div);
    }
    const body = document.getElementById('_sec_speak_body');
    if (body) {
      const activeCursor = (activeSection === 'speak' && isStreaming) ? cursorHtml : '';
      body.innerHTML = escapeHtml(speakContent) + activeCursor;
    }
  }

  // 2. Key Bullets card
  if (bulletsContent || activeSection === 'bullets') {
    if (!_renderedSections.bullets) {
      _renderedSections.bullets = true;
      const div = document.createElement('div');
      div.className = 'stream-section bullets-card';
      div.id = '_sec_bullets';
      div.innerHTML = `<div class="section-badge">⚡ KEY TECHNICAL POINTS</div><div class="section-content" id="_sec_bullets_body"></div>`;
      streamCanvas.appendChild(div);
    }
    const body = document.getElementById('_sec_bullets_body');
    if (body) {
      const activeCursor = (activeSection === 'bullets' && isStreaming) ? cursorHtml : '';
      // Format bullets as HTML list
      let formatted = bulletsContent;
      if (bulletsContent) {
        const lines = bulletsContent.split('\n')
          .map(l => l.trim()).filter(l => l.length > 0)
          .map(l => {
            let clean = l.replace(/^[-*•]\s*/, '');
            clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            return `<li>${clean}</li>`;
          });
        formatted = `<ul>${lines.join('')}</ul>`;
      }
      body.innerHTML = (formatted || bulletsContent) + activeCursor;
    }
  }

  // 3. Code card
  if (codeContent || activeSection === 'code') {
    if (!_renderedSections.code) {
      _renderedSections.code = true;
      const div = document.createElement('div');
      div.className = 'code-card';
      div.id = '_sec_code';
      div.innerHTML = `
        <div class="code-card-header">
          <span class="code-badge">💻 IMPLEMENTATION / ARCHITECTURE</span>
          <button class="copy-code-btn" onclick="copyActiveCode()">Copy Code</button>
        </div>
        <pre><code id="liveCode"></code></pre>
      `;
      streamCanvas.appendChild(div);
    }
    const codeEl = document.getElementById('liveCode');
    if (codeEl) {
      const activeCursor = (activeSection === 'code' && isStreaming) ? cursorHtml : '';
      const cleanCode = codeContent.replace(/^```[a-zA-Z0-9_\-\+]*\n?/, '').replace(/```$/, '');
      codeEl.innerHTML = escapeHtml(cleanCode) + activeCursor;
    }
  }

  // Auto-scroll to keep reading point in view
  responseViewport.scrollTop = responseViewport.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInstantAnchor(anchorText) {
  emptyState.style.display = 'none';
  streamCanvas.style.display = 'flex';
  streamCanvas.innerHTML = `
    <div class="stream-section speak-card">
      <div class="section-badge">🎯 SPEAK FIRST (Say this immediately)</div>
      <div class="section-content">${escapeHtml(anchorText)}<span class="streaming-cursor"></span></div>
    </div>
    <div class="stream-section bullets-card" style="opacity: 0.65;">
      <div class="section-badge">⚡ KEY TECHNICAL POINTS</div>
      <div class="section-content"><em>Streaming deep technical mechanics...</em></div>
    </div>
  `;
}

function getInstantOpener(question) {
  const q = (question || '').toLowerCase().trim();
  if (!q) return 'Let me break that down — at a high level...';

  // Pools of varied, natural-sounding openers per question type
  const pools = {
    compare: [
      'Short answer — the key difference is how they handle the underlying data model.',
      'The tradeoff really comes down to two things — let me walk through them.',
      "In practice, the choice between them depends on your consistency requirements.",
      'So these solve the same problem but diverge fundamentally in one critical way.',
      "I've seen both in production — here's when each one makes sense.",
    ],
    explain: [
      'So the way this actually works under the hood is...',
      'Let me break that down step by step.',
      'The core mechanism is actually elegant — here is how it flows.',
      'To understand this properly, start from the internals.',
      'In practice, the execution flow looks like this.',
    ],
    why: [
      "The core engineering reason for this is actually pretty intuitive.",
      "Short answer — it eliminates a specific class of bottlenecks.",
      "The rationale here is about eliminating latency at the source.",
      "It comes down to one fundamental tradeoff — scalability vs consistency.",
      "In production, the reason you choose this is...",
    ],
    design: [
      "The first thing I'd nail down is the consistency model, then build outward.",
      "I'd start with the read/write ratio — that drives every other decision.",
      "For this system, I'd layer it: edge → service → cache → DB.",
      "The critical design decision here is partitioning strategy.",
      "I'd approach this in three layers — let me walk through each.",
    ],
    optimize: [
      "The primary lever here is reducing I/O contention at the hot path.",
      "To optimize this, you attack it in two passes — profiling first, then execution.",
      "The bottleneck is almost always at the cache boundary — here is why.",
      "In my experience, the 80% win comes from one specific change.",
      "Short answer — parallelize the slow path and cache the result.",
    ],
    default: [
      'The key thing to understand here is...',
      "Let me walk through this — starting with the most important part.",
      "At a high level, this comes down to...",
      "So the way I think about this is...",
      "The short answer is straightforward, but the nuance matters.",
    ],
  };

  // Pick the right pool
  let pool = pools.default;
  if (q.includes('difference') || q.includes(' vs ') || q.includes('versus') || q.includes('compare'))
    pool = pools.compare;
  else if (q.includes('how does') || q.includes('how do') || q.includes('explain') || q.includes('how to') || q.includes('works'))
    pool = pools.explain;
  else if (q.includes('why') || q.includes('advantage') || q.includes('benefit') || q.includes('prefer'))
    pool = pools.why;
  else if (q.includes('design') || q.includes('architecture') || q.includes('system'))
    pool = pools.design;
  else if (q.includes('optimize') || q.includes('scale') || q.includes('bottleneck') || q.includes('latency'))
    pool = pools.optimize;

  // Pick randomly from the pool so it never sounds repeated
  return pool[Math.floor(Math.random() * pool.length)];
}

window.copyActiveCode = function() {
  const codeEl = document.getElementById('liveCode');
  if (codeEl) {
    // Strip cursor if present
    const cleanText = codeEl.innerText.replace(/[\u25AE\u2588]/g, '');
    navigator.clipboard.writeText(cleanText);
    const btn = document.querySelector('.copy-code-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Code'; }, 1500);
    }
  }
};

window.abortStream = async function() {
  if (window.electronAPI) {
    await window.electronAPI.abortLLM();
  }
  isCurrentlyStreaming = false;
  statusDot.classList.remove('pulsing');
  latencyPill.textContent = 'Stopped';
  latencyPill.style.color = '#f59e0b';
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) stopBtn.style.display = 'none';
  renderFluidStream(currentRawAnswer, false);
};

// ── Setup IPC Listeners ──
function setupIPCListeners() {
  if (!window.electronAPI) return;

  // 1. LLM Stream Started
  window.electronAPI.onLLMStart((data) => {
    isCurrentlyStreaming = true;
    currentRawAnswer = '';
    resetRenderState();
    streamCanvas.innerHTML = ''; // Clear previous answer's DOM nodes
    emptyState.style.display = 'none';
    streamCanvas.style.display = 'flex';
    statusDot.classList.add('pulsing');
    latencyPill.textContent = 'Speaking...';
    latencyPill.style.color = '#10b981';

    // Show stop button
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    // Instantly show immediate conversational opening anchor
    const opener = getInstantOpener(data?.question || '');
    renderInstantAnchor(opener);
  });

  // 2. LLM Token Received (Word-by-word flow)
  window.electronAPI.onLLMToken((data) => {
    currentRawAnswer = data.accumulatedText;
    renderFluidStream(currentRawAnswer, true);
  });

  // 3. First Token Arrived
  if (window.electronAPI.onLLMFirstToken) {
    window.electronAPI.onLLMFirstToken((data) => {
      if (data && data.latencyMs) {
        latencyPill.textContent = `TTFT: ${data.latencyMs}ms`;
        latencyPill.style.color = '#10b981';
      }
    });
  }

  // 4. LLM Stream Completed
  window.electronAPI.onLLMDone((data) => {
    isCurrentlyStreaming = false;
    statusDot.classList.remove('pulsing');
    // Hide stop button
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) stopBtn.style.display = 'none';
    if (data && data.firstTokenMs) {
      latencyPill.textContent = `TTFT: ${data.firstTokenMs}ms`;
      latencyPill.style.color = '#10b981';
    } else {
      latencyPill.textContent = 'Ready';
      latencyPill.style.color = '#a855f7';
    }
    // Re-render without cursor (final pass)
    renderFluidStream(currentRawAnswer, false);
  });

  // 5. LLM Error
  window.electronAPI.onLLMError((data) => {
    isCurrentlyStreaming = false;
    statusDot.classList.remove('pulsing');
    latencyPill.textContent = 'Error';
    latencyPill.style.color = '#ef4444';
    streamCanvas.innerHTML = `
      <div class="stream-section speak-card" style="border-left-color: #ef4444;">
        <div class="section-badge" style="color: #ef4444;">⚠️ CONNECTION ERROR</div>
        <div class="section-content">${escapeHtml(data.error || 'Failed to fetch response.')}</div>
      </div>
    `;
  });

  // 6. Live Transcript Ticker
  window.electronAPI.onTranscript((data) => {
    if (data && data.text) {
      speakerTag.textContent = 'INTERVIEWER:';
      tickerText.textContent = data.text;
    }
  });

  window.electronAPI.onInterimTranscript((data) => {
    if (data && data.text) {
      speakerTag.textContent = 'HEARING:';
      tickerText.textContent = data.text + '...';
    }
  });
}

// ── Event Handlers ──
function setupEventListeners() {
  const setAttachedImage = data => { attachedImage = data; imageThumb.src = data; imageChip.hidden = !data; };
  const loadQuestionImage = async file => {
    if (!file?.type?.startsWith('image/')) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const data = canvas.toDataURL('image/jpeg', .72);
      if (data.length > 3_600_000) throw new Error('Image is too large; choose a smaller one.');
      setAttachedImage(data);
    } catch (error) { tickerText.textContent = error.message || 'Could not load image.'; }
  };
  imageBtn?.addEventListener('click', () => questionImage.click());
  document.getElementById('pasteTextBtn')?.addEventListener('click', async () => {
    try {
      const text = await window.electronAPI?.pasteText();
      if (text) { manualInput.setRangeText(text, manualInput.selectionStart, manualInput.selectionEnd, 'end'); manualInput.focus(); }
    } catch (_) { tickerText.textContent = 'Clipboard unavailable. Focus the question box and press ⌘V.'; }
  });
  questionImage?.addEventListener('change', e => loadQuestionImage(e.target.files[0]));
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadQuestionImage(item.getAsFile()); }
  });
  document.getElementById('removeImage')?.addEventListener('click', () => { setAttachedImage(''); questionImage.value = ''; });

  // Manual Question Send
  const triggerSend = () => {
    const q = manualInput.value.trim();
    if (!q && !attachedImage) return;
    speakerTag.textContent = 'YOU / QUERY:';
    tickerText.textContent = q || 'Question from attached image';
    manualInput.value = '';
    if (window.electronAPI) {
      if (attachedImage) {
        const image = attachedImage; setAttachedImage(''); questionImage.value = '';
        window.electronAPI.studyImageQuestion({ image, question: q, subject: 'General' }).then(answer => {
          currentRawAnswer = answer; resetRenderState(); emptyState.style.display = 'none'; streamCanvas.style.display = 'flex'; renderFluidStream(answer, false);
        }).catch(error => {
          resetRenderState(); emptyState.style.display = 'none'; streamCanvas.style.display = 'flex';
          const card = document.createElement('div'); card.className = 'stream-section speak-card';
          const content = document.createElement('div'); content.className = 'section-content'; content.textContent = error.message || 'Could not answer this image.';
          card.append(content); streamCanvas.append(card);
        });
      } else window.electronAPI.askLLM(q);
    }
  };

  sendBtn.addEventListener('click', triggerSend);
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerSend();
  });

  // Click-Through Toggle
  clickThroughBtn.addEventListener('click', async () => {
    isClickThroughActive = !isClickThroughActive;
    if (window.electronAPI) {
      await window.electronAPI.setClickThrough(isClickThroughActive);
    }
    clickThroughBtn.style.color = isClickThroughActive ? '#10b981' : '#94a3b8';
  });

  // Panic Hide
  panicBtn.addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  });

  // Close Window
  closeBtn.addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  });

  // Role Customization Modal
  roleBadgeBtn.addEventListener('click', () => {
    roleModal.style.display = 'flex';
  });

  closeModalBtn.addEventListener('click', () => {
    roleModal.style.display = 'none';
  });

  cancelModalBtn.addEventListener('click', () => {
    roleModal.style.display = 'none';
  });

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetId = btn.getAttribute('data-preset');
      if (window.electronAPI) {
        const updated = await window.electronAPI.setPreset(presetId);
        roleLabel.textContent = updated.title;
      }
      roleModal.style.display = 'none';
    });
  });

  // Save Custom Role
  saveRoleBtn.addEventListener('click', async () => {
    const customData = {
      title: customRoleTitle.value.trim() || 'Senior Technical Specialist',
      specializations: customSpecializations.value.trim(),
      preferredLanguage: customLanguage.value.trim() || 'Python',
      customContext: customContext.value.trim()
    };

    if (window.electronAPI) {
      const updated = await window.electronAPI.setRole(customData);
      roleLabel.textContent = updated.title;
    }
    roleModal.style.display = 'none';
  });
}

// ── Robust In-Memory Web Audio & VAD Engine ──
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let analyser = null;
let isRecordingUtterance = false;
let audioChunks = [];
let silenceTimer = null;
let isPushToTalkRecording = false;
let pushToTalkSafetyTimer = null;

// VAD tuning constants
const VAD_SPEECH_DB = -32;      // dB threshold to consider as speech (tune for environment)
const VAD_SILENCE_MS = 2200;    // 2.2s of silence = natural end of utterance
const VAD_MIN_SAMPLES = 8000;   // ~0.5s minimum to bother sending (avoids cough/click)
const VAD_MAX_SAMPLES = 16000 * 60; // 60s hard ceiling

// 16-bit Mono 16kHz PCM WAV Encoder (Zero Disk I/O)
function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return buffer;
}

async function initRealAudioEngine() {
  const listenBtn = document.getElementById('listenBtn');
  const audioDot = document.getElementById('audioDot');
  const listenLabel = document.getElementById('listenLabel');

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);

    const bufferSize = 2048;
    scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    scriptProcessor.onaudioprocess = (e) => {
      const channelData = e.inputBuffer.getChannelData(0);

      // ── RMS-based Voice Activity Detection ──
      // RMS is far more accurate than frequency average for detecting human speech
      let sumSq = 0;
      for (let i = 0; i < channelData.length; i++) {
        sumSq += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sumSq / channelData.length);
      const dB = 20 * Math.log10(rms + 1e-9); // Convert to dB, avoid log(0)
      const isSpeech = dB > VAD_SPEECH_DB;

      // Audio Level Feedback Dot — use dB for visual feedback too
      if (audioDot) {
        if (dB > VAD_SPEECH_DB + 8) audioDot.classList.add('live');
        else audioDot.classList.remove('live');
      }

      // Voice Activity Detection
      if (isSpeech || isPushToTalkRecording) {
        if (!isRecordingUtterance) {
          isRecordingUtterance = true;
          audioChunks = [];
          speakerTag.textContent = 'HEARING:';
          tickerText.textContent = 'Listening to interviewer speech...';
        }

        // Buffer audio up to the max ceiling
        if (audioChunks.length < VAD_MAX_SAMPLES) {
          for (let i = 0; i < channelData.length; i++) {
            audioChunks.push(channelData[i]);
          }
        }

        // Reset silence timer whenever there is active speech
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (isRecordingUtterance && !isPushToTalkRecording) {
        // Natural end of speech — extended grace period (2.2s) handles thinking pauses
        if (!silenceTimer) {
          silenceTimer = setTimeout(() => {
            finalizeAndSendUtterance();
          }, VAD_SILENCE_MS);
        }
      }
    };

    tickerText.textContent = 'Audio engine active. Listening for questions...';
    if (listenLabel) listenLabel.textContent = 'Live Audio';
  } catch (err) {
    console.error('Audio engine failed to initialize:', err);
    tickerText.textContent = 'Mic access blocked: ' + err.message + ' (Use manual input below)';
    if (listenLabel) listenLabel.textContent = 'Mic Blocked';
  }

  // Push-to-Listen Click
  if (listenBtn) {
    listenBtn.addEventListener('click', toggleManualAudioCapture);
  }

  // Global Shortcut Trigger (Ctrl+Space)
  if (window.electronAPI && window.electronAPI.onTriggerAudioCapture) {
    window.electronAPI.onTriggerAudioCapture(() => {
      toggleManualAudioCapture();
    });
  }
}

function toggleManualAudioCapture() {
  const listenBtn = document.getElementById('listenBtn');
  const listenLabel = document.getElementById('listenLabel');

  if (!isPushToTalkRecording) {
    isPushToTalkRecording = true;
    isRecordingUtterance = true;
    audioChunks = [];
    if (listenBtn) listenBtn.classList.add('recording');
    if (listenLabel) listenLabel.textContent = 'Listening (Ctrl+Space to finish)...';
    speakerTag.textContent = 'LISTENING:';
    tickerText.textContent = 'Capturing complete question... (Press Ctrl+Space when interviewer stops)';

    if (pushToTalkSafetyTimer) clearTimeout(pushToTalkSafetyTimer);
    // Generous 45-second safety ceiling
    pushToTalkSafetyTimer = setTimeout(() => {
      if (isPushToTalkRecording) {
        isPushToTalkRecording = false;
        if (listenBtn) listenBtn.classList.remove('recording');
        if (listenLabel) listenLabel.textContent = 'Live Audio';
        finalizeAndSendUtterance();
      }
    }, 45000);
  } else {
    if (pushToTalkSafetyTimer) {
      clearTimeout(pushToTalkSafetyTimer);
      pushToTalkSafetyTimer = null;
    }
    isPushToTalkRecording = false;
    if (listenBtn) listenBtn.classList.remove('recording');
    if (listenLabel) listenLabel.textContent = 'Live Audio';
    finalizeAndSendUtterance();
  }
}

async function finalizeAndSendUtterance() {
  if (pushToTalkSafetyTimer) {
    clearTimeout(pushToTalkSafetyTimer);
    pushToTalkSafetyTimer = null;
  }
  isRecordingUtterance = false;
  silenceTimer = null;

  // Minimum ~0.5s of speech required before sending
  if (audioChunks.length > VAD_MIN_SAMPLES) {
    const samples = new Float32Array(audioChunks);
    audioChunks = [];

    const wavBuffer = encodeWAV(samples, 16000);
    speakerTag.textContent = 'TRANSCRIBING:';
    tickerText.textContent = 'Transcribing question via Groq Whisper...';

    if (window.electronAPI && window.electronAPI.processAudioChunk) {
      await window.electronAPI.processAudioChunk(wavBuffer);
    }
  } else {
    audioChunks = [];
    speakerTag.textContent = 'INTERVIEWER:';
    tickerText.textContent = 'Listening for questions in real time...';
  }
}

// Boot up
window.addEventListener('DOMContentLoaded', init);

const $ = id => document.getElementById(id);
const ui = {
  roleBadgeBtn: $('roleBadgeBtn'), roleLabel: $('roleLabel'), latencyPill: $('latencyPill'), statusDot: $('statusDot'),
  tickerText: $('tickerText'), speakerTag: $('speakerTag'), responseViewport: $('responseViewport'), emptyState: $('emptyState'),
  streamCanvas: $('streamCanvas'), manualInput: $('manualInput'), sendBtn: $('sendBtn'), clickThroughBtn: $('clickThroughBtn'),
  panicBtn: $('panicBtn'), closeBtn: $('closeBtn'), roleModal: $('roleModal'), closeModalBtn: $('closeModalBtn'),
  cancelModalBtn: $('cancelModalBtn'), saveRoleBtn: $('saveRoleBtn'), customRoleTitle: $('customRoleTitle'),
  customSpecializations: $('customSpecializations'), customLanguage: $('customLanguage'), customContext: $('customContext'),
  listenBtn: $('listenBtn'), listenLabel: $('listenLabel'), audioDot: $('audioDot')
};
let attachedImage = '';

function addTranscriptToQuestion(text) {
  const transcript = String(text || '').trim();
  if (!transcript) return;
  const existing = ui.manualInput.value.trim();
  const nextValue = existing ? `${existing} ${transcript}` : transcript;
  ui.manualInput.value = nextValue;
  ui.manualInput.setSelectionRange(nextValue.length, nextValue.length);
}

const defaults = { title: 'Senior AI / Machine Learning Engineer', seniority: 'Staff / Senior', specializations: ['LLMs', 'vLLM/TensorRT-LLM', 'PyTorch', 'RAG', 'Distributed Training', 'Quantization'], preferredLanguage: 'Python', customContext: '' };
const presets = {
  'ai-engineer': { title: 'Senior AI / Machine Learning Engineer', seniority: 'Senior (5+ yrs)', specializations: ['LLM Serving (vLLM, SGLang)', 'RAG & Vector Search', 'Fine-Tuning (LoRA/QLoRA)', 'PyTorch/CUDA', 'Evaluation & Guardrails'], preferredLanguage: 'Python', customContext: 'Expertise in scaling generative AI workloads, optimizing TTFT and throughput, handling context lengths, and production inference.' },
  'mlops-engineer': { title: 'Senior MLOps & Platform Engineer', seniority: 'Senior (6+ yrs)', specializations: ['Triton Server', 'Kubeflow / Ray', 'Feature Stores (Feast)', 'CI/CD for ML', 'Model Monitoring & Drift'], preferredLanguage: 'Python / Go', customContext: 'Deep focus on GPU cluster orchestration, latency SLAs, model lifecycle governance, and distributed model deployments.' },
  'backend-architect': { title: 'Staff Backend & Distributed Systems Architect', seniority: 'Staff (8+ yrs)', specializations: ['Distributed Systems', 'Kafka / Event-Driven', 'PostgreSQL / DynamoDB', 'gRPC / Microservices', 'High-Concurrency Concurrency'], preferredLanguage: 'Go / Java / Python', customContext: 'Focus on consensus algorithms (Raft), idempotency, partition tolerance, caching hierarchies, and database connection pooling.' },
  'fullstack-engineer': { title: 'Lead Full-Stack Engineer', seniority: 'Lead (7+ yrs)', specializations: ['React 19 / Next.js', 'Node.js / TypeScript', 'WebSockets', 'GraphQL / REST', 'Edge Computing & Tailwind'], preferredLanguage: 'TypeScript', customContext: 'Focus on modern UI rendering lifecycles, state synchronization, SSR/SSG caching, and end-to-end type safety.' },
  'devops-cloud': { title: 'Senior Cloud & DevOps Engineer', seniority: 'Senior (6+ yrs)', specializations: ['Kubernetes (EKS/GKE)', 'Terraform / IaC', 'AWS / GCP Cloud Architecture', 'Observability (Datadog/Prometheus)', 'Zero-Trust Security'], preferredLanguage: 'Go / Bash / Python', customContext: 'Focus on multi-region failover, container security, cost optimization, GitOps (ArgoCD), and infrastructure resilience.' }
};
let role = JSON.parse(localStorage.getItem('copilot-role') || 'null') || defaults;
let history = JSON.parse(sessionStorage.getItem('copilot-history') || '[]');
let controller = null;
let currentRawAnswer = '';
let audioContext = null, mediaStream = null, processor = null, audioChunks = [], silenceTimer = null;
let isRecordingUtterance = false, pushToTalk = false, pushTimer = null;
const VAD_SPEECH_DB = -32, VAD_SILENCE_MS = 2200, VAD_MIN_SAMPLES = 8000, VAD_MAX_SAMPLES = 16000 * 60;

function setRole(next) { role = next; localStorage.setItem('copilot-role', JSON.stringify(role)); ui.roleLabel.textContent = role.title; }
function setMessage(tag, message) { ui.speakerTag.textContent = tag; ui.tickerText.textContent = message; }
function escaped(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function resetCanvas() { ui.streamCanvas.replaceChildren(); ui.emptyState.style.display = 'none'; ui.streamCanvas.style.display = 'flex'; }

function renderAnswer(raw, streaming = true) {
  currentRawAnswer = raw;
  resetCanvas();
  const bulletAt = raw.search(/⚡|\*{0,2}\[?KEY TECHNICAL/i);
  const codeAt = raw.search(/```/);
  let speak = raw, bullets = '', code = '';
  if (bulletAt >= 0 && (codeAt < 0 || bulletAt < codeAt)) {
    speak = raw.slice(0, bulletAt); bullets = raw.slice(bulletAt, codeAt < 0 ? undefined : codeAt);
    if (codeAt >= 0) code = raw.slice(codeAt);
  } else if (codeAt >= 0) { speak = raw.slice(0, codeAt); code = raw.slice(codeAt); }
  speak = speak.replace(/🎯\s*\*{0,2}\[?SPEAK FIRST\]?\*{0,2}:?/gi, '').trim();
  bullets = bullets.replace(/⚡\s*\*{0,2}\[?KEY TECHNICAL (?:POINTS|BULLETS)\]?\*{0,2}:?/gi, '').trim();
  const addCard = (badge, body, klass) => {
    const card = document.createElement('div'); card.className = `stream-section ${klass}`;
    const label = document.createElement('div'); label.className = 'section-badge'; label.textContent = badge;
    const content = document.createElement('div'); content.className = 'section-content'; content.innerHTML = body;
    card.append(label, content); ui.streamCanvas.append(card);
  };
  if (speak || !bullets) addCard('🎯 SPEAK FIRST (Say this immediately)', `${escaped(speak)}${streaming && !bullets ? '<span class="streaming-cursor"></span>' : ''}`, 'speak-card');
  if (bullets) {
    const list = bullets.split('\n').map(x => x.trim()).filter(Boolean).map(x => `<li>${escaped(x.replace(/^[-*•]\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1'))}</li>`).join('');
    addCard('⚡ KEY TECHNICAL POINTS', `<ul>${list}</ul>`, 'bullets-card');
  }
  if (code) {
    const clean = code.replace(/^```[\w+-]*\n?/, '').replace(/```\s*$/, '');
    const card = document.createElement('div'); card.className = 'code-card';
    const header = document.createElement('div'); header.className = 'code-card-header';
    const badge = document.createElement('span'); badge.className = 'code-badge'; badge.textContent = '💻 IMPLEMENTATION / ARCHITECTURE';
    const copy = document.createElement('button'); copy.className = 'copy-code-btn'; copy.textContent = 'Copy Code';
    copy.onclick = async () => { await navigator.clipboard.writeText(clean); copy.textContent = 'Copied!'; setTimeout(() => copy.textContent = 'Copy Code', 1200); };
    const pre = document.createElement('pre'), codeEl = document.createElement('code'); codeEl.textContent = clean;
    if (streaming) codeEl.textContent += ' ▌'; pre.append(codeEl); header.append(badge, copy); card.append(header, pre); ui.streamCanvas.append(card);
  }
  ui.responseViewport.scrollTop = ui.responseViewport.scrollHeight;
}

function parseEvents(stream, onEvent) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = '';
  return (async () => {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split('\n\n'); buffer = records.pop();
      for (const record of records) {
        const event = record.match(/^event:\s*(.+)$/m)?.[1];
        const data = record.match(/^data:\s*(.+)$/m)?.[1];
        if (event && data) { let parsed; try { parsed = JSON.parse(data); } catch (_) { continue; } onEvent(event, parsed); }
      }
    }
  })();
}

async function ask(question, image = '') {
  if ((!question.trim() && !image) || controller) return;
  history.push({ speaker: 'interviewer', text: question.trim() }); history = history.slice(-20);
  setMessage('YOU / QUERY:', question.trim() || 'Question from attached image'); controller = new AbortController();
  ui.statusDot.classList.add('pulsing'); ui.latencyPill.textContent = 'Speaking...';
  $('stopBtn').style.display = 'inline-flex';
  try {
    const response = await fetch(image ? '/api/study' : '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, image, subject: role.title, role, history: history.slice(0, -1) }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error || 'Request failed.');
    if (image) {
      const data = await response.json();
      currentRawAnswer = data.answer || ''; resetCanvas(); renderAnswer(currentRawAnswer, false);
      history.push({ speaker: 'candidate', text: currentRawAnswer }); history = history.slice(-20); sessionStorage.setItem('copilot-history', JSON.stringify(history));
    } else await parseEvents(response.body, (event, data) => {
      if (event === 'start') { currentRawAnswer = ''; resetCanvas(); }
      if (event === 'token') { currentRawAnswer = data.accumulatedText; renderAnswer(currentRawAnswer); if (data.firstTokenMs) ui.latencyPill.textContent = `TTFT: ${data.firstTokenMs}ms`; }
      if (event === 'done') { renderAnswer(data.fullText || currentRawAnswer, false); ui.latencyPill.textContent = data.firstTokenMs ? `TTFT: ${data.firstTokenMs}ms` : 'Ready'; history.push({ speaker: 'candidate', text: data.fullText || currentRawAnswer }); history = history.slice(-20); sessionStorage.setItem('copilot-history', JSON.stringify(history)); }
      if (event === 'error') { ui.latencyPill.textContent = 'Error'; resetCanvas(); const card = document.createElement('div'); card.className = 'stream-section speak-card'; card.textContent = data.error; ui.streamCanvas.append(card); }
    });
  } catch (e) {
    if (e.name !== 'AbortError') { ui.latencyPill.textContent = 'Error'; resetCanvas(); const card = document.createElement('div'); card.className = 'stream-section speak-card'; card.textContent = e.message; ui.streamCanvas.append(card); }
  } finally { controller = null; ui.statusDot.classList.remove('pulsing'); $('stopBtn').style.display = 'none'; }
}

async function transcribe(buffer) {
  setMessage('TRANSCRIBING:', 'Transcribing speech...');
  try {
    const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: bufferToBase64(buffer) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    if (data.text && data.text.length > 3) {
      addTranscriptToQuestion(data.text);
      setMessage('TRANSCRIPT READY:', 'Edit the recognized text below, then press send.');
    }
    else setMessage('INTERVIEWER:', 'No clear speech detected. Listening for questions...');
  } catch (e) { setMessage('AUDIO ERROR:', e.message); }
}

function bufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length))); return btoa(binary); }
function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0, offset = 44; i < samples.length; i++, offset += 2) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buffer;
}

async function startMic() {
  if (audioContext) { await audioContext.resume(); return; }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream); processor = audioContext.createScriptProcessor(2048, 1, 1); source.connect(processor); processor.connect(audioContext.destination);
    processor.onaudioprocess = e => {
      const samples = e.inputBuffer.getChannelData(0); let sum = 0; for (const sample of samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-9); ui.audioDot.classList.toggle('live', db > VAD_SPEECH_DB + 8);
      if (db > VAD_SPEECH_DB || pushToTalk) {
        if (!isRecordingUtterance) { isRecordingUtterance = true; audioChunks = []; setMessage('HEARING:', 'Listening to speech...'); }
        if (audioChunks.length < VAD_MAX_SAMPLES) for (const sample of samples) audioChunks.push(sample);
        clearTimeout(silenceTimer); silenceTimer = null;
      } else if (isRecordingUtterance && !pushToTalk && !silenceTimer) silenceTimer = setTimeout(finalizeAudio, VAD_SILENCE_MS);
    };
    ui.listenLabel.textContent = 'Live Audio'; setMessage('MICROPHONE:', 'Microphone active. Listening for questions...');
  } catch (error) { setMessage('MICROPHONE:', `Access blocked: ${error.message}. Use manual input below.`); }
}
function finalizeAudio() {
  clearTimeout(pushTimer); pushTimer = null; isRecordingUtterance = false; silenceTimer = null;
  if (audioChunks.length > VAD_MIN_SAMPLES) { const samples = new Float32Array(audioChunks); audioChunks = []; transcribe(encodeWAV(samples)); }
  else { audioChunks = []; setMessage('INTERVIEWER:', 'Listening for questions...'); }
}
function togglePushToListen() {
  if (!audioContext) { startMic().then(() => { if (audioContext) togglePushToListen(); }); return; }
  pushToTalk = !pushToTalk; ui.listenBtn.classList.toggle('recording', pushToTalk);
  if (pushToTalk) { audioChunks = []; isRecordingUtterance = true; ui.listenLabel.textContent = 'Listening (Ctrl+Space to finish)...'; setMessage('LISTENING:', 'Capturing question. Press Ctrl+Space to finish.'); pushTimer = setTimeout(() => { pushToTalk = false; finalizeAudio(); }, 45000); }
  else { ui.listenLabel.textContent = 'Live Audio'; finalizeAudio(); }
}

function init() {
  ui.roleLabel.textContent = role.title;
  ui.listenBtn.addEventListener('click', togglePushToListen);
  const imageInput = $('questionImage');
  const setImage = data => { attachedImage = data; $('imageThumb').src = data; $('imageChip').hidden = !data; };
  const loadImage = async file => {
    if (!file?.type?.startsWith('image/')) return;
    try {
      const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const data = canvas.toDataURL('image/jpeg', .72); if (data.length > 3_600_000) throw new Error('Image is too large; choose a smaller one.'); setImage(data);
    } catch (error) { ui.latencyPill.textContent = error.message || 'Could not load image'; }
  };
  $('imageBtn').addEventListener('click', () => imageInput.click());
  $('pasteTextBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { const input = ui.manualInput; input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end'); input.focus(); }
      else ui.latencyPill.textContent = 'Clipboard has no text';
    } catch (_) { ui.latencyPill.textContent = 'Allow clipboard access, or focus the box and press ⌘V / Ctrl+V'; }
  });
  imageInput.addEventListener('change', e => loadImage(e.target.files[0]));
  $('removeImage').addEventListener('click', () => { setImage(''); imageInput.value = ''; });
  document.addEventListener('paste', e => { const item = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/')); if (item) { e.preventDefault(); loadImage(item.getAsFile()); } });
  ui.sendBtn.addEventListener('click', () => { const q = ui.manualInput.value.trim(); if (q || attachedImage) { ui.manualInput.value = ''; const image = attachedImage; setImage(''); imageInput.value = ''; ask(q, image); } });
  ui.manualInput.addEventListener('keydown', e => { if (e.key === 'Enter') ui.sendBtn.click(); });
  $('stopBtn').onclick = () => { controller?.abort(); controller = null; ui.latencyPill.textContent = 'Stopped'; };
  ui.roleBadgeBtn.onclick = () => ui.roleModal.style.display = 'flex';
  ui.closeModalBtn.onclick = ui.cancelModalBtn.onclick = () => ui.roleModal.style.display = 'none';
  document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => { const selected = presets[btn.dataset.preset]; if (selected) setRole(selected); ui.roleModal.style.display = 'none'; }));
  ui.saveRoleBtn.onclick = () => { setRole({ title: ui.customRoleTitle.value.trim() || 'Senior Technical Specialist', seniority: 'Senior', specializations: ui.customSpecializations.value.split(',').map(s => s.trim()).filter(Boolean), preferredLanguage: ui.customLanguage.value.trim() || 'Python', customContext: ui.customContext.value.trim() }); ui.roleModal.style.display = 'none'; };
  ui.clickThroughBtn.disabled = true; ui.clickThroughBtn.title = 'Click-through is available only in the desktop app';
  const panel = document.querySelector('.hud-container');
  const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Show Co-Pilot';
  restore.style.cssText = 'display:none;position:fixed;right:16px;top:16px;z-index:9999;padding:10px 14px;border-radius:10px;background:#1e293b;color:#fff;border:1px solid #475569;cursor:pointer';
  restore.onclick = () => { panel.classList.remove('hidden'); restore.style.display = 'none'; };
  document.body.append(restore);
  const hidePanel = () => { panel.classList.add('hidden'); restore.style.display = 'block'; };
  ui.panicBtn.onclick = hidePanel;
  ui.closeBtn.onclick = hidePanel;
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') { e.preventDefault(); togglePushToListen(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyR') { history = []; sessionStorage.removeItem('copilot-history'); setMessage('HISTORY:', 'Conversation history cleared.'); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyX') { if (panel.classList.contains('hidden')) restore.click(); else hidePanel(); }
  });
}
window.addEventListener('DOMContentLoaded', init);

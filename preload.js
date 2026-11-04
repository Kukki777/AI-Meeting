const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // LLM stream listeners
  onLLMStart: (cb) => ipcRenderer.on('llm-start', (e, data) => cb(data)),
  onLLMToken: (cb) => ipcRenderer.on('llm-token', (e, data) => cb(data)),
  onLLMFirstToken: (cb) => ipcRenderer.on('llm-first-token', (e, data) => cb(data)),
  onLLMDone: (cb) => ipcRenderer.on('llm-done', (e, data) => cb(data)),
  onLLMError: (cb) => ipcRenderer.on('llm-error', (e, data) => cb(data)),
  
  // Transcription events
  onTranscript: (cb) => ipcRenderer.on('transcript-received', (e, data) => cb(data)),
  onInterimTranscript: (cb) => ipcRenderer.on('interim-transcript', (e, data) => cb(data)),
  
  // Trigger generation manually or via audio
  askLLM: (prompt) => ipcRenderer.invoke('ask-llm', prompt),
  processAudioChunk: (arrayBuffer) => ipcRenderer.invoke('process-audio-chunk', arrayBuffer),
  abortLLM: () => ipcRenderer.invoke('abort-llm'),
  studyImageQuestion: (payload) => ipcRenderer.invoke('study-image-question', payload),
  
  // Audio trigger shortcut
  onTriggerAudioCapture: (cb) => ipcRenderer.on('trigger-audio-capture', (e) => cb()),
  
  // Audio chunk forwarding from renderer loopback / mic
  sendAudioChunk: (buffer) => ipcRenderer.send('audio-chunk', buffer),
  
  // Role & Config Management
  getRole: () => ipcRenderer.invoke('get-role'),
  setRole: (roleData) => ipcRenderer.invoke('set-role', roleData),
  setPreset: (presetId) => ipcRenderer.invoke('set-preset', presetId),
  
  // Stealth & Window Controls
  setClickThrough: (ignore) => ipcRenderer.invoke('set-click-through', ignore),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  togglePin: () => ipcRenderer.invoke('toggle-pin')
});

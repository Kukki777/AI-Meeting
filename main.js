const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, clipboard } = require('electron');
const path = require('path');
const config = require('./src/core/config');
const RoleEngine = require('./src/core/role-engine');
const LLMStreamService = require('./src/services/llm-stream');
const STTStreamService = require('./src/services/stt-stream');

// Disguise process name in Windows Task Manager / Process List
if (process.platform === 'win32') {
  app.setAppUserModelId('Microsoft.Windows.Shell.SystemHost');
}

let mainWindow = null;
const roleEngine = new RoleEngine();
const llmService = new LLMStreamService(config);
const sttService = new STTStreamService(config);
let conversationHistory = [];
let isClickThrough = false;

function createStealthWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Window size & initial placement docked cleanly right below the webcam
  const winWidth = 640;
  const winHeight = 440;
  const initialX = Math.round((screenWidth - winWidth) / 2);
  const initialY = 20; // Top of the screen, just beneath camera

  mainWindow = new BrowserWindow({
    x: initialX,
    y: initialY,
    width: winWidth,
    height: winHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    thickFrame: false,
    hasShadow: false,
    show: false, // Hidden until ready-to-show to guarantee display affinity
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/ui/index.html'));

  // ── STEALTH ENGINE: Content Protection (Anti-Screen Sharing) ──
  // Enforced after the window is realized and ready to display
  mainWindow.once('ready-to-show', () => {
    try {
      mainWindow.setContentProtection(true);
      console.log('[STEALTH] Content Protection successfully engaged (WDA_EXCLUDEFROMCAPTURE).');
    } catch (err) {
      console.warn('[STEALTH] Warning: Content protection failed:', err.message);
    }
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  });

  // Re-assert protection and always-on-top on show, focus, and blur
  const reassertStealth = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setContentProtection(true); } catch (_) {}
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  };

  mainWindow.on('show', reassertStealth);
  mainWindow.on('focus', reassertStealth);
  mainWindow.on('blur', reassertStealth);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Global Shortcuts for Live Stealth Control ──
function registerShortcuts() {
  // 1. PANIC KEY: Ctrl+Shift+X (Instantly hide/unhide overlay)
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      try { mainWindow.setContentProtection(true); } catch (_) {}
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  });

  // 2. QUICK LISTEN / CAPTURE: Ctrl+Space (Push-To-Listen)
  globalShortcut.register('CommandOrControl+Space', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trigger-audio-capture');
    }
  });

  // 3. CLICK-THROUGH TOGGLE: Ctrl+Shift+C
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (!mainWindow) return;
    isClickThrough = !isClickThrough;
    mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
    mainWindow.webContents.send('status-update', { isClickThrough });
  });

  // 4. CLEAR MEMORY: Ctrl+Shift+R
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    conversationHistory = [];
    if (mainWindow) {
      mainWindow.webContents.send('history-cleared');
    }
  });
}

// ── Wire Streaming LLM & STT to IPC ──
function setupIPCHandlers() {
  ipcMain.handle('paste-text', () => clipboard.readText());
  // Manual question submission. Audio transcription is only a draft until the user sends it.
  ipcMain.handle('ask-llm', async (_event, questionText) => {
    if (!questionText || !questionText.trim()) return;

    const trimmed = questionText.trim();
    conversationHistory.push({ speaker: 'interviewer', text: trimmed, timestamp: Date.now() });

    const systemPrompt = roleEngine.generateSystemPrompt();

    try {
      mainWindow.webContents.send('llm-start', { question: trimmed });

      const fullResponse = await llmService.streamResponse(
        trimmed,
        systemPrompt,
        conversationHistory
      );

      conversationHistory.push({ speaker: 'candidate', text: fullResponse, timestamp: Date.now() });
      return { success: true };
    } catch (error) {
      mainWindow.webContents.send('llm-error', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // Discrete Audio Chunk Ingestion (Direct from renderer Web Audio VAD)
  ipcMain.handle('process-audio-chunk', async (_event, arrayBuffer) => {
    if (!arrayBuffer) return { success: false, error: 'Empty audio' };
    const buffer = Buffer.from(arrayBuffer);

    try {
      const transcribedText = await sttService.transcribeWavInMemory(buffer);
      if (transcribedText && transcribedText.trim().length > 3) {
        const cleanQuestion = transcribedText.trim();
        console.log(`[STT] Interviewer Question Detected: "${cleanQuestion}"`);
        return { success: true, text: cleanQuestion };
      }
      return { success: true, filtered: true };
    } catch (error) {
      console.error('[Audio Pipeline Error]:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('llm-error', { error: error.message });
      }
      return { success: false, error: error.message };
    }
  });

  // Abort active stream
  ipcMain.handle('study-image-question', async (_event, payload = {}) => {
    const image = payload.image;
    if (typeof image !== 'string' || (image && !/^data:image\/(jpeg|png|webp);base64,/i.test(image)) || image.length > 4_000_000) {
      throw new Error('Choose a JPEG, PNG, or WebP image under 3 MB.');
    }
    const question = typeof payload.question === 'string' ? payload.question.slice(0, 4000) : '';
    if (!image && !question.trim()) throw new Error('Add an image or type a study question.');
    const subject = typeof payload.subject === 'string' ? payload.subject.slice(0, 80) : 'General';
    return llmService.studyImageQuestion({ image, question, subject });
  });

  // Abort active stream
  ipcMain.handle('abort-llm', () => {
    llmService.abort();
    return true;
  });

  // Relay LLM streaming events to UI
  llmService.on('token', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llm-token', data);
    }
  });

  llmService.on('done', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llm-done', data);
    }
  });

  llmService.on('first-token', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llm-first-token', data);
    }
  });

  // Final speech transcripts become editable drafts. The send button starts generation.
  sttService.on('transcript', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcript-received', data);
    }
  });

  sttService.on('interim', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('interim-transcript', data);
    }
  });

  // Role Management IPC
  ipcMain.handle('get-role', () => roleEngine.getRole());
  ipcMain.handle('set-role', (_event, roleData) => {
    roleEngine.setCustomRole(roleData);
    return roleEngine.getRole();
  });
  ipcMain.handle('set-preset', (_event, presetId) => {
    roleEngine.setPreset(presetId);
    return roleEngine.getRole();
  });

  // Window and Click-through controls
  ipcMain.handle('set-click-through', (_event, ignore) => {
    isClickThrough = Boolean(ignore);
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
    }
    return isClickThrough;
  });

  ipcMain.handle('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('close-window', () => {
    if (mainWindow) mainWindow.close();
  });
}

// ── App Lifecycle ──
app.whenReady().then(() => {
  setupIPCHandlers();
  createStealthWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createStealthWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  sttService.close();
  llmService.abort();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

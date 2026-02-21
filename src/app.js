/* ═══════════════════════════════════════════════════════════════════
   APEX IDE — Main Application Logic
   Built from spec: "Desktop IDE" JSON configuration
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── State ──────────────────────────────────────────────────────── */
const ApexState = {
  userHandle: 'User',
  mode: 'rookie',           // 'rookie' | 'expert'
  activePanel: 'explorer',
  openTabs: ['welcome'],
  activeTab: 'welcome',
  fileTree: [],
  terminalHistory: [],
  terminalHistoryIdx: -1,
  terminalLines: [],        // per-tab terminal buffers
  activeTerminal: 0,
  bottomTab: 'terminal',
  vibeScores: { confidence: 82, intent: 71 },
  commandList: [],
  monacoEditor: null,
  providers: {
    openai:    { name: 'OpenAI GPT-4o',      status: 'online',   latency: 124 },
    claude:    { name: 'Claude 3.5 Sonnet',  status: 'online',   latency: 89  },
    deepseek:  { name: 'DeepSeek Coder',     status: 'degraded', latency: 412 },
    ollama:    { name: 'Ollama (Local)',      status: 'offline',  latency: null },
  },
  keys: { openai: '', anthropic: '', deepseek: '', ollama: 'http://localhost:11434' },
  projectName: '',
  projectType: 'general',
};

/* ─── Sample File Tree ───────────────────────────────────────────── */
const SAMPLE_TREE = [
  { name: 'src', type: 'folder', depth: 0, open: true, children: [
    { name: 'app.js',    type: 'file', depth: 1, lang: 'javascript' },
    { name: 'router.js', type: 'file', depth: 1, lang: 'javascript' },
    { name: 'styles.css',type: 'file', depth: 1, lang: 'css' },
  ]},
  { name: 'public', type: 'folder', depth: 0, open: false, children: [
    { name: 'index.html',type: 'file', depth: 1, lang: 'html' },
  ]},
  { name: '.gitignore', type: 'file', depth: 0, lang: 'text' },
  { name: 'package.json', type: 'file', depth: 0, lang: 'json' },
  { name: 'README.md',   type: 'file', depth: 0, lang: 'markdown' },
];

/* ─── Command Palette Commands ───────────────────────────────────── */
const COMMANDS = [
  { icon: '📄', label: 'New File',               shortcut: 'Ctrl+N',        fn: () => newFile()             },
  { icon: '📁', label: 'Open Folder',             shortcut: 'Ctrl+K Ctrl+O', fn: () => openFolder()          },
  { icon: '🔗', label: 'Clone Repository',        shortcut: '',              fn: () => cloneRepo()           },
  { icon: '💾', label: 'Save File',               shortcut: 'Ctrl+S',        fn: () => saveFile()            },
  { icon: '⌨️', label: 'Toggle Vim Mode',          shortcut: '',              fn: () => toggleVimModeCmd()    },
  { icon: '⊞',  label: 'Split Editor',            shortcut: 'Ctrl+\\',       fn: () => splitEditor()         },
  { icon: '🔍', label: 'Find in Files',            shortcut: 'Ctrl+Shift+F',  fn: () => switchActivity('search') },
  { icon: '✅', label: 'Git: Commit',             shortcut: '',              fn: () => gitCommit()           },
  { icon: '↓',  label: 'Git: Pull',               shortcut: '',              fn: () => gitPull()             },
  { icon: '↑',  label: 'Git: Push',               shortcut: '',              fn: () => gitPush()             },
  { icon: '🧠', label: 'LLM Router Panel',         shortcut: '',              fn: () => switchActivity('llm-router') },
  { icon: '⚡', label: 'IDE Bridge Hub',            shortcut: '',              fn: () => switchActivity('ide-bridge') },
  { icon: '🎯', label: 'Toggle Vibe Layer',        shortcut: '',              fn: () => togglePanel('vibe-layer')    },
  { icon: '💰', label: 'Toggle Monetization Panel',shortcut: '',              fn: () => togglePanel('monetization')  },
  { icon: '🎛️', label: 'Domain Adapters',          shortcut: '',              fn: () => switchActivity('domains')    },
  { icon: '⚙️', label: 'Settings',                 shortcut: 'Ctrl+,',        fn: () => switchActivity('settings')   },
  { icon: '🥊', label: 'Switch to Rookie Mode',   shortcut: '',              fn: () => setVibeMode('rookie') },
  { icon: '🔥', label: 'Switch to Expert Mode',   shortcut: '',              fn: () => setVibeMode('expert') },
  { icon: '🚀', label: 'Start Megacode Session',  shortcut: '',              fn: () => startMegacode()       },
  { icon: '🔄', label: 'Restart IDE',             shortcut: '',              fn: () => location.reload()     },
];

/* ─── File Icons ─────────────────────────────────────────────────── */
const FILE_ICONS = {
  js: '🟨', ts: '🟦', jsx: '🟨', tsx: '🟦',
  css: '🎨', scss: '🎨', html: '🌐', json: '📋',
  md: '📝', py: '🐍', go: '🔵', rs: '🦀',
  sh: '💻', txt: '📄', gitignore: '🚫',
  default: '📄',
};

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

/* ═══════════════ ONBOARDING ═════════════════════════════════════════ */
let _currentStep = 1;

function nextStep(n) {
  document.getElementById(`step-${_currentStep}`).classList.remove('active');
  document.querySelectorAll('.dot')[_currentStep - 1].classList.remove('active');
  _currentStep = n;
  document.getElementById(`step-${n}`).classList.add('active');
  document.querySelectorAll('.dot')[n - 1].classList.add('active');
}

function selectMode(mode, btn) {
  document.querySelectorAll('.onboarding-modal .mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ApexState.mode = mode;
}

function finishOnboarding() {
  ApexState.userHandle = document.getElementById('user-handle').value || 'User';
  ApexState.keys.openai    = document.getElementById('key-openai').value;
  ApexState.keys.anthropic = document.getElementById('key-anthropic').value;
  ApexState.keys.deepseek  = document.getElementById('key-deepseek').value;
  ApexState.keys.ollama    = document.getElementById('key-ollama').value;
  ApexState.projectName    = document.getElementById('project-name').value;
  ApexState.projectType    = document.getElementById('project-type').value;

  // Save to localStorage
  localStorage.setItem('apex_onboarded', '1');
  localStorage.setItem('apex_state', JSON.stringify({
    userHandle: ApexState.userHandle,
    mode: ApexState.mode,
    projectName: ApexState.projectName,
    projectType: ApexState.projectType,
    ollama: ApexState.keys.ollama,
  }));

  document.getElementById('onboarding-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-badge').textContent = `👤 ${ApexState.userHandle}`;
  updateModeIndicator();
  initApp();
}

/* ═══════════════ APP INIT ═══════════════════════════════════════════ */
function initApp() {
  renderFileTree();
  initTokenChart();
  initTerminal();
  initVibeScoreUpdater();
  initAudioVisualizer();
  applyProjectTheme();
  loadMonaco();

  // Apply domain adapter based on project type
  if (ApexState.projectType !== 'general') {
    const domMap = { music: 'music', biotech: 'biotech', 'graphic-novel': 'gfx' };
    const d = domMap[ApexState.projectType];
    if (d) {
      switchActivity('domains');
      switchDomain(d, document.querySelector(`.domain-tab[onclick*="${d}"]`));
    }
  }

  log('[INFO] APEX IDE initialized');
  log('[INFO] Monaco editor loading…');
  log(`[INFO] Mode: ${ApexState.mode.toUpperCase()}`);
  log(`[INFO] Project: ${ApexState.projectName || '(unnamed)'}`);
}

/* ─── Load Monaco ─────────────────────────────────────────────────── */
function loadMonaco() {
  if (typeof require === 'undefined') {
    log('[WARN] Monaco loader unavailable (offline). Editor running in light mode.');
    return;
  }
  require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
  require(['vs/editor/editor.main'], function (monaco) {
    // Define APEX hip-hop dark theme
    monaco.editor.defineTheme('apex-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment',   foreground: '555566', fontStyle: 'italic' },
        { token: 'keyword',   foreground: 'ff2d78', fontStyle: 'bold'   },
        { token: 'string',    foreground: '39ff14' },
        { token: 'number',    foreground: 'f5c518' },
        { token: 'type',      foreground: '00e5ff' },
        { token: 'function',  foreground: '9b59ff' },
      ],
      colors: {
        'editor.background':          '#0d0d0f',
        'editor.foreground':          '#f0f0f5',
        'editor.lineHighlightBackground': '#1c1c22',
        'editorCursor.foreground':    '#f5c518',
        'editor.selectionBackground': '#2a1850',
        'editorLineNumber.foreground':'#44445a',
        'editorLineNumber.activeForeground': '#9b59ff',
      },
    });

    ApexState.monacoEditor = monaco.editor.create(
      document.getElementById('monaco-container'),
      {
        value: '// Welcome to APEX IDE — Megacode Edition\n// Open a file from the Explorer or start typing below\n\n',
        language: 'javascript',
        theme: 'apex-dark',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontLigatures: true,
        minimap: { enabled: true },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        cursorBlinking: 'phase',
        smoothScrolling: true,
        padding: { top: 16 },
        lineNumbers: 'on',
        glyphMargin: true,
        folding: true,
      }
    );

    log('[INFO] Monaco editor loaded ✓');
  });
}

/* ─── File Tree ───────────────────────────────────────────────────── */
function renderFileTree(tree = SAMPLE_TREE) {
  const el = document.getElementById('file-tree');
  el.innerHTML = '';

  function renderNode(node, depth = 0) {
    const item = document.createElement('div');
    item.className = 'file-item folder-item';
    item.style.setProperty('--depth', depth);

    if (node.type === 'folder') {
      item.innerHTML = `
        <span class="file-icon">${node.open ? '📂' : '📁'}</span>
        <span class="file-name">${node.name}</span>
      `;
      item.onclick = () => {
        node.open = !node.open;
        renderFileTree(tree);
      };
      el.appendChild(item);
      if (node.open && node.children) {
        node.children.forEach(c => renderNode(c, depth + 1));
      }
    } else {
      item.innerHTML = `
        <span class="file-icon">${getFileIcon(node.name)}</span>
        <span class="file-name">${node.name}</span>
      `;
      item.onclick = () => openFileTab(node);
      el.appendChild(item);
    }
  }

  tree.forEach(n => renderNode(n));
}

function openFileTab(node) {
  const id = `file-${node.name.replace(/[^a-z0-9]/gi, '-')}`;
  if (!ApexState.openTabs.includes(id)) {
    ApexState.openTabs.push(id);
    addTabUI(id, node.name, getFileIcon(node.name));
  }
  activateTab(id);
  // Show Monaco pane with correct language
  showMonacoPaneFor(node);
}

function addTabUI(id, name, icon) {
  const tabs = document.getElementById('editor-tabs');
  const addBtn = tabs.querySelector('.tab-add');
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.file = id;
  tab.onclick = () => activateTab(id);
  tab.innerHTML = `
    <span class="tab-icon">${icon}</span>
    <span class="tab-name">${name}</span>
    <button class="tab-close" onclick="closeTab(event,'${id}')">×</button>
  `;
  tabs.insertBefore(tab, addBtn);
}

function activateTab(id) {
  ApexState.activeTab = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === id));

  // Show correct pane
  if (id === 'welcome') {
    showPane('welcome');
  } else {
    showPane('editor');
  }
  document.getElementById('status-file').textContent = id.replace('file-', '').replace(/-/g, '.');
}

function showPane(name) {
  document.querySelectorAll('.editor-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`pane-${name}`).classList.add('active');
}

function showMonacoPaneFor(node) {
  showPane('editor');
  if (ApexState.monacoEditor && typeof monaco !== 'undefined') {
    const langMap = { js: 'javascript', ts: 'typescript', css: 'css', html: 'html', json: 'json', md: 'markdown', py: 'python', go: 'go' };
    const ext = node.name.split('.').pop().toLowerCase();
    const lang = langMap[ext] || 'plaintext';
    const model = monaco.editor.createModel(`// ${node.name}\n`, lang);
    ApexState.monacoEditor.setModel(model);
    document.getElementById('status-lang').textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
  }
}

function closeTab(e, id) {
  e.stopPropagation();
  const idx = ApexState.openTabs.indexOf(id);
  if (idx > -1) ApexState.openTabs.splice(idx, 1);
  const tab = document.querySelector(`.tab[data-file="${id}"]`);
  if (tab) tab.remove();
  // Activate previous tab
  const remaining = ApexState.openTabs;
  if (remaining.length > 0) {
    activateTab(remaining[remaining.length - 1]);
  }
}

/* ─── Activity Bar ────────────────────────────────────────────────── */
function switchActivity(name, btn) {
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.activity-btn[data-panel="${name}"]`)?.classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');

  ApexState.activePanel = name;
}

/* ─── Right Panels ────────────────────────────────────────────────── */
function togglePanel(name) {
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.toggle('hidden');
}

/* ─── Git Actions ─────────────────────────────────────────────────── */
function gitCommit() {
  const msg = document.querySelector('.commit-input')?.value;
  if (!msg) { termPrint('warn', 'Please enter a commit message.'); return; }
  termPrint('output', `[git] Committing: "${msg}"`);
  termPrint('output', '[git] ✓ Created commit abc1234');
}

function gitPull() { termPrint('output', '[git] Pulling from origin/main…\n[git] Already up to date.'); }
function gitPush() { termPrint('output', '[git] Pushing to origin/main…\n[git] ✓ Successfully pushed.'); }
function gitBranch() {
  const name = prompt('New branch name:');
  if (name) termPrint('output', `[git] Created branch: ${name}`);
}

/* ─── Bottom Panel ────────────────────────────────────────────────── */
function switchBottomTab(name, btn) {
  document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.bottom-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`pane-${name}`).classList.add('active');
  ApexState.bottomTab = name;
}

function toggleBottomPanel() {
  const bp = document.getElementById('bottom-panel');
  bp.style.display = bp.style.display === 'none' ? '' : 'none';
}

function addTerminalTab() { termPrint('output', '[Terminal] New tab created'); }
function splitTerminal() { termPrint('output', '[Terminal] Split view activated'); }

function switchTerminal(idx, btn) {
  document.querySelectorAll('.term-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ApexState.activeTerminal = idx;
  const prompt = document.getElementById('terminal-prompt');
  if (idx === 2) prompt.textContent = 'megacode@apex:~$';
  else prompt.textContent = `apex@megacode:~$`;
}

/* ─── Terminal ────────────────────────────────────────────────────── */
function initTerminal() {
  termPrint('output', '  ___  ____  ____ _  _   ___ ____  ____ ');
  termPrint('output', ' / _ \\|  _ \\| ___| || | |_ _|  _ \\| ___|');
  termPrint('output', '| | | | |_) |  _| | || |_ | || | | |  _| ');
  termPrint('output', '| |_| |  __/| |___|__   _|| || |_| | |___ ');
  termPrint('output', ' \\___/|_|   |_____|  |_||___|____/|_____|');
  termPrint('output', '');
  termPrint('output', 'APEX IDE — Megacode Edition  v1.0.0');
  termPrint('output', 'Type "help" for available commands.\n');
}

function termPrint(type, text) {
  const out = document.getElementById('terminal-output');
  const div = document.createElement('div');
  div.className = `terminal-line ${type}`;
  div.textContent = text;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function handleTerminalKey(e) {
  const input = e.target;
  if (e.key === 'Enter') {
    const cmd = input.value.trim();
    if (cmd) {
      ApexState.terminalHistory.unshift(cmd);
      ApexState.terminalHistoryIdx = -1;
      termPrint('cmd', `${document.getElementById('terminal-prompt').textContent} ${cmd}`);
      processCommand(cmd);
      input.value = '';
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (ApexState.terminalHistoryIdx < ApexState.terminalHistory.length - 1) {
      ApexState.terminalHistoryIdx++;
      input.value = ApexState.terminalHistory[ApexState.terminalHistoryIdx];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (ApexState.terminalHistoryIdx > 0) {
      ApexState.terminalHistoryIdx--;
      input.value = ApexState.terminalHistory[ApexState.terminalHistoryIdx];
    } else {
      ApexState.terminalHistoryIdx = -1;
      input.value = '';
    }
  } else if (e.key === 'l' && e.ctrlKey) {
    document.getElementById('terminal-output').innerHTML = '';
  }
}

const CMD_HANDLERS = {
  help: () => {
    termPrint('output', 'Available commands:');
    termPrint('output', '  help          — Show this help');
    termPrint('output', '  ls            — List files');
    termPrint('output', '  git status    — Show git status');
    termPrint('output', '  git pull/push — Git operations');
    termPrint('output', '  npm run start — Start dev server');
    termPrint('output', '  megacode      — Start Megacode session');
    termPrint('output', '  ollama        — Interact with Ollama');
    termPrint('output', '  clear         — Clear terminal');
  },
  clear: () => { document.getElementById('terminal-output').innerHTML = ''; },
  ls: () => {
    SAMPLE_TREE.forEach(n => termPrint('output', `${n.type === 'folder' ? 'd' : '-'}  ${n.name}`));
  },
  'git status': () => {
    termPrint('output', 'On branch main\nChanges not staged for commit:\n  modified:   src/app.js\n  added:      src/new-feature.js');
  },
  'git pull': () => termPrint('output', 'Already up to date.'),
  'git push': () => termPrint('output', 'Enumerating objects... done.\nTo origin/main\n   abc1234..def5678  main -> main'),
  'npm run start': () => {
    termPrint('output', '> apex-ide@1.0.0 start\n> npx serve . -p 3000\n');
    termPrint('output', '  Serving!  Local: http://localhost:3000');
  },
  megacode: () => {
    termPrint('output', '⬡ MEGACODE SESSION STARTING…');
    termPrint('output', '  Connecting to LLM Router…');
    setTimeout(() => termPrint('output', '  ✓ Connected to OpenAI GPT-4o'), 600);
    setTimeout(() => termPrint('output', '  ✓ WebSocket bridge active on :9742'), 1200);
    setTimeout(() => termPrint('output', '  Ready. Type your prompt or code task.'), 1800);
  },
  ollama: () => termPrint('output', 'Ollama endpoint: http://localhost:11434\nStatus: Offline — start Ollama and try again.'),
  pwd: () => termPrint('output', '/home/apex/projects'),
  echo: (args) => termPrint('output', args.join(' ')),
  whoami: () => termPrint('output', ApexState.userHandle),
};

function processCommand(raw) {
  const parts = raw.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const full = raw.toLowerCase();

  if (CMD_HANDLERS[full]) { CMD_HANDLERS[full](args); return; }
  if (CMD_HANDLERS[cmd])  { CMD_HANDLERS[cmd](args);  return; }

  termPrint('error', `command not found: ${cmd}`);
}

/* ─── Vibe Layer ──────────────────────────────────────────────────── */
function initVibeScoreUpdater() {
  setInterval(() => {
    // Slightly drift scores to look live
    const drift = (v, range = 5) => Math.max(0, Math.min(100, v + (Math.random() - 0.5) * range));
    ApexState.vibeScores.confidence = drift(ApexState.vibeScores.confidence);
    ApexState.vibeScores.intent     = drift(ApexState.vibeScores.intent);

    const cPct = Math.round(ApexState.vibeScores.confidence);
    const iPct = Math.round(ApexState.vibeScores.intent);
    const cb = document.getElementById('confidence-bar');
    const ib = document.getElementById('intent-bar');
    const cv = document.getElementById('confidence-val');
    const iv = document.getElementById('intent-val');
    if (cb) { cb.style.width = cPct + '%'; cv.textContent = cPct + '%'; }
    if (ib) { ib.style.width = iPct + '%'; iv.textContent = iPct + '%'; }
  }, 3000);
}

function applyFix(btn) {
  const item = btn.closest('.fix-item');
  item.style.opacity = '0';
  item.style.transition = 'opacity .3s';
  setTimeout(() => item.remove(), 300);
  termPrint('output', '[Vibe] Fix applied ✓');
}

function undoAction() { termPrint('output', '[Editor] Undo'); }
function redoAction() { termPrint('output', '[Editor] Redo'); }

function setVibeMode(mode) {
  ApexState.mode = mode;
  // Sidebar vibe panel
  document.getElementById('vibe-rookie')?.classList.toggle('active', mode === 'rookie');
  document.getElementById('vibe-expert')?.classList.toggle('active', mode === 'expert');
  updateModeIndicator();
  termPrint('output', `[Vibe] Mode switched to: ${mode.toUpperCase()}`);
}

function toggleExpertMode() {
  const next = ApexState.mode === 'expert' ? 'rookie' : 'expert';
  setVibeMode(next);
}

function updateModeIndicator() {
  const ind = document.getElementById('mode-indicator');
  if (!ind) return;
  ind.textContent = ApexState.mode === 'expert' ? '🔥 Expert' : '🥊 Rookie';
}

/* ─── Token Chart ─────────────────────────────────────────────────── */
function initTokenChart() {
  const chart = document.getElementById('token-chart');
  if (!chart) return;
  chart.innerHTML = '';
  const heights = [20, 35, 28, 45, 38, 50, 42, 55, 47, 60, 52, 48, 44, 38, 42];
  heights.forEach(h => {
    const bar = document.createElement('div');
    bar.className = 'token-bar';
    bar.style.height = `${h}px`;
    chart.appendChild(bar);
  });
}

/* ─── Audio Visualizer ────────────────────────────────────────────── */
function initAudioVisualizer() {
  const canvas = document.getElementById('audio-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bars = 32;
    const w = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const h = (Math.sin(i * 0.4 + frame * 0.05) * 0.5 + 0.5) * 50;
      const hue = (i / bars) * 180 + 180;
      ctx.fillStyle = `hsl(${hue},100%,60%)`;
      ctx.fillRect(i * w + 1, canvas.height - h, w - 2, h);
    }
    frame++;
    requestAnimationFrame(draw);
  }
  draw();
}

/* ─── Domain Adapters ─────────────────────────────────────────────── */
function switchDomain(name, btn) {
  document.querySelectorAll('.domain-tab').forEach(b => b?.classList.remove('active'));
  btn?.classList.add('active');
  document.querySelectorAll('.domain-content').forEach(d => d.classList.remove('active'));
  document.getElementById(`domain-${name}`)?.classList.add('active');
}

function runTool(tool) {
  const msgs = {
    'daw-scaffold': '[Music] DAW Plugin Scaffolder → Generating JUCE/WebAudio boilerplate…',
    'audio-preview': '[Music] Audio Preview → Starting WebAudio context…',
    'beat-runner':   '[Music] Beat Runner → Sending prompt to Ollama DeepSeek…',
    'smiles':        '[Biotech] SMILES Visualizer → Enter compound in terminal: smiles <formula>',
    'histotripsy':   '[Biotech] Histotripsy Sim → Loading acoustic model…',
    'mutracker':     '[Biotech] MuTracker → Scanning mutation database…',
    'nft-mint':      '[GFX] NFT Mint Preview → Connect wallet to continue…',
    'panel-editor':  '[GFX] Panel Layout Editor → Launching visual panel tool…',
    'gemini-vision': '[GFX] Gemini Vision → Upload storyboard image…',
  };
  const msg = msgs[tool] || `[Tool] Running: ${tool}`;
  termPrint('output', msg);
  // Open terminal tab to show output
  switchBottomTab('terminal', document.querySelector('.bottom-tab'));
  document.querySelector('.bottom-tab').classList.add('active');
}

/* ─── Bridges ─────────────────────────────────────────────────────── */
function toggleBridge(name, btn) {
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  btn.classList.toggle('off', isOn);
  btn.textContent = isOn ? 'OFF' : 'ON';
  btn.closest('.bridge-card').classList.toggle('active', !isOn);
  const action = isOn ? 'disconnected' : 'connected';
  termPrint('output', `[Bridge] ${name} ${action}`);
}

function startOllama() {
  termPrint('output', '[Ollama] Attempting to start local Ollama service…');
  termPrint('output', '[Ollama] Run: ollama serve  in your system terminal');
}

/* ─── Megacode Session ────────────────────────────────────────────── */
function startMegacode() {
  // Focus terminal and run megacode command
  switchBottomTab('terminal', document.querySelector('.bottom-tab'));
  document.querySelector('.bottom-tab').classList.add('active');
  processCommand('megacode');
}

/* ─── File Actions ────────────────────────────────────────────────── */
function newFile() {
  const name = prompt('New file name:');
  if (!name) return;
  const node = { name, type: 'file', depth: 0, lang: 'javascript' };
  SAMPLE_TREE.push(node);
  renderFileTree();
  openFileTab(node);
}

function openFolder() { termPrint('output', '[Explorer] Open Folder — use native file picker in Electron mode'); }
function cloneRepo() {
  const url = prompt('Repository URL:');
  if (url) termPrint('output', `[Git] Cloning ${url}…`);
}

function newFolder() {
  const name = prompt('New folder name:');
  if (!name) return;
  SAMPLE_TREE.push({ name, type: 'folder', depth: 0, open: true, children: [] });
  renderFileTree();
}

function refreshExplorer() { renderFileTree(); termPrint('output', '[Explorer] Refreshed'); }
function saveFile() { termPrint('output', '[Editor] File saved'); }

/* ─── Search ──────────────────────────────────────────────────────── */
function runSearch(query) {
  const results = document.getElementById('search-results');
  if (!query) { results.innerHTML = '<p class="empty-state">Type to search…</p>'; return; }
  // Simulate search results
  const files = ['src/app.js', 'src/router.js', 'src/styles.css', 'package.json'];
  const matches = files.filter(() => Math.random() > 0.4);
  if (matches.length === 0) { results.innerHTML = '<p class="empty-state">No results found</p>'; return; }
  results.innerHTML = matches.map(f => `
    <div class="file-item" onclick="termPrint('output','[Search] Opening ${f}')">
      <span>${getFileIcon(f)}</span>
      <span>${f}</span>
    </div>
  `).join('');
}

/* ─── Settings ────────────────────────────────────────────────────── */
function changeTheme(theme) { termPrint('output', `[Settings] Theme: ${theme}`); }
function changeFontSize(size) {
  if (ApexState.monacoEditor) ApexState.monacoEditor.updateOptions({ fontSize: parseInt(size) });
}
function toggleVimMode(on) { termPrint('output', `[Settings] Vim mode: ${on ? 'ON' : 'OFF'}`); }
function toggleVimModeCmd() {
  const cb = document.getElementById('vim-mode');
  if (cb) { cb.checked = !cb.checked; toggleVimMode(cb.checked); }
}

/* ─── Project Theme ───────────────────────────────────────────────── */
function applyProjectTheme() {
  const themes = {
    music:          { accent: '#ff2d78' },
    biotech:        { accent: '#39ff14' },
    'graphic-novel':{ accent: '#9b59ff' },
    general:        { accent: '#f5c518' },
  };
  const t = themes[ApexState.projectType] || themes.general;
  document.documentElement.style.setProperty('--accent-gold', t.accent);
}

/* ─── Monetization ────────────────────────────────────────────────── */
function scheduleNFTDrop() {
  const name = document.querySelector('.nft-input').value;
  if (!name) return;
  const item = document.createElement('div');
  item.className = 'drop-item';
  item.innerHTML = `<span class="drop-name">${name}</span><span class="drop-status pending">Scheduled</span>`;
  document.getElementById('scheduled-drops').appendChild(item);
  termPrint('output', `[Monetization] NFT drop scheduled: ${name}`);
}

/* ─── Output Log ──────────────────────────────────────────────────── */
function log(msg) {
  const out = document.getElementById('output-log');
  if (!out) return;
  const type = msg.includes('[WARN]') ? 'warn' : msg.includes('[ERROR]') ? 'error' : 'info';
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.textContent = msg;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

/* ─── Menu Bar ────────────────────────────────────────────────────── */
function openMenu(name) {
  // Minimal menu handler — shows in terminal
  const menus = {
    file:     'File: New File (Ctrl+N) | Open… | Save (Ctrl+S) | Close',
    edit:     'Edit: Undo (Ctrl+Z) | Redo | Cut | Copy | Paste | Find (Ctrl+F)',
    view:     'View: Toggle Sidebar (Ctrl+B) | Terminal (Ctrl+`) | Explorer',
    run:      'Run: Start Debugging (F5) | Run Without Debug | Stop',
    megacode: 'Megacode: Start Session | LLM Router | IDE Bridge | Vibe Layer',
  };
  termPrint('output', `[Menu → ${name.charAt(0).toUpperCase() + name.slice(1)}] ${menus[name] || ''}`);
}

/* ─── Command Palette ─────────────────────────────────────────────── */
let _cpSelectedIdx = 0;

function openCommandPalette() {
  document.getElementById('command-palette').classList.remove('hidden');
  const input = document.getElementById('cp-input');
  input.value = '';
  input.focus();
  filterCommands('');
}

function closeCommandPalette() {
  document.getElementById('command-palette').classList.add('hidden');
}

function filterCommands(query) {
  _cpSelectedIdx = 0;
  const results = document.getElementById('cp-results');
  const q = query.toLowerCase();
  const filtered = q ? COMMANDS.filter(c => c.label.toLowerCase().includes(q)) : COMMANDS;

  if (filtered.length === 0) {
    results.innerHTML = '<div class="cp-item"><span style="color:var(--text-muted)">No commands found</span></div>';
    return;
  }

  results.innerHTML = `
    <div class="cp-section-header">${q ? 'MATCHING COMMANDS' : 'ALL COMMANDS'}</div>
    ${filtered.map((c, i) => `
      <div class="cp-item ${i === 0 ? 'selected' : ''}" onclick="runCPCommand(${COMMANDS.indexOf(c)})">
        <span class="cp-item-icon">${c.icon}</span>
        <span class="cp-item-label">${c.label}</span>
        ${c.shortcut ? `<span class="cp-item-shortcut">${c.shortcut}</span>` : ''}
      </div>
    `).join('')}
  `;
}

function runCPCommand(idx) {
  closeCommandPalette();
  COMMANDS[idx]?.fn();
}

function handleCPKey(e) {
  const items = document.querySelectorAll('.cp-item');
  if (e.key === 'Escape') { closeCommandPalette(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[_cpSelectedIdx]?.classList.remove('selected');
    _cpSelectedIdx = Math.min(_cpSelectedIdx + 1, items.length - 1);
    items[_cpSelectedIdx]?.classList.add('selected');
    items[_cpSelectedIdx]?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[_cpSelectedIdx]?.classList.remove('selected');
    _cpSelectedIdx = Math.max(_cpSelectedIdx - 1, 0);
    items[_cpSelectedIdx]?.classList.add('selected');
    items[_cpSelectedIdx]?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') {
    const query = document.getElementById('cp-input').value.toLowerCase();
    const filtered = query ? COMMANDS.filter(c => c.label.toLowerCase().includes(query)) : COMMANDS;
    closeCommandPalette();
    filtered[_cpSelectedIdx]?.fn();
  }
}

function splitEditor() { termPrint('output', '[Editor] Split view — use Ctrl+\\ in Monaco'); }

/* ─── Global Hotkeys ──────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'p') { e.preventDefault(); openCommandPalette(); return; }
  if (ctrl && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').style.display = document.getElementById('sidebar').style.display === 'none' ? '' : 'none'; return; }
  if (ctrl && e.key === '`') { e.preventDefault(); document.getElementById('bottom-panel').style.display = document.getElementById('bottom-panel').style.display === 'none' ? '' : 'none'; document.getElementById('terminal-input')?.focus(); return; }
  if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); switchActivity('explorer'); return; }
  if (ctrl && e.shiftKey && e.key === 'F') { e.preventDefault(); switchActivity('search'); return; }
  if (ctrl && e.shiftKey && e.key === 'G') { e.preventDefault(); switchActivity('git'); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveFile(); return; }
  if (e.key === 'Escape') { closeCommandPalette(); return; }
});

/* ─── Boot ────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Check if already onboarded
  const saved = localStorage.getItem('apex_state');
  if (localStorage.getItem('apex_onboarded') && saved) {
    try {
      const s = JSON.parse(saved);
      // Map persisted fields explicitly instead of blindly merging
      if (s && typeof s === 'object') {
        if (typeof s.userHandle === 'string') {
          ApexState.userHandle = s.userHandle;
        }
        if (typeof s.mode === 'string') {
          ApexState.mode = s.mode;
        }
        if (typeof s.activePanel === 'string') {
          ApexState.activePanel = s.activePanel;
        }
        if (Array.isArray(s.openTabs)) {
          ApexState.openTabs = s.openTabs;
        }
        if (typeof s.activeTab === 'string') {
          ApexState.activeTab = s.activeTab;
        }
        if (Array.isArray(s.fileTree)) {
          ApexState.fileTree = s.fileTree;
        }
        if (Array.isArray(s.terminalHistory)) {
          ApexState.terminalHistory = s.terminalHistory;
        }
        // Restore ollama endpoint: persisted as top-level `ollama`, used as `keys.ollama`
        if (s.ollama != null) {
          if (!ApexState.keys || typeof ApexState.keys !== 'object') {
            ApexState.keys = {};
          }
          ApexState.keys.ollama = s.ollama;
        } else if (s.keys && s.keys.ollama != null) {
          // Also handle case where it was already nested under keys
          if (!ApexState.keys || typeof ApexState.keys !== 'object') {
            ApexState.keys = {};
          }
          ApexState.keys.ollama = s.keys.ollama;
        }
      }
    } catch (_) { /* ignore */ }
    document.getElementById('onboarding-overlay').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-badge').textContent = `👤 ${ApexState.userHandle}`;
    updateModeIndicator();
    initApp();
  }
  // Otherwise show onboarding (default)
});

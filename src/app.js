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
  minimapEnabled: true,
  _codeBlockCounter: 0,
  providers: {
    openai:    { name: 'OpenAI GPT-4o',      status: 'online',   latency: 124 },
    claude:    { name: 'Claude 3.5 Sonnet',  status: 'online',   latency: 89  },
    deepseek:  { name: 'DeepSeek Coder',     status: 'degraded', latency: 412 },
    ollama:    { name: 'Ollama (Local)',      status: 'offline',  latency: null },
  },
  keys: { openai: '', anthropic: '', deepseek: '', ollama: 'http://localhost:11434' },
  projectName: '',
  projectType: 'general',
  // Chat state
  chatHistory: [],          // [{role:'user'|'assistant', content:'…'}]
  chatLoading: false,
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
  // Chat & AI
  { icon: '💬', label: 'Open AI Chat',            shortcut: 'Ctrl+Shift+J',  fn: () => switchActivity('chat') },
  { icon: '📖', label: 'AI: Explain Code',        shortcut: 'Alt+E',         fn: () => aiAction('explain')   },
  { icon: '♻️', label: 'AI: Refactor Code',       shortcut: 'Alt+R',         fn: () => aiAction('refactor')  },
  { icon: '🧪', label: 'AI: Write Tests',         shortcut: 'Alt+T',         fn: () => aiAction('tests')     },
  { icon: '🔧', label: 'AI: Fix Errors',          shortcut: 'Alt+F',         fn: () => aiAction('fix')       },
  { icon: '📝', label: 'AI: Add Documentation',   shortcut: '',              fn: () => aiAction('docs')      },
  { icon: '⚡', label: 'AI: Optimize Code',       shortcut: '',              fn: () => aiAction('optimize')  },
  // Editor utilities
  { icon: '✏️', label: 'Format Document',          shortcut: 'Shift+Alt+F',   fn: () => formatDocument()      },
  { icon: '🔢', label: 'Go to Line',              shortcut: 'Ctrl+G',        fn: () => goToLine()            },
  { icon: '🗺️', label: 'Toggle Minimap',           shortcut: '',              fn: () => toggleMinimap()       },
  { icon: '🗑️', label: 'Clear Chat',              shortcut: '',              fn: () => clearChat()           },
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
    keys: {
      openai: ApexState.keys.openai,
      anthropic: ApexState.keys.anthropic,
      deepseek: ApexState.keys.deepseek,
      ollama: ApexState.keys.ollama,
    },
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
  initChat();
  loadMonaco();

  // Update breadcrumb project name
  const breadcrumbProject = document.getElementById('breadcrumb-project');
  if (breadcrumbProject) breadcrumbProject.textContent = ApexState.projectName || 'Project';

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
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        parameterHints: { enabled: true },
        formatOnPaste: true,
        multiCursorModifier: 'ctrlCmd',
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true },
      }
    );

    // Live cursor position in status bar
    ApexState.monacoEditor.onDidChangeCursorPosition(e => {
      const cursor = document.getElementById('status-cursor');
      if (cursor) cursor.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

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

  const iconEl = document.createElement('span');
  iconEl.className = 'tab-icon';
  iconEl.textContent = icon;

  const nameEl = document.createElement('span');
  nameEl.className = 'tab-name';
  nameEl.textContent = name;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', function (event) {
    closeTab(event, id);
  });

  tab.appendChild(iconEl);
  tab.appendChild(nameEl);
  tab.appendChild(closeBtn);
  tabs.insertBefore(tab, addBtn);
}

function activateTab(id) {
  ApexState.activeTab = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === id));

  // Update breadcrumb
  const fileName = id.replace('file-', '').replace(/-/g, '.');
  const breadcrumbFile = document.getElementById('breadcrumb-file');
  const breadcrumbSep2 = document.getElementById('breadcrumb-sep2');
  if (id !== 'welcome') {
    if (breadcrumbFile) { breadcrumbFile.textContent = fileName; breadcrumbFile.style.display = ''; }
    if (breadcrumbSep2) breadcrumbSep2.style.display = '';
  } else {
    if (breadcrumbFile) breadcrumbFile.style.display = 'none';
    if (breadcrumbSep2) breadcrumbSep2.style.display = 'none';
  }

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
    const oldModel = ApexState.monacoEditor.getModel();
    const model = monaco.editor.createModel(`// ${node.name}\n`, lang);
    ApexState.monacoEditor.setModel(model);
    if (oldModel && oldModel !== model) {
      oldModel.dispose();
    }
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

  // Populate API keys when settings opens
  if (name === 'settings') populateSettingsKeys();
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
  const terminalTabBtn =
    document.querySelector('.bottom-tab[data-tab="terminal"]') ||
    document.querySelector('.bottom-tab');
  switchBottomTab('terminal', terminalTabBtn);
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

function updateApiKey(provider, value) {
  if (provider === 'ollama') {
    ApexState.keys.ollama = value;
  } else {
    ApexState.keys[provider] = value;
  }
  // Persist to localStorage
  const saved = localStorage.getItem('apex_state');
  let state = {};
  try { state = JSON.parse(saved) || {}; } catch (_) {}
  if (!state.keys) state.keys = {};
  state.keys[provider] = value;
  localStorage.setItem('apex_state', JSON.stringify(state));
  termPrint('output', `[Settings] API key updated: ${provider}`);
}

function populateSettingsKeys() {
  const fields = [
    ['settings-key-openai', ApexState.keys.openai],
    ['settings-key-anthropic', ApexState.keys.anthropic],
    ['settings-key-deepseek', ApexState.keys.deepseek],
    ['settings-key-ollama', ApexState.keys.ollama],
  ];
  fields.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });
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
  const nameSpan = document.createElement('span');
  nameSpan.className = 'drop-name';
  nameSpan.textContent = name;
  const statusSpan = document.createElement('span');
  statusSpan.className = 'drop-status pending';
  statusSpan.textContent = 'Scheduled';
  item.appendChild(nameSpan);
  item.appendChild(statusSpan);
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

// Alias used by the welcome tab onclick
function openTab(id) { activateTab(id); }

/* ─── Editor Utilities ────────────────────────────────────────────── */
function formatDocument() {
  if (ApexState.monacoEditor) {
    ApexState.monacoEditor.getAction('editor.action.formatDocument')?.run();
    log('[INFO] Document formatted');
  } else {
    termPrint('warn', '[Editor] Monaco not loaded yet');
  }
}

function goToLine() {
  if (ApexState.monacoEditor) {
    ApexState.monacoEditor.getAction('editor.action.gotoLine')?.run();
  } else {
    const line = prompt('Go to line:');
    if (line && !isNaN(line)) termPrint('output', `[Editor] Go to line ${line}`);
  }
}

function toggleMinimap() {
  if (ApexState.monacoEditor) {
    ApexState.minimapEnabled = !ApexState.minimapEnabled;
    ApexState.monacoEditor.updateOptions({ minimap: { enabled: ApexState.minimapEnabled } });
    // Persist preference
    try {
      const state = JSON.parse(localStorage.getItem('apex_state') || '{}');
      state.minimapEnabled = ApexState.minimapEnabled;
      localStorage.setItem('apex_state', JSON.stringify(state));
    } catch (_) {}
    termPrint('output', `[Editor] Minimap: ${ApexState.minimapEnabled ? 'ON' : 'OFF'}`);
  }
}

function getEditorSelection() {
  if (!ApexState.monacoEditor) return '';
  const selection = ApexState.monacoEditor.getSelection();
  if (!selection || selection.isEmpty()) {
    // Return full file content if nothing selected
    return ApexState.monacoEditor.getValue();
  }
  return ApexState.monacoEditor.getModel()?.getValueInRange(selection) || '';
}

/* ═══════════════ AI CHAT ════════════════════════════════════════════ */

function initChat() {
  const saved = localStorage.getItem('apex_chat_history');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        ApexState.chatHistory = parsed;
        // Restore rendered messages
        parsed.forEach(msg => renderChatBubble(msg.role, msg.content));
      }
    } catch (_) { /* ignore */ }
  }
}

function saveChatHistory() {
  try {
    localStorage.setItem('apex_chat_history', JSON.stringify(ApexState.chatHistory));
  } catch (_) { /* ignore */ }
}

function clearChat() {
  ApexState.chatHistory = [];
  localStorage.removeItem('apex_chat_history');
  const messages = document.getElementById('chat-messages');
  if (messages) {
    messages.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🧠</div>
        <div class="chat-welcome-title">APEX AI</div>
        <div class="chat-welcome-text">Ask about your code. Select text in the editor and use the actions below for context-aware help.</div>
        <div class="chat-quick-actions">
          <button class="chat-quick-btn" onclick="aiAction('explain')">📖 Explain Code</button>
          <button class="chat-quick-btn" onclick="aiAction('refactor')">♻️ Refactor</button>
          <button class="chat-quick-btn" onclick="aiAction('tests')">🧪 Write Tests</button>
          <button class="chat-quick-btn" onclick="aiAction('fix')">🔧 Fix Errors</button>
          <button class="chat-quick-btn" onclick="aiAction('docs')">📝 Add Docs</button>
          <button class="chat-quick-btn" onclick="aiAction('optimize')">⚡ Optimize</button>
        </div>
      </div>`;
  }
  termPrint('output', '[Chat] Conversation cleared');
}

function toggleSystemPrompt() {
  const area = document.getElementById('chat-system-prompt-area');
  if (area) area.classList.toggle('hidden');
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function sendChatMessage(overrideContent) {
  if (ApexState.chatLoading) return;
  const input = document.getElementById('chat-input');
  const content = overrideContent || (input ? input.value.trim() : '');
  if (!content) return;
  if (input && !overrideContent) input.value = '';

  // Switch to chat panel
  switchActivity('chat');

  // Remove welcome screen if present
  const welcome = document.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // Render user message
  renderChatBubble('user', content);
  ApexState.chatHistory.push({ role: 'user', content });

  // Show loading
  const loadingEl = showChatLoading();

  // Call LLM
  const model = document.getElementById('chat-model-select')?.value || 'gpt-4o';
  const systemInput = document.getElementById('chat-system-input');
  const systemPrompt = systemInput ? systemInput.value.trim() : '';

  callLLMAPI(ApexState.chatHistory, model, systemPrompt)
    .then(reply => {
      loadingEl.remove();
      renderChatBubble('assistant', reply);
      ApexState.chatHistory.push({ role: 'assistant', content: reply });
      saveChatHistory();
    })
    .catch(err => {
      loadingEl.remove();
      const errMsg = `Error: ${err.message || 'Could not reach AI provider. Check your API keys in Settings.'}`;
      renderChatBubble('assistant', errMsg);
      ApexState.chatHistory.push({ role: 'assistant', content: errMsg });
      saveChatHistory();
    })
    .finally(() => {
      ApexState.chatLoading = false;
      const sendBtn = document.getElementById('chat-send-btn');
      if (sendBtn) sendBtn.disabled = false;
    });

  ApexState.chatLoading = true;
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;
}

function showChatLoading() {
  const messages = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-loading';
  el.innerHTML = `
    <span>🧠</span>
    <div class="chat-loading-dots"><span></span><span></span><span></span></div>
    <span style="font-size:11px;color:var(--text-muted)">Thinking…</span>`;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function renderChatBubble(role, content) {
  const messages = document.getElementById('chat-messages');
  if (!messages) return;

  // Constrain role to expected values to avoid CSS class injection
  const safeRole = role === 'user' ? 'user' : 'assistant';

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatar = safeRole === 'user' ? '👤' : '🧠';
  const roleLabel = safeRole === 'user' ? 'YOU' : 'APEX AI';

  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${safeRole} fade-in`;

  const header = `
    <div class="chat-msg-header">
      <span class="chat-msg-avatar">${avatar}</span>
      <span class="chat-msg-role ${safeRole}">${roleLabel}</span>
      <span class="chat-msg-time">${time}</span>
    </div>`;

  const formattedContent = formatChatContent(content);
  msgEl.innerHTML = header + `<div class="chat-msg-content">${formattedContent}</div>`;
  messages.appendChild(msgEl);
  messages.scrollTop = messages.scrollHeight;
}

function formatChatContent(text) {
  // Escape HTML first
  const escapeHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Process code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map(part => {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0].trim() || 'code';
      const code = escapeHtml(lines.slice(1).join('\n').trim());
      const blockId = 'cb-' + (++ApexState._codeBlockCounter);
      return `<div class="chat-code-block" id="${blockId}">
        <div class="chat-code-header">
          <span class="chat-code-lang">${escapeHtml(lang)}</span>
          <div class="chat-code-actions">
            <button class="chat-code-btn" onclick="copyChatCode('${blockId}')">Copy</button>
            <button class="chat-code-btn insert" onclick="insertChatCode('${blockId}')">Insert</button>
          </div>
        </div>
        <pre class="chat-code-pre" data-code="${blockId}">${code}</pre>
      </div>`;
    }
    // Inline code
    const escaped = escapeHtml(part)
      .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-code);color:var(--accent-cyan);background:var(--bg-tertiary);padding:1px 4px;border-radius:3px">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return `<p>${escaped}</p>`;
  }).join('');
}

function copyChatCode(blockId) {
  const pre = document.querySelector(`#${blockId} pre`);
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    const btn = document.querySelector(`#${blockId} .chat-code-btn`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = orig; }, 1500); }
  }).catch(() => termPrint('warn', '[Chat] Could not copy to clipboard'));
}

function insertChatCode(blockId) {
  const pre = document.querySelector(`#${blockId} pre`);
  if (!pre) return;
  const code = pre.textContent;
  if (ApexState.monacoEditor) {
    const editor = ApexState.monacoEditor;
    const selection = editor.getSelection();
    const id = { major: 1, minor: 1 };
    const op = { identifier: id, range: selection, text: code, forceMoveMarkers: true };
    editor.executeEdits('chat-insert', [op]);
    showPane('editor');
    editor.focus();
    termPrint('output', '[Chat] Code inserted into editor ✓');
  } else {
    termPrint('warn', '[Chat] Editor not ready — Monaco not loaded');
  }
}

async function callLLMAPI(history, model, systemPrompt) {
  const { openai, anthropic, deepseek, ollama } = ApexState.keys;

  const messages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...history]
    : history;

  // OpenAI models
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
    if (!openai) throw new Error('OpenAI API key not set. Add it in Settings > API Keys.');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openai}` },
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  // Anthropic / Claude models
  if (model.startsWith('claude')) {
    if (!anthropic) throw new Error('Anthropic API key not set. Add it in Settings > API Keys.');
    // Anthropic requires system prompt as separate field
    const body = { model, messages: history, max_tokens: 4096 };
    if (systemPrompt) body.system = systemPrompt;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropic,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
    }
    const data = await res.json();
    const firstContentItem = Array.isArray(data.content) && data.content.length > 0 ? data.content[0] : null;
    if (!firstContentItem || typeof firstContentItem.text !== 'string') {
      throw new Error('Anthropic API returned unexpected response structure');
    }
    return firstContentItem.text;
  }

  // DeepSeek (OpenAI-compatible)
  if (model.startsWith('deepseek')) {
    if (!deepseek) throw new Error('DeepSeek API key not set. Add it in Settings > API Keys.');
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseek}` },
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `DeepSeek API error ${res.status}`);
    }
    const data = await res.json();
    const firstChoice = Array.isArray(data.choices) && data.choices.length > 0 ? data.choices[0] : null;
    const content = firstChoice?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('DeepSeek API returned an unexpected response without choices content.');
    }
    return content;
  }

  // Ollama (local)
  const endpoint = (ollama || 'http://localhost:11434').replace(/\/$/, '');
  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  }).catch((error) => {
    // Preserve original network error information for debugging
    console.error('Ollama fetch failed:', error);
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Ollama not reachable at ${endpoint}. Run: ollama serve. Original error: ${originalMessage}`);
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json();
  return data.message?.content || data.response || '';
}

/* ─── AI Code Actions ─────────────────────────────────────────────── */
const AI_ACTION_PROMPTS = {
  explain:  (code, lang) => `Explain the following ${lang} code clearly and concisely:\n\`\`\`${lang}\n${code}\n\`\`\``,
  refactor: (code, lang) => `Refactor the following ${lang} code for better readability, performance, and maintainability. Explain key changes:\n\`\`\`${lang}\n${code}\n\`\`\``,
  tests:    (code, lang) => `Write comprehensive unit tests for the following ${lang} code using the most common testing framework for that language:\n\`\`\`${lang}\n${code}\n\`\`\``,
  fix:      (code, lang) => `Find and fix all bugs, errors, and issues in the following ${lang} code. Explain each fix:\n\`\`\`${lang}\n${code}\n\`\`\``,
  docs:     (code, lang) => `Add comprehensive JSDoc/docstring documentation to the following ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``,
  optimize: (code, lang) => `Optimize the following ${lang} code for performance and efficiency. Explain the optimizations:\n\`\`\`${lang}\n${code}\n\`\`\``,
};

function aiAction(action) {
  const code = getEditorSelection();
  if (!code.trim()) {
    termPrint('warn', '[AI] No code selected — open a file or select code first');
    return;
  }
  const lang = document.getElementById('status-lang')?.textContent?.toLowerCase() || 'javascript';
  const promptFn = AI_ACTION_PROMPTS[action];
  if (!promptFn) return;
  const prompt = promptFn(code, lang);
  sendChatMessage(prompt);
  log(`[AI] Action: ${action} on ${lang} code (${code.split('\n').length} lines)`);
}

function askAboutCode() {
  const code = getEditorSelection();
  if (!code.trim()) {
    termPrint('warn', '[AI] Select code in the editor first');
    return;
  }
  const lang = document.getElementById('status-lang')?.textContent?.toLowerCase() || 'javascript';
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.value = `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  switchActivity('chat');
  chatInput?.focus();
}

function explainError() {
  const errors = document.querySelectorAll('.problem-item.error .problem-msg');
  if (errors.length === 0) {
    termPrint('warn', '[AI] No errors found in the Problems panel');
    return;
  }
  const errorList = Array.from(errors).map(e => e.textContent).join('\n');
  sendChatMessage(`Explain these errors and how to fix them:\n${errorList}`);
}

/* ─── Global Hotkeys ──────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'p') { e.preventDefault(); openCommandPalette(); return; }
  if (ctrl && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').style.display = document.getElementById('sidebar').style.display === 'none' ? '' : 'none'; return; }
  if (ctrl && e.key === '`') { e.preventDefault(); document.getElementById('bottom-panel').style.display = document.getElementById('bottom-panel').style.display === 'none' ? '' : 'none'; document.getElementById('terminal-input')?.focus(); return; }
  if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); switchActivity('explorer'); return; }
  if (ctrl && e.shiftKey && e.key === 'F') { e.preventDefault(); switchActivity('search'); return; }
  if (ctrl && e.shiftKey && e.key === 'G') { e.preventDefault(); switchActivity('git'); return; }
  if (ctrl && e.shiftKey && e.key === 'J') { e.preventDefault(); switchActivity('chat'); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveFile(); return; }
  if (ctrl && e.key === 'g') { e.preventDefault(); goToLine(); return; }
  if (e.altKey && e.shiftKey && e.key === 'F') { e.preventDefault(); formatDocument(); return; }
  // AI action shortcuts (only when not typing in an input/textarea)
  const tag = document.activeElement?.tagName;
  if (e.altKey && !e.ctrlKey && !e.shiftKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); aiAction('explain'); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); aiAction('refactor'); return; }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); aiAction('tests'); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); aiAction('fix'); return; }
  }
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
        if (typeof s.minimapEnabled === 'boolean') {
          ApexState.minimapEnabled = s.minimapEnabled;
        }
        // Restore all API keys from nested keys object
        if (s.keys && typeof s.keys === 'object') {
          if (!ApexState.keys) ApexState.keys = {};
          ['openai', 'anthropic', 'deepseek', 'ollama'].forEach(k => {
            if (s.keys[k] != null) ApexState.keys[k] = s.keys[k];
          });
        }
        // Restore ollama endpoint: persisted as top-level `ollama`, used as `keys.ollama`
        if (s.ollama != null) {
          if (!ApexState.keys || typeof ApexState.keys !== 'object') {
            ApexState.keys = {};
          }
          ApexState.keys.ollama = s.ollama;
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

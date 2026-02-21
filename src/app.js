/* ═══════════════════════════════════════════════════════════════════
   APEX IDE — Main Application Logic
   Built from spec: "Desktop IDE" JSON configuration
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const APEX_VERSION = '2.0.0';
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function encodeBase64(str) {
  // Prefer browser btoa when available
  if (typeof btoa === 'function') {
    // Ensure UTF-8 safety
    return btoa(unescape(encodeURIComponent(str)));
  }
  // Fallback for Node/Electron environments
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  // Last-resort, deterministic hex encoding
  return Array.from(str)
    .map(function (ch) { return ch.charCodeAt(0).toString(16).padStart(2, '0'); })
    .join('');
}

function getFileId(name) {
  var encoded = encodeBase64(String(name));
  // Make the Base64 string safe for use in IDs/keys
  encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return 'file-' + encoded;
}

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
  fileBuffers: {},           // { 'file-id': 'content…' } — per-file content storage
  providers: {
    openai:    { name: 'OpenAI GPT-4o',      status: 'online',   latency: 124 },
    claude:    { name: 'Claude 3.5 Sonnet',  status: 'online',   latency: 89  },
    deepseek:  { name: 'DeepSeek Coder',     status: 'degraded', latency: 412 },
    ollama:    { name: 'Ollama (Local)',      status: 'offline',  latency: null },
  },
  keys: { openai: '', anthropic: '', deepseek: '', ollama: 'http://localhost:11434' },
  projectName: '',
  projectType: 'general',
  mcpServers: [
    { id: 1, name: 'Filesystem', cmd: 'npx @modelcontextprotocol/server-filesystem', connected: true,  folderPath: '' },
    { id: 2, name: 'GitHub',     cmd: 'npx @modelcontextprotocol/server-github',     connected: false, folderPath: '' },
  ],
  cliInstances: [],
  uploadedComponents: [],
  _nextId: 3,
  cliHistory: [],
  cliHistoryIdx: -1,
  // Chat state
  chatHistory: [],          // [{role:'user'|'assistant', content:'…'}]
  chatLoading: false,
  // Logic Mode state
  logicPlan: [],            // [{id, text, status:'pending'|'active'|'done'|'skipped'}]
  logicPlanNextId: 1,
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
  { icon: '💻', label: 'Open CLI Runner',          shortcut: 'Ctrl+Shift+C',  fn: () => switchActivity('cli') },
  { icon: '🔌', label: 'Open MCP Servers',         shortcut: 'Ctrl+Shift+M',  fn: () => switchActivity('mcp') },
  { icon: '🖥️', label: 'Open Frontend Visualizer', shortcut: 'Ctrl+Alt+V',  fn: () => openVisualizerTab()   },
  { icon: '🔄', label: 'Restart IDE',             shortcut: '',              fn: () => location.reload()     },
  // Chat & AI
  { icon: '💬', label: 'Open AI Chat',            shortcut: 'Ctrl+Shift+J',  fn: () => switchActivity('chat') },
  { icon: '📖', label: 'AI: Explain Code',        shortcut: 'Alt+E',         fn: () => aiAction('explain')   },
  { icon: '♻️', label: 'AI: Refactor Code',       shortcut: 'Alt+R',         fn: () => aiAction('refactor')  },
  { icon: '🧪', label: 'AI: Write Tests',         shortcut: 'Alt+T',         fn: () => aiAction('tests')     },
  { icon: '🔧', label: 'AI: Fix Errors',          shortcut: 'Alt+F',         fn: () => aiAction('fix')       },
  { icon: '📝', label: 'AI: Add Documentation',   shortcut: '',              fn: () => aiAction('docs')      },
  { icon: '⚡', label: 'AI: Optimize Code',       shortcut: '',              fn: () => aiAction('optimize')  },
  { icon: '🟣', label: 'Inspired: Cursor Composer Flow', shortcut: '',       fn: () => runInspiredFeature('cursor-composer') },
  { icon: '🧲', label: 'Inspired: Antigravity Context Orbit', shortcut: '',  fn: () => runInspiredFeature('antigravity-orbit') },
  { icon: '💙', label: 'Inspired: VSCode Command Brain', shortcut: '',       fn: () => runInspiredFeature('vscode-command-brain') },
  { icon: '🌊', label: 'Inspired: Windsurf Flow Mode', shortcut: '',         fn: () => runInspiredFeature('windsurf-flow') },
  // Editor utilities
  { icon: '🔎', label: 'Find in Editor',          shortcut: 'Ctrl+F',        fn: () => { if (ApexState.monacoEditor) ApexState.monacoEditor.trigger('keyboard', 'actions.find', null); } },
  { icon: '🔄', label: 'Find and Replace',        shortcut: 'Ctrl+H',        fn: () => { if (ApexState.monacoEditor) ApexState.monacoEditor.trigger('keyboard', 'editor.action.startFindReplaceAction', null); } },
  { icon: '↩️', label: 'Undo',                    shortcut: 'Ctrl+Z',        fn: () => undoAction() },
  { icon: '↪️', label: 'Redo',                    shortcut: 'Ctrl+Shift+Z',  fn: () => redoAction() },
  { icon: '✏️', label: 'Format Document',          shortcut: 'Shift+Alt+F',   fn: () => formatDocument()      },
  { icon: '🔢', label: 'Go to Line',              shortcut: 'Ctrl+G',        fn: () => goToLine()            },
  { icon: '🗺️', label: 'Toggle Minimap',           shortcut: '',              fn: () => toggleMinimap()       },
  { icon: '🗑️', label: 'Clear Chat',              shortcut: '',              fn: () => clearChat()           },
  { icon: '🧩', label: 'Open Logic Mode',          shortcut: 'Ctrl+Shift+L',  fn: () => switchActivity('logic-mode') },
  { icon: '📋', label: 'Logic: Import Build Plan', shortcut: '',              fn: () => importBuildPlan()     },
  { icon: '🗑️', label: 'Logic: Clear All Steps',  shortcut: '',              fn: () => clearLogicPlan()      },
  { icon: '🎵', label: 'Open Music Player',        shortcut: 'Ctrl+M',        fn: () => switchActivity('music-player') },
  { icon: '🔀', label: 'Music: Shuffle',           shortcut: '',              fn: () => mpToggleShuffle()     },
  { icon: '⏭',  label: 'Music: Next Track',        shortcut: '',              fn: () => mpNext()              },
  { icon: '⏮',  label: 'Music: Previous Track',    shortcut: '',              fn: () => mpPrev()              },
  { icon: '▶',  label: 'Music: Play / Pause',      shortcut: '',              fn: () => mpTogglePlay()        },
  { icon: '🍅', label: 'Toggle Pomodoro Timer',    shortcut: '',              fn: () => { const cb = document.getElementById('settings-pomodoro'); if (cb) { cb.checked = !cb.checked; togglePomodoro(cb.checked); } switchActivity('settings'); } },
  { icon: '🧘', label: 'Toggle Zen Mode',          shortcut: '',              fn: () => { const cb = document.getElementById('settings-zen'); if (cb) { cb.checked = !cb.checked; toggleZenMode(cb.checked); } } },
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
  renderMCPServers();
  renderCLIInstances();
  renderLogicPlan();

  // Restore saved theme
  try {
    const savedTheme = localStorage.getItem('apex_theme');
    if (savedTheme && THEMES[savedTheme]) changeTheme(savedTheme);
  } catch (_) {}
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
        minimap: { enabled: ApexState.minimapEnabled },
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
  const id = getFileId(node.name);
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
    const langMap = { js: 'javascript', ts: 'typescript', css: 'css', html: 'html', json: 'json', md: 'markdown', py: 'python', go: 'go', rs: 'rust', sh: 'shell', txt: 'plaintext' };
    const ext = node.name.split('.').pop().toLowerCase();
    const lang = langMap[ext] || 'plaintext';
    const fileId = getFileId(node.name);

    // Save current buffer before switching
    const prevTab = ApexState.activeTab;
    if (prevTab && prevTab !== 'welcome' && prevTab !== fileId) {
      const currentContent = ApexState.monacoEditor.getValue();
      ApexState.fileBuffers[prevTab] = currentContent;
    }

    // Restore saved content or use default
    const savedContent = ApexState.fileBuffers[fileId];
    const content = savedContent != null ? savedContent : `// ${node.name}\n`;

    const oldModel = ApexState.monacoEditor.getModel();
    const model = monaco.editor.createModel(content, lang);
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
  termPrint('output', `APEX IDE — Megacode Edition  v${APEX_VERSION}`);
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
    termPrint('output', '  cat <file>    — Display file contents');
    termPrint('output', '  touch <file>  — Create a new file');
    termPrint('output', '  mkdir <dir>   — Create a new directory');
    termPrint('output', '  rm <file>     — Remove a file or directory');
    termPrint('output', '  git status    — Show git status');
    termPrint('output', '  git pull/push — Git operations');
    termPrint('output', '  npm run start — Start dev server');
    termPrint('output', '  megacode      — Start Megacode session');
    termPrint('output', '  ollama        — Interact with Ollama');
    termPrint('output', '  history       — Show command history');
    termPrint('output', '  date          — Show current date/time');
    termPrint('output', '  uptime        — Show session uptime');
    termPrint('output', '  env           — Show environment variables');
    termPrint('output', '  whoami        — Show current user');
    termPrint('output', '  echo <text>   — Echo text');
    termPrint('output', '  theme <name>  — Switch color theme');
    termPrint('output', '  version       — Show IDE version');
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
  date: () => termPrint('output', new Date().toString()),
  uptime: () => {
    const session = ApexState.session;
    if (!session || !session.startTime) {
      termPrint('warn', 'Session uptime is not available yet (session not initialized).');
      return;
    }
    const mins = Math.floor((Date.now() - session.startTime) / 60000);
    termPrint('output', `Session uptime: ${mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'}`);
  },
  history: () => {
    if (ApexState.terminalHistory.length === 0) { termPrint('output', '(no history)'); return; }
    ApexState.terminalHistory.slice().reverse().forEach((cmd, i) => termPrint('output', `  ${i + 1}  ${cmd}`));
  },
  cat: (args) => {
    if (!args.length) { termPrint('warn', 'Usage: cat <filename>'); return; }
    const name = args[0];
    const fileId = getFileId(name);
    const content = ApexState.fileBuffers[fileId];
    if (content != null) { termPrint('output', content); }
    else { termPrint('error', `cat: ${name}: No content stored (open and edit the file first)`); }
  },
  touch: (args) => {
    if (!args.length) { termPrint('warn', 'Usage: touch <filename>'); return; }
    const name = args[0];
    const exists = SAMPLE_TREE.some(n => n.name === name);
    if (exists) { termPrint('output', `touch: '${name}' already exists`); return; }
    const node = { name, type: 'file', depth: 0, lang: 'javascript' };
    SAMPLE_TREE.push(node);
    renderFileTree();
    termPrint('output', `Created: ${name}`);
  },
  mkdir: (args) => {
    if (!args.length) { termPrint('warn', 'Usage: mkdir <dirname>'); return; }
    const name = args[0];
    SAMPLE_TREE.push({ name, type: 'folder', depth: 0, open: true, children: [] });
    renderFileTree();
    termPrint('output', `Created directory: ${name}`);
  },
  rm: (args) => {
    if (!args.length) { termPrint('warn', 'Usage: rm <filename>'); return; }
    const name = args[0];
    const idx = SAMPLE_TREE.findIndex(n => n.name === name);
    if (idx === -1) { termPrint('error', `rm: ${name}: No such file or directory`); return; }
    const fileId = getFileId(name);
    delete ApexState.fileBuffers[fileId];
    SAMPLE_TREE.splice(idx, 1);
    renderFileTree();
    termPrint('output', `Removed: ${name}`);
  },
  env: () => {
    termPrint('output', `USER=${ApexState.userHandle}`);
    termPrint('output', `MODE=${ApexState.mode}`);
    termPrint('output', `PROJECT=${ApexState.projectName || '(none)'}`);
    termPrint('output', `PROJECT_TYPE=${ApexState.projectType}`);
    termPrint('output', `EDITOR=monaco`);
    termPrint('output', `TERM=apex-terminal`);
  },
  version: () => termPrint('output', `APEX IDE v${APEX_VERSION} — Megacode Edition`),
  theme: (args) => {
    if (!args.length) { termPrint('output', 'Available themes: ' + Object.keys(THEMES).join(', ')); return; }
    changeTheme(args[0]);
  },
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

function undoAction() {
  if (ApexState.monacoEditor) {
    ApexState.monacoEditor.trigger('keyboard', 'undo', null);
  }
}
function redoAction() {
  if (ApexState.monacoEditor) {
    ApexState.monacoEditor.trigger('keyboard', 'redo', null);
  }
}

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

function runInspiredFeature(feature) {
  const msgs = {
    'cursor-composer':      '[Inspired] Cursor Composer Flow → Drafting an agentic multi-file plan from current selection…',
    'antigravity-orbit':    '[Inspired] Antigravity Context Orbit → Pulling surrounding files and symbols into working memory…',
    'vscode-command-brain': '[Inspired] VSCode Command Brain → Ranking likely commands and shortcuts for current task…',
    'windsurf-flow':        '[Inspired] Windsurf Flow Mode → Streaming paired plan + edits with checkpoint updates…',
  };
  termPrint('output', msgs[feature] || `[Inspired] Running ${feature}…`);
  const terminalTabBtn = document.querySelector('.bottom-tab[data-tab="terminal"]');
  if (terminalTabBtn) switchBottomTab('terminal', terminalTabBtn);
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

function saveFile() {
  if (!ApexState.monacoEditor || ApexState.activeTab === 'welcome') {
    showToast('No file to save', 'warn');
    return;
  }
  const content = ApexState.monacoEditor.getValue();
  ApexState.fileBuffers[ApexState.activeTab] = content;
  // Persist all buffers to localStorage
  try {
    localStorage.setItem('apex_file_buffers', JSON.stringify(ApexState.fileBuffers));
  } catch (_) { /* storage full or unavailable */ }
  const fileName = ApexState.activeTab.replace('file-', '').replace(/-/g, '.');
  showToast(`Saved: ${fileName}`, 'success');
}

/* ─── Search ──────────────────────────────────────────────────────── */
function runSearch(query) {
  const results = document.getElementById('search-results');
  if (!query) { results.innerHTML = '<p class="empty-state">Type to search…</p>'; return; }

  const useRegex = document.getElementById('search-regex')?.checked;
  const matchCase = document.getElementById('search-case')?.checked;
  const q = matchCase ? query : query.toLowerCase();
  let re = null;
  if (useRegex) {
    try { re = new RegExp(query, matchCase ? '' : 'i'); } catch (err) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = `Invalid regex: ${err.message || 'parse error'}`;
      results.innerHTML = '';
      results.appendChild(p);
      return;
    }
  }

  // Collect all file nodes from the tree
  function collectFiles(nodes, prefix) {
    let out = [];
    (nodes || []).forEach(n => {
      const path = prefix ? prefix + '/' + n.name : n.name;
      if (n.type === 'folder' && n.children) {
        out = out.concat(collectFiles(n.children, path));
      } else if (n.type === 'file') {
        out.push({ path, node: n });
      }
    });
    return out;
  }
  const allFiles = collectFiles(SAMPLE_TREE, '');

  // Search in file names and file content buffers
  const matches = [];
  allFiles.forEach(({ path, node }) => {
    const nameToCheck = matchCase ? path : path.toLowerCase();
    const nameMatch = re ? re.test(path) : nameToCheck.includes(q);
    // Also search stored buffer content
    const fileId = getFileId(node.name);
    const content = ApexState.fileBuffers?.[fileId] || '';
    const contentToCheck = matchCase ? content : content.toLowerCase();
    const contentMatch = content && (re ? re.test(content) : contentToCheck.includes(q));
    if (nameMatch || contentMatch) {
      matches.push({ path, node, contentMatch });
    }
  });

  if (matches.length === 0) { results.innerHTML = '<p class="empty-state">No results found</p>'; return; }
  results.innerHTML = '';
  matches.forEach(m => {
    const icon = getFileIcon(m.path);
    const item = document.createElement('div');
    item.className = 'file-item';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    const pathSpan = document.createElement('span');
    pathSpan.textContent = m.path;
    item.appendChild(iconSpan);
    item.appendChild(pathSpan);
    if (m.contentMatch) {
      const badge = document.createElement('span');
      badge.className = 'search-content-badge';
      badge.textContent = 'content';
      item.appendChild(badge);
    }
    item.addEventListener('click', () => openFileTab(m.node));
    results.appendChild(item);
  });
}

/* ─── Settings ────────────────────────────────────────────────────── */
function changeTheme(theme) {
  const t = THEMES[theme];
  if (!t) { showToast(`Unknown theme: ${theme}`, 'warn'); return; }
  Object.entries(t).forEach(([key, val]) => {
    if (key.startsWith('--')) document.documentElement.style.setProperty(key, val);
  });
  if (t.monacoTheme && ApexState.monacoEditor && typeof monaco !== 'undefined') {
    monaco.editor.setTheme(t.monacoTheme);
  }
  try { localStorage.setItem('apex_theme', theme); } catch (_) {}
  showToast(`Theme: ${theme}`, 'success');
}
function changeFontSize(size) {
  const sizeNum = parseInt(size) || 14;
  const input = document.getElementById('settings-font-size');
  if (input) input.value = sizeNum;
  if (ApexState.monacoEditor) ApexState.monacoEditor.updateOptions({ fontSize: sizeNum });
}
function toggleVimMode(on) { termPrint('output', `[Settings] Vim mode: ${on ? 'ON' : 'OFF'}`); }
function toggleWordWrap(on) {
  if (ApexState.monacoEditor) ApexState.monacoEditor.updateOptions({ wordWrap: on ? 'on' : 'off' });
}
function setMinimap(on) {
  const enabled = !!on;
  ApexState.minimapEnabled = enabled;
  // Persist minimap preference so Settings and command palette stay consistent
  try {
    window.localStorage.setItem('apex.minimapEnabled', JSON.stringify(enabled));
  } catch (e) {
    // Ignore storage errors (e.g., private mode or disabled storage)
  }
  // Keep Settings checkbox in sync with current state
  const settingsMinimap = document.getElementById('settings-minimap');
  if (settingsMinimap) {
    settingsMinimap.checked = enabled;
  }
  if (ApexState.monacoEditor) {
    ApexState.monacoEditor.updateOptions({ minimap: { enabled } });
  }
}
function toggleVimModeCmd() {
  const cb = document.getElementById('vim-mode');
  if (cb) { cb.checked = !cb.checked; toggleVimMode(cb.checked); }
}

function buildDeepCustomizationConfig() {
  const num = (id, fallback) => parseInt(document.getElementById(id)?.value, 10) || fallback;
  return {
    theme: document.getElementById('settings-theme')?.value || 'hiphop-dark',
    fontSize: num('settings-font-size', 14),
    vimMode: !!document.getElementById('vim-mode')?.checked,
    wordWrap: !!document.getElementById('settings-word-wrap')?.checked,
    minimap: typeof ApexState.minimapEnabled === 'boolean'
      ? ApexState.minimapEnabled
      : !!document.getElementById('settings-minimap')?.checked,
    autoSave: !!document.getElementById('settings-autosave')?.checked,
    autoSaveDelay: num('settings-autosave-delay', 1000),
    zenMode: !!document.getElementById('settings-zen')?.checked,
    pomodoroWorkMins: num('settings-pomodoro-work', 25),
    pomodoroBreakMins: num('settings-pomodoro-break', 5),
    soundsEnabled: !!document.getElementById('settings-sounds')?.checked,
    aiChimeEnabled: !!document.getElementById('settings-ai-chime')?.checked,
  };
}

window.loadDeepCustomizationJSON = function () {
  const area = document.getElementById('settings-deep-json');
  if (!area) return;
  area.value = JSON.stringify(buildDeepCustomizationConfig(), null, 2);
};

window.applyDeepCustomization = function () {
  const area = document.getElementById('settings-deep-json');
  if (!area) return;
  let config = {};
  try { config = JSON.parse(area.value || '{}'); } catch (err) { termPrint('warn', `[Settings] Invalid customization JSON: ${err?.message || 'parse error'}`); return; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) { termPrint('warn', '[Settings] Customization JSON must be an object'); return; }

  const applyBool = (key, id, fn = () => {}) => {
    if (typeof config[key] !== 'boolean') return;
    const el = document.getElementById(id);
    if (el) el.checked = config[key];
    fn(config[key]);
  };
  const applyNum = (key, id, fn = () => {}) => {
    if (typeof config[key] !== 'number' || !Number.isFinite(config[key])) return;
    const el = document.getElementById(id);
    if (el) el.value = config[key];
    fn(config[key]);
  };

  if (typeof config.theme === 'string') {
    const theme = document.getElementById('settings-theme');
    if (theme) theme.value = config.theme;
    changeTheme(config.theme);
  }
  applyNum('fontSize', 'settings-font-size', changeFontSize);
  applyBool('vimMode', 'vim-mode', toggleVimMode);
  applyBool('wordWrap', 'settings-word-wrap', toggleWordWrap);
  applyBool('minimap', 'settings-minimap', setMinimap);
  if (typeof window.toggleAutoSave === 'function') applyBool('autoSave', 'settings-autosave', window.toggleAutoSave);
  if (typeof window.setAutoSaveDelay === 'function') applyNum('autoSaveDelay', 'settings-autosave-delay', window.setAutoSaveDelay);
  if (typeof window.toggleZenMode === 'function') applyBool('zenMode', 'settings-zen', window.toggleZenMode);
  applyNum('pomodoroWorkMins', 'settings-pomodoro-work');
  applyNum('pomodoroBreakMins', 'settings-pomodoro-break');
  if (typeof window.toggleSounds === 'function') applyBool('soundsEnabled', 'settings-sounds', window.toggleSounds);
  if (typeof window.toggleAIChime === 'function') applyBool('aiChimeEnabled', 'settings-ai-chime', window.toggleAIChime);

  window.loadDeepCustomizationJSON();
  termPrint('output', '[Settings] Deep customization applied');
};

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
  renderSettingsComponents();
  if (window.loadDeepCustomizationJSON) window.loadDeepCustomizationJSON();
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

/* ─── CLI Runner ──────────────────────────────────────────────────── */
const CLI_QUICK_COMMANDS = {
  'npm install':             () => cliSimulate('npm install', ['added 1247 packages in 8s']),
  'npm run dev':             () => cliSimulate('npm run dev', ['> vite', '', '  VITE v5.0.0  ready in 312ms', '', '  ➜  Local:   http://localhost:5173/']),
  'npm run build':           () => cliSimulate('npm run build', ['> vite build', 'vite v5.0.0 building for production…', '✓ 42 modules transformed.', 'dist/index.html   0.46 kB', 'dist/assets/index.js   142.38 kB  ✓ built in 1.83s']),
  'npm run test':            () => cliSimulate('npm run test', ['> vitest', 'RUN  v1.0.0', '', 'src/app.test.js  (3 tests)', '  ✓ renders welcome screen', '  ✓ opens command palette', '  ✓ handles terminal input', 'Test Files  1 passed (1)', 'Tests       3 passed (3)']),
  'npm run lint':            () => cliSimulate('npm run lint', ['> eslint src/', 'src/app.js: no problems found', '✓ 0 errors, 0 warnings']),
  'npx vite':                () => cliSimulate('npx vite', ['  VITE v5.0.0  ready in 298ms', '', '  ➜  Local:   http://localhost:5173/', '  ➜  Network: http://192.168.1.1:5173/']),
  'npx create-react-app .':  () => cliSimulate('npx create-react-app .', ['Creating a new React app…', 'Installing packages…', 'Success! Created project at current directory.']),
  'npx create-next-app .':   () => cliSimulate('npx create-next-app .', ['Creating a new Next.js app…', '✓ Would you like to use TypeScript? No', '✓ App Router? Yes', 'Installing dependencies…', 'Success! Created app at current directory.']),
};

function cliPrint(type, text) {
  const out = document.getElementById('cli-output');
  if (!out) return;
  const div = document.createElement('div');
  div.className = `cli-line ${type}`;
  div.textContent = text;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function cliSimulate(cmd, lines) {
  cliPrint('cmd', `$ ${cmd}`);
  let delay = 0;
  lines.forEach(line => {
    setTimeout(() => cliPrint('output', line), delay);
    delay += 80;
  });
  setTimeout(() => cliPrint('info', `[Done] ${cmd}`), delay + 100);
}

function runCLICommand(cmd) {
  switchActivity('cli');
  const handler = CLI_QUICK_COMMANDS[cmd];
  if (handler) {
    handler();
  } else {
    cliSimulate(cmd, [`Running: ${cmd}…`, 'Done.']);
  }
}

function handleCLIKey(e) {
  const input = e.target;
  if (e.key === 'Enter') {
    const cmd = input.value.trim();
    if (!cmd) return;
    ApexState.cliHistory.unshift(cmd);
    ApexState.cliHistoryIdx = -1;
    input.value = '';
    runCLICommand(cmd);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (ApexState.cliHistoryIdx < ApexState.cliHistory.length - 1) {
      ApexState.cliHistoryIdx++;
      input.value = ApexState.cliHistory[ApexState.cliHistoryIdx];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (ApexState.cliHistoryIdx > 0) {
      ApexState.cliHistoryIdx--;
      input.value = ApexState.cliHistory[ApexState.cliHistoryIdx];
    } else {
      ApexState.cliHistoryIdx = -1;
      input.value = '';
    }
  }
}

function submitCLIInput() {
  const input = document.getElementById('cli-custom-input');
  if (!input) return;
  const cmd = input.value.trim();
  if (!cmd) return;
  ApexState.cliHistory.unshift(cmd);
  ApexState.cliHistoryIdx = -1;
  input.value = '';
  runCLICommand(cmd);
}

function clearCLIOutput() {
  const out = document.getElementById('cli-output');
  if (out) out.innerHTML = '';
}

/* ─── CLI Instances ───────────────────────────────────────────────── */
function extractFolderName(fileInput) {
  return fileInput?.files?.length
    ? fileInput.files[0].webkitRelativePath.split('/')[0]
    : '';
}

function addCLIInstance() {
  const nameEl   = document.getElementById('cli-instance-name');
  const folderEl = document.getElementById('cli-instance-folder');
  const name = nameEl?.value.trim();
  if (!name) { cliPrint('warn', '[CLI] Please enter a CLI name.'); return; }
  if (ApexState.cliInstances.some(c => c.name === name)) {
    cliPrint('warn', `[CLI] An instance named "${name}" already exists.`); return;
  }

  const folderPath = extractFolderName(folderEl);
  const id = ApexState._nextId++;
  const instance = { id, name, folderPath, connected: false };
  ApexState.cliInstances.push(instance);
  if (folderPath) {
    ApexState.uploadedComponents.push({ type: 'CLI', id, name, folderPath });
    renderSettingsComponents();
  }
  nameEl.value = '';
  if (folderEl) { folderEl.value = ''; }
  const folderNameEl = document.getElementById('cli-instance-folder-name');
  if (folderNameEl) folderNameEl.textContent = 'No folder selected';
  renderCLIInstances();
  cliPrint('info', `[CLI] Instance added: ${name}`);
}

function renderCLIInstances() {
  const list = document.getElementById('cli-instance-list');
  if (!list) return;
  list.innerHTML = '';
  if (!ApexState.cliInstances.length) {
    const empty = document.createElement('div');
    empty.className = 'cli-empty-note';
    empty.textContent = 'No CLI instances added yet.';
    list.appendChild(empty);
    return;
  }
  ApexState.cliInstances.forEach((inst, i) => {
    const card = document.createElement('div');
    card.className = 'cli-instance-card';

    const info = document.createElement('div');
    info.className = 'cli-instance-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'cli-instance-name';
    nameEl.textContent = `💻 ${inst.name}`;
    info.appendChild(nameEl);
    if (inst.folderPath) {
      const folderEl = document.createElement('div');
      folderEl.className = 'cli-instance-folder';
      folderEl.textContent = `📁 ${inst.folderPath}`;
      info.appendChild(folderEl);
    }

    // Folder upload button
    const folderLabel = document.createElement('label');
    folderLabel.className = 'mcp-folder-btn';
    folderLabel.title = inst.folderPath ? `Change folder (${inst.folderPath})` : 'Upload folder';
    folderLabel.textContent = '📂';
    const folderFile = document.createElement('input');
    folderFile.type = 'file';
    folderFile.webkitdirectory = true;
    folderFile.setAttribute('webkitdirectory', '');
    folderFile.multiple = true;
    folderFile.style.display = 'none';
    folderFile.addEventListener('change', () => {
      const fp = extractFolderName(folderFile);
      if (!fp) return;
      const instId = ApexState.cliInstances[i].id;
      ApexState.cliInstances[i].folderPath = fp;
      const existing = ApexState.uploadedComponents.findIndex(c => c.type === 'CLI' && c.id === instId);
      if (existing >= 0) ApexState.uploadedComponents[existing].folderPath = fp;
      else ApexState.uploadedComponents.push({ type: 'CLI', id: instId, name: ApexState.cliInstances[i].name, folderPath: fp });
      renderCLIInstances();
      renderSettingsComponents();
      cliPrint('info', `[CLI] Folder "${fp}" linked to ${ApexState.cliInstances[i].name}`);
    });
    folderLabel.appendChild(folderFile);

    // Connect button
    const connectBtn = document.createElement('button');
    connectBtn.className = `mcp-connect-btn${inst.connected ? ' connected' : ''}`;
    connectBtn.textContent = inst.connected ? '● Connected' : '○ Connect';
    connectBtn.addEventListener('click', () => toggleCLIInstance(i));

    card.appendChild(info);
    card.appendChild(folderLabel);
    card.appendChild(connectBtn);
    list.appendChild(card);
  });
}

function toggleCLIInstance(idx) {
  const inst = ApexState.cliInstances[idx];
  if (!inst) return;
  inst.connected = !inst.connected;
  renderCLIInstances();
  cliPrint('info', `[CLI] ${inst.name}: ${inst.connected ? 'connected' : 'disconnected'}`);
}

/* ─── Settings: Uploaded Components ──────────────────────────────── */
function renderSettingsComponents() {
  const container = document.getElementById('settings-uploads-list');
  if (!container) return;
  container.innerHTML = '';
  if (!ApexState.uploadedComponents.length) {
    const note = document.createElement('div');
    note.className = 'settings-note';
    note.textContent = 'No folders uploaded yet.';
    container.appendChild(note);
    return;
  }
  ApexState.uploadedComponents.forEach(comp => {
    const row = document.createElement('div');
    row.className = 'settings-upload-row';
    const badge = document.createElement('span');
    badge.className = `settings-upload-badge settings-upload-badge-${comp.type.toLowerCase()}`;
    badge.textContent = comp.type;
    const label = document.createElement('span');
    label.className = 'settings-upload-label';
    label.textContent = `${comp.name}`;
    const folder = document.createElement('span');
    folder.className = 'settings-upload-folder';
    folder.textContent = `📁 ${comp.folderPath}`;
    row.appendChild(badge);
    row.appendChild(label);
    row.appendChild(folder);
    container.appendChild(row);
  });
}


function addMCPServer() {
  const nameEl   = document.getElementById('mcp-server-name');
  const cmdEl    = document.getElementById('mcp-server-cmd');
  const folderEl = document.getElementById('mcp-server-folder');
  const name = nameEl?.value.trim();
  const cmd  = cmdEl?.value.trim();
  if (!name || !cmd) { termPrint('warn', '[MCP] Please enter server name and command.'); return; }
  if (ApexState.mcpServers.some(s => s.name === name)) {
    termPrint('warn', `[MCP] A server named "${name}" already exists.`); return;
  }

  const folderPath = extractFolderName(folderEl);
  const id = ApexState._nextId++;
  const server = { id, name, cmd, connected: false, folderPath };
  ApexState.mcpServers.push(server);
  if (folderPath) {
    ApexState.uploadedComponents.push({ type: 'MCP', id, name, folderPath });
    renderSettingsComponents();
  }
  nameEl.value = '';
  cmdEl.value  = '';
  if (folderEl) { folderEl.value = ''; }
  const folderNameEl = document.getElementById('mcp-server-folder-name');
  if (folderNameEl) folderNameEl.textContent = 'No folder selected';
  renderMCPServers();
  termPrint('output', `[MCP] Server added: ${name}`);
}

function renderMCPServers() {
  const list = document.getElementById('mcp-server-list');
  if (!list) return;
  list.innerHTML = '';
  ApexState.mcpServers.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'mcp-server-card';
    card.dataset.idx = i;

    const icon = document.createElement('span');
    icon.className = 'mcp-server-icon';
    icon.textContent = '🔌';

    const info = document.createElement('div');
    info.className = 'mcp-server-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'mcp-server-name';
    nameEl.textContent = s.name;
    const cmdEl = document.createElement('div');
    cmdEl.className = 'mcp-server-cmd';
    cmdEl.textContent = s.cmd;
    info.appendChild(nameEl);
    info.appendChild(cmdEl);
    if (s.folderPath) {
      const folderEl = document.createElement('div');
      folderEl.className = 'mcp-server-folder';
      folderEl.textContent = `📁 ${s.folderPath}`;
      info.appendChild(folderEl);
    }

    // Folder upload button
    const folderLabel = document.createElement('label');
    folderLabel.className = 'mcp-folder-btn';
    folderLabel.title = s.folderPath ? `Change folder (${s.folderPath})` : 'Upload folder';
    folderLabel.textContent = '📂';
    const folderFile = document.createElement('input');
    folderFile.type = 'file';
    folderFile.setAttribute('webkitdirectory', '');
    folderFile.multiple = true;
    folderFile.style.display = 'none';
    folderFile.addEventListener('change', () => {
      const fp = extractFolderName(folderFile);
      if (!fp) return;
      const serverId = ApexState.mcpServers[i].id;
      ApexState.mcpServers[i].folderPath = fp;
      const existing = ApexState.uploadedComponents.findIndex(c => c.type === 'MCP' && c.id === serverId);
      if (existing >= 0) ApexState.uploadedComponents[existing].folderPath = fp;
      else ApexState.uploadedComponents.push({ type: 'MCP', id: serverId, name: ApexState.mcpServers[i].name, folderPath: fp });
      renderMCPServers();
      renderSettingsComponents();
      termPrint('output', `[MCP] Folder "${fp}" linked to ${ApexState.mcpServers[i].name}`);
    });
    folderLabel.appendChild(folderFile);

    // Connect button
    const connectBtn = document.createElement('button');
    connectBtn.className = `mcp-connect-btn${s.connected ? ' connected' : ''}`;
    connectBtn.textContent = s.connected ? '● Connected' : '○ Connect';
    connectBtn.addEventListener('click', () => toggleMCPServer(i));

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(folderLabel);
    card.appendChild(connectBtn);
    list.appendChild(card);
  });
}

function toggleMCPServer(idx) {
  const server = ApexState.mcpServers[idx];
  if (!server) return;
  server.connected = !server.connected;
  renderMCPServers();
  termPrint('output', `[MCP] ${server.name}: ${server.connected ? 'connected' : 'disconnected'}`);
}

function invokeMCPTool(tool) {
  termPrint('output', `[MCP] Invoking tool: ${tool}…`);
  const terminalTab = document.querySelector('.bottom-tab[onclick*="terminal"]');
  switchBottomTab('terminal', terminalTab || document.querySelector('.bottom-tab'));
  const msgs = {
    read_file:       '[MCP] read_file → Enter path in terminal: mcp read <path>',
    write_file:      '[MCP] write_file → Enter path & content in terminal: mcp write <path> <content>',
    list_directory:  '[MCP] list_directory → Listing project root…\n  src/  public/  package.json  README.md',
    search_files:    '[MCP] search_files → Enter query in terminal: mcp search <query>',
  };
  setTimeout(() => termPrint('output', msgs[tool] || `[MCP] ${tool} ready`), 300);
}

/* ═══════════════ LOGIC MODE ═════════════════════════════════════════ */

let _pendingBuildPlanText = null;

const LOGIC_STATUS_ICONS = { pending: '⬜', active: '🔵', done: '✅', skipped: '⏭️' };
const LOGIC_STATUS_CYCLE  = { pending: 'active', active: 'done', done: 'pending', skipped: 'pending' };
const LOGIC_MAX_STEP_LENGTH    = 300; // max characters for a single auto-imported step description
const LOGIC_MIN_PLAN_STEPS     = 3;  // min steps to trigger the auto-import banner

function renderLogicPlan() {
  const list     = document.getElementById('logic-step-list');
  const countEl  = document.getElementById('logic-step-count');
  const progress = document.getElementById('logic-progress-bar');
  if (!list) return;

  const plan  = ApexState.logicPlan;
  const done  = plan.filter(s => s.status === 'done').length;
  const total = plan.length;

  if (countEl)  countEl.textContent = `${done}/${total} steps`;
  if (progress) progress.style.width = total ? `${(done / total) * 100}%` : '0%';

  list.innerHTML = '';

  if (!plan.length) {
    const empty = document.createElement('div');
    empty.className = 'logic-empty';
    empty.textContent = 'No steps yet. Add a step or import a build plan.';
    list.appendChild(empty);
    return;
  }

  plan.forEach((step, i) => {
    const item = document.createElement('div');
    item.className = `logic-step logic-step-${step.status}`;

    const numEl = document.createElement('span');
    numEl.className = 'logic-step-num';
    numEl.textContent = `${i + 1}`;

    const iconBtn = document.createElement('button');
    iconBtn.className = 'logic-step-icon';
    iconBtn.textContent = LOGIC_STATUS_ICONS[step.status] || '⬜';
    iconBtn.title = 'Click to cycle status (pending → active → done)';
    iconBtn.addEventListener('click', () => cycleLogicStepStatus(i));

    const textEl = document.createElement('span');
    textEl.className = 'logic-step-text';
    textEl.textContent = step.text;

    const delBtn = document.createElement('button');
    delBtn.className = 'logic-step-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove step';
    delBtn.addEventListener('click', () => deleteLogicStep(i));

    item.appendChild(numEl);
    item.appendChild(iconBtn);
    item.appendChild(textEl);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

function cycleLogicStepStatus(idx) {
  const step = ApexState.logicPlan[idx];
  if (!step) return;
  step.status = LOGIC_STATUS_CYCLE[step.status] || 'pending';
  renderLogicPlan();
  termPrint('output', `[Logic] Step ${idx + 1} → ${step.status.toUpperCase()}: ${step.text}`);
}

function deleteLogicStep(idx) {
  ApexState.logicPlan.splice(idx, 1);
  renderLogicPlan();
}

function addLogicStep() {
  const input = document.getElementById('logic-step-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { termPrint('warn', '[Logic] Please enter a step description.'); return; }
  ApexState.logicPlan.push({ id: ApexState.logicPlanNextId++, text, status: 'pending' });
  input.value = '';
  renderLogicPlan();
  termPrint('output', `[Logic] Step added: ${text}`);
}

function clearLogicPlan() {
  if (!ApexState.logicPlan.length) return;
  if (!confirm('Clear all logic steps?')) return;
  ApexState.logicPlan = [];
  renderLogicPlan();
  termPrint('output', '[Logic] Plan cleared');
}

function parseBuildPlanText(text) {
  const lines = text.split('\n');
  const steps = [];
  const patterns = [
    /^\s*\d+[\.\)]\s+(.+)/,       // 1. Step  or  1) Step
    /^\s*[-*•]\s+(.+)/,           // - Step  or  * Step
    /^\s*step\s+\d+[:\s]+(.+)/i, // Step 1: text
    /^\s*\[[ xX-]\]\s+(.+)/,     // [ ] Step  or  [x]/[X] Step
  ];
  lines.forEach(line => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const t = match[1].trim();
        if (t.length > 0 && t.length <= LOGIC_MAX_STEP_LENGTH) steps.push(t);
        break;
      }
    }
  });
  return steps;
}

function importBuildPlan() {
  const modal = document.getElementById('logic-import-modal');
  if (modal) modal.classList.remove('hidden');
  const textarea = document.getElementById('logic-import-text');
  if (textarea) textarea.focus();
}

function closeImportModal() {
  const modal = document.getElementById('logic-import-modal');
  if (modal) modal.classList.add('hidden');
  const textarea = document.getElementById('logic-import-text');
  if (textarea) textarea.value = '';
}

function confirmImportBuildPlan() {
  const textarea = document.getElementById('logic-import-text');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) { termPrint('warn', '[Logic] No plan text to import.'); return; }
  const steps = parseBuildPlanText(text);
  if (steps.length === 0) {
    termPrint('warn', '[Logic] No steps found. Use numbered list (1. Step) or bullets (- Step).');
    return;
  }
  steps.forEach(stepText => {
    ApexState.logicPlan.push({ id: ApexState.logicPlanNextId++, text: stepText, status: 'pending' });
  });
  closeImportModal();
  switchActivity('logic-mode');
  renderLogicPlan();
  termPrint('output', `[Logic] Imported ${steps.length} steps from build plan ✓`);
}

function maybeOfferBuildPlanImport(text) {
  const steps = parseBuildPlanText(text);
  if (steps.length >= LOGIC_MIN_PLAN_STEPS) {
    _pendingBuildPlanText = text;
    showBuildPlanBanner(steps.length);
  } else {
    // Clear any stale pending build plan and banner when no valid plan is detected
    _pendingBuildPlanText = '';
    const existing = document.getElementById('logic-import-banner');
    if (existing) existing.remove();
  }
}

function showBuildPlanBanner(count) {
  const existing = document.getElementById('logic-import-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'logic-import-banner';
  banner.className = 'logic-import-banner fade-in';

  const icon = document.createElement('span');
  icon.className = 'logic-banner-icon';
  icon.textContent = '🧩';

  const textEl = document.createElement('span');
  textEl.className = 'logic-banner-text';
  textEl.textContent = `Build plan detected (${count} steps) — import to Logic Mode?`;

  const importBtn = document.createElement('button');
  importBtn.className = 'logic-banner-btn';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', importBuildPlanFromPending);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'logic-banner-dismiss';
  dismissBtn.textContent = '✕';
  dismissBtn.addEventListener('click', () => banner.remove());

  banner.appendChild(icon);
  banner.appendChild(textEl);
  banner.appendChild(importBtn);
  banner.appendChild(dismissBtn);

  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    chatMessages.appendChild(banner);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function importBuildPlanFromPending() {
  const text = _pendingBuildPlanText;
  _pendingBuildPlanText = null;
  const banner = document.getElementById('logic-import-banner');
  if (banner) banner.remove();
  if (!text) return;
  const steps = parseBuildPlanText(text);
  if (steps.length === 0) { termPrint('warn', '[Logic] No steps found in detected plan.'); return; }
  steps.forEach(stepText => {
    ApexState.logicPlan.push({ id: ApexState.logicPlanNextId++, text: stepText, status: 'pending' });
  });
  switchActivity('logic-mode');
  renderLogicPlan();
  termPrint('output', `[Logic] Imported ${steps.length} steps from build plan ✓`);
}

/* ─── Frontend Visualizer ─────────────────────────────────────────── */
function openVisualizerTab() {
  if (!ApexState.openTabs.includes('visualizer')) {
    ApexState.openTabs.push('visualizer');
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === 'visualizer'));
  showPane('visualizer');
  ApexState.activeTab = 'visualizer';
  document.getElementById('status-file').textContent = 'Visualizer';
}

function setVizViewport(size, btn) {
  document.querySelectorAll('.visualizer-viewport-btns .viz-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const wrap = document.getElementById('visualizer-frame-wrap');
  const iframe = document.getElementById('visualizer-iframe');
  if (!wrap || !iframe) return;
  const sizes = { desktop: { w: '100%', h: '100%' }, tablet: { w: '768px', h: '100%' }, mobile: { w: '375px', h: '100%' } };
  const s = sizes[size] || sizes.desktop;
  iframe.style.width  = s.w;
  iframe.style.height = s.h;
  wrap.dataset.viewport = size;
}

function loadVisualizerURL() {
  const urlInput = document.getElementById('visualizer-url');
  const url = urlInput?.value.trim();
  const iframe = document.getElementById('visualizer-iframe');
  if (!iframe || !url) return;
  // Validate URL scheme to prevent javascript: and other non-web protocols
  try {
    const parsed = new URL(url, window.location.href);
    if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) {
      termPrint('warn', '[Visualizer] Only HTTP, HTTPS, and about: URLs are allowed');
      return;
    }
    iframe.src = parsed.href;
  } catch (e) {
    termPrint('warn', '[Visualizer] Invalid URL');
    return;
  }
  // Clear any stored HTML preview when loading a URL
  iframe.removeAttribute('data-html');
  const old = iframe.getAttribute('data-blob-url');
  if (old) { URL.revokeObjectURL(old); iframe.removeAttribute('data-blob-url'); }
  urlInput.placeholder = 'Enter URL or HTML to preview…';
  termPrint('output', `[Visualizer] Loading: ${url}`);
}

function refreshVisualizer() {
  const iframe = document.getElementById('visualizer-iframe');
  if (!iframe) return;
  const stored = iframe.getAttribute('data-html');
  if (stored) {
    const old = iframe.getAttribute('data-blob-url');
    if (old) URL.revokeObjectURL(old);
    const blob = new Blob([stored], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframe.setAttribute('data-blob-url', url);
    iframe.src = url;
  } else if (iframe.src && iframe.src !== 'about:blank') {
    try {
      iframe.contentWindow.location.reload();
    } catch (e) {
      iframe.src = iframe.src; // fallback for cross-origin iframes
    }
  }
  termPrint('output', '[Visualizer] Refreshed');
}

function previewHTML() {
  const html = document.getElementById('visualizer-html-input')?.value;
  const iframe = document.getElementById('visualizer-iframe');
  if (!iframe || !html) return;
  const old = iframe.getAttribute('data-blob-url');
  if (old) URL.revokeObjectURL(old);
  iframe.setAttribute('data-html', html);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  iframe.setAttribute('data-blob-url', url);
  iframe.src = url;
  document.getElementById('visualizer-url').value = '';
  document.getElementById('visualizer-url').placeholder = '(HTML preview active)';
  termPrint('output', '[Visualizer] Previewing HTML snippet');
}
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
      playChime();
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
    const firstChoice = Array.isArray(data.choices) && data.choices.length > 0 ? data.choices[0] : null;
    const content = firstChoice?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('OpenAI API returned an unexpected response without choices content.');
    }
    return content;
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

/* ═══════════════ MUSIC PLAYER ═══════════════════════════════════════ */
(function () {
  /* ── State ── */
  const MP = ApexState.musicPlayer = {
    audio:       new Audio(),
    tracks:      [],         // { name, artist, url, file }
    playlists:   [{ name: 'All Tracks', indices: [] }],  // indices into tracks[]
    activePl:    0,
    currentIdx:  -1,
    playing:     false,
    shuffle:     false,
    repeat:      'none',     // 'none' | 'one' | 'all'
    muted:       false,
    volume:      0.8,
    _shuffleBag: [],
    _sessionStarted: false,
  };

  MP.audio.volume = MP.volume;

  /* ── Helpers ── */
  function fmtTime(s) {
    if (isNaN(s) || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function currentQueue() {
    const pl = MP.playlists[MP.activePl];
    if (!pl) return [];
    if (MP.activePl === 0) return MP.tracks.map((_, i) => i);
    return pl.indices;
  }

  function updateMiniBar() {
    const bar = document.getElementById('mp-mini-bar');
    if (!bar) return;
    if (MP.tracks.length === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const track = MP.tracks[MP.currentIdx];
    const titleEl = document.getElementById('mp-mini-title');
    const artistEl = document.getElementById('mp-mini-artist');
    const timeEl = document.getElementById('mp-mini-time');
    const fillEl = document.getElementById('mp-mini-progress-fill');
    const playBtn = document.getElementById('mp-mini-play');
    if (titleEl) titleEl.textContent = track ? track.name : 'No track';
    if (artistEl) artistEl.textContent = track ? (track.artist || '—') : '—';
    if (timeEl && MP.audio.duration) {
      timeEl.textContent = `${fmtTime(MP.audio.currentTime)} / ${fmtTime(MP.audio.duration)}`;
    }
    if (fillEl && MP.audio.duration) {
      fillEl.style.width = ((MP.audio.currentTime / MP.audio.duration) * 100) + '%';
    }
    if (playBtn) playBtn.textContent = MP.playing ? '⏸' : '▶';
  }

  function updatePlayerUI() {
    const track = MP.tracks[MP.currentIdx];
    const titleEl  = document.getElementById('mp-track-title');
    const artistEl = document.getElementById('mp-track-artist');
    const playBtn  = document.getElementById('mp-play-btn');
    const miniPlay = document.getElementById('mp-mini-play');
    if (titleEl)  titleEl.textContent  = track ? track.name   : 'No track selected';
    if (artistEl) artistEl.textContent = track ? (track.artist || '—') : '—';
    if (playBtn)  playBtn.textContent  = MP.playing ? '⏸' : '▶';
    if (miniPlay) miniPlay.textContent = MP.playing ? '⏸' : '▶';

    // Highlight active track in list
    document.querySelectorAll('.mp-track-item').forEach((el, i) => {
      const queue = currentQueue();
      const trackIdx = queue[i];
      el.classList.toggle('active', trackIdx === MP.currentIdx);
    });

    // Shuffle/repeat button states
    const shuffleBtn = document.getElementById('mp-shuffle-btn');
    const repeatBtn  = document.getElementById('mp-repeat-btn');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', MP.shuffle);
    if (repeatBtn) {
      repeatBtn.classList.remove('active');
      if (MP.repeat !== 'none') repeatBtn.classList.add('active');
      repeatBtn.title = MP.repeat === 'none' ? 'Repeat: Off' : MP.repeat === 'one' ? 'Repeat: One' : 'Repeat: All';
      repeatBtn.textContent = MP.repeat === 'one' ? '🔂' : '🔁';
    }
    updateMiniBar();
  }

  /* ── Load Folder ── */
  window.mpLoadFolder = function (files) {
    const audioExts = /\.(mp3|ogg|wav|flac|aac|m4a|opus|webm)$/i;
    const newTracks = [];
    Array.from(files).forEach(f => {
      if (!audioExts.test(f.name)) return;
      const name = f.name.replace(/\.[^.]+$/, '');
      const artist = (f.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '—';
      const url = URL.createObjectURL(f);
      newTracks.push({ name, artist, url, file: f });
    });
    if (!newTracks.length) {
      termPrint('warn', '[Music] No audio files found in that folder');
      return;
    }
    const startIdx = MP.tracks.length;
    MP.tracks.push(...newTracks);
    // Add to "All Tracks" (playlist 0) — it auto-shows all tracks
    // Add indices to any "All Tracks" playlist that explicitly tracks
    renderTrackList();
    updateMiniBar();
    termPrint('output', `[Music] Loaded ${newTracks.length} track(s) from folder`);
    // Auto-play first track if nothing loaded before
    if (MP.currentIdx === -1) {
      mpPlayTrack(startIdx);
    }
    renderPlaylistBar();
  };

  /* ── Render Track List ── */
  function renderTrackList() {
    const container = document.getElementById('mp-track-list');
    if (!container) return;
    const queue = currentQueue();
    if (!queue.length) {
      container.innerHTML = '<div class="mp-empty">No tracks in this playlist</div>';
      return;
    }
    container.innerHTML = '';
    queue.forEach((trackIdx, i) => {
      const track = MP.tracks[trackIdx];
      if (!track) return;
      const item = document.createElement('div');
      item.className = 'mp-track-item' + (trackIdx === MP.currentIdx ? ' active' : '');
      item.dataset.trackIdx = trackIdx;
      item.innerHTML = `
        <span class="mp-track-num">${i + 1}</span>
        <div class="mp-track-item-info">
          <span class="mp-track-item-name">${escHtml(track.name)}</span>
          <span class="mp-track-item-artist">${escHtml(track.artist || '—')}</span>
        </div>
        <button class="mp-track-remove" title="Remove" onclick="mpRemoveTrack(${trackIdx},event)">✕</button>
      `;
      item.addEventListener('click', () => mpPlayTrack(trackIdx));
      container.appendChild(item);
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Play / Pause ── */
  window.mpPlayTrack = function (idx) {
    if (idx < 0 || idx >= MP.tracks.length) return;
    const track = MP.tracks[idx];
    if (MP.currentIdx !== idx) {
      MP.audio.src = track.url;
      MP.currentIdx = idx;
    }
    MP.audio.play().then(() => {
      MP.playing = true;
      updatePlayerUI();
    }).catch(() => {});
  };

  window.mpTogglePlay = function () {
    if (!MP.tracks.length) return;
    if (MP.currentIdx === -1) { mpPlayTrack(0); return; }
    if (MP.playing) {
      MP.audio.pause();
      MP.playing = false;
    } else {
      MP.audio.play().then(() => { MP.playing = true; updatePlayerUI(); }).catch(() => {});
    }
    updatePlayerUI();
  };

  window.mpPrev = function () {
    const queue = currentQueue();
    if (!queue.length) return;
    const pos = queue.indexOf(MP.currentIdx);
    const newPos = pos <= 0 ? queue.length - 1 : pos - 1;
    mpPlayTrack(queue[newPos]);
  };

  window.mpNext = function () {
    const queue = currentQueue();
    if (!queue.length) return;
    if (MP.shuffle) {
      if (!MP._shuffleBag.length) MP._shuffleBag = [...queue].sort(() => Math.random() - 0.5);
      const next = MP._shuffleBag.pop();
      mpPlayTrack(next != null ? next : queue[0]);
      return;
    }
    const pos = queue.indexOf(MP.currentIdx);
    if (MP.repeat === 'all' || pos < queue.length - 1) {
      mpPlayTrack(queue[(pos + 1) % queue.length]);
    }
  };

  /* ── Audio events ── */
  MP.audio.addEventListener('ended', () => {
    if (MP.repeat === 'one') {
      MP.audio.currentTime = 0;
      MP.audio.play();
      return;
    }
    const queue = currentQueue();
    const pos = queue.indexOf(MP.currentIdx);
    if (MP.shuffle) { mpNext(); return; }
    if (MP.repeat === 'all') { mpPlayTrack(queue[(pos + 1) % queue.length]); return; }
    if (pos < queue.length - 1) { mpPlayTrack(queue[pos + 1]); }
    else { MP.playing = false; updatePlayerUI(); }
  });

  MP.audio.addEventListener('timeupdate', () => {
    const prog = document.getElementById('mp-progress');
    const cur  = document.getElementById('mp-time-cur');
    const dur  = document.getElementById('mp-time-dur');
    if (MP.audio.duration) {
      const pct = (MP.audio.currentTime / MP.audio.duration) * 100;
      if (prog) prog.value = pct;
      if (cur)  cur.textContent  = fmtTime(MP.audio.currentTime);
      if (dur)  dur.textContent  = fmtTime(MP.audio.duration);
    }
    updateMiniBar();
  });

  /* ── Controls ── */
  window.mpSeek = function (val) {
    if (MP.audio.duration) MP.audio.currentTime = (val / 100) * MP.audio.duration;
  };

  window.mpSetVolume = function (val) {
    MP.volume = val / 100;
    MP.audio.volume = MP.muted ? 0 : MP.volume;
  };

  window.mpToggleMute = function () {
    MP.muted = !MP.muted;
    MP.audio.volume = MP.muted ? 0 : MP.volume;
    const icon = document.querySelector('.mp-vol-icon');
    if (icon) icon.textContent = MP.muted ? '🔇' : '🔊';
  };

  window.mpToggleShuffle = function () {
    MP.shuffle = !MP.shuffle;
    MP._shuffleBag = [];
    updatePlayerUI();
    termPrint('output', `[Music] Shuffle: ${MP.shuffle ? 'ON' : 'OFF'}`);
  };

  window.mpCycleRepeat = function () {
    const modes = ['none', 'all', 'one'];
    MP.repeat = modes[(modes.indexOf(MP.repeat) + 1) % modes.length];
    updatePlayerUI();
    termPrint('output', `[Music] Repeat: ${MP.repeat}`);
  };

  window.mpRemoveTrack = function (trackIdx, e) {
    e && e.stopPropagation();
    if (trackIdx === MP.currentIdx) {
      MP.audio.pause();
      MP.playing = false;
      MP.currentIdx = -1;
    }
    URL.revokeObjectURL(MP.tracks[trackIdx].url);
    MP.tracks.splice(trackIdx, 1);
    // Rebuild playlists indices
    MP.playlists.forEach(pl => {
      pl.indices = pl.indices
        .filter(i => i !== trackIdx)
        .map(i => i > trackIdx ? i - 1 : i);
    });
    if (MP.currentIdx > trackIdx) MP.currentIdx--;
    renderTrackList();
    updatePlayerUI();
  };

  /* ── Playlists ── */
  window.mpCreatePlaylist = function () {
    const name = prompt('Playlist name:');
    if (!name || !name.trim()) return;
    MP.playlists.push({ name: name.trim(), indices: [] });
    renderPlaylistBar();
    termPrint('output', `[Music] Playlist created: ${name.trim()}`);
  };

  window.mpSwitchPlaylist = function (idx, btn) {
    MP.activePl = idx;
    document.querySelectorAll('.mp-playlist-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderTrackList();
  };

  function renderPlaylistBar() {
    const bar = document.getElementById('mp-playlist-bar');
    if (!bar) return;
    bar.innerHTML = '';
    MP.playlists.forEach((pl, i) => {
      const tab = document.createElement('div');
      tab.className = 'mp-playlist-tab' + (i === MP.activePl ? ' active' : '');
      tab.dataset.pl = i;
      tab.textContent = pl.name;
      tab.onclick = () => mpSwitchPlaylist(i, tab);
      if (i > 0) {
        const del = document.createElement('span');
        del.className = 'mp-pl-del';
        del.textContent = '×';
        del.title = 'Delete playlist';
        del.onclick = ev => { ev.stopPropagation(); mpDeletePlaylist(i); };
        tab.appendChild(del);
      }
      bar.appendChild(tab);
    });
  }

  window.mpDeletePlaylist = function (idx) {
    if (idx === 0) return;
    MP.playlists.splice(idx, 1);
    // Adjust active playlist index so it continues to refer to the same logical playlist
    if (MP.activePl === idx) {
      // If the active playlist was deleted, reset to the base playlist
      MP.activePl = 0;
    } else if (MP.activePl > idx) {
      // If a playlist before the active one was deleted, shift active index left
      MP.activePl -= 1;
    }
    // Ensure active index is within bounds
    if (MP.activePl >= MP.playlists.length) MP.activePl = 0;
    renderPlaylistBar();
    renderTrackList();
  };

  window.mpAddCurrentToPlaylist = function (plIdx, trackIdx) {
    const tIdx = trackIdx != null ? trackIdx : MP.currentIdx;
    if (tIdx === -1) { termPrint('warn', '[Music] No track to add'); return; }
    const pl = MP.playlists[plIdx];
    if (!pl || pl.indices.includes(tIdx)) return;
    pl.indices.push(tIdx);
    renderTrackList();
    termPrint('output', `[Music] Added to "${pl.name}"`);
  };

  /* ── Context-menu: right-click track to add to playlist ── */
  document.addEventListener('contextmenu', e => {
    const item = e.target.closest('.mp-track-item');
    if (!item) return;
    e.preventDefault();
    if (MP.playlists.length <= 1) {
      termPrint('output', '[Music] Create a playlist first (click ➕)');
      return;
    }
    const idx = parseInt(item.dataset.trackIdx) || 0;
    const userInput = prompt('Add to playlist (enter number):\n' +
      MP.playlists.slice(1).map((p, i) => `${i + 1}. ${p.name}`).join('\n'));
    const num = parseInt(userInput);
    if (!isNaN(num) && num >= 1 && num < MP.playlists.length) {
      mpAddCurrentToPlaylist(num, idx);
    }
  });

  /* ── renderPlaylistBar is now called directly in mpLoadFolder ── */
}());

/* ═══════════════ ENHANCED SETTINGS ═════════════════════════════════ */
(function () {
  /* ── Session Tracking ── */
  ApexState.session = {
    startTime: Date.now(),
    linesWritten: 0,
    saves: 0,
  };

  function updateSessionUI() {
    const dur = Math.floor((Date.now() - ApexState.session.startTime) / 60000);
    const el = id => document.getElementById(id);
    const start = new Date(ApexState.session.startTime);
    if (el('si-start')) el('si-start').textContent = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (el('si-duration')) el('si-duration').textContent = dur < 60 ? `${dur}m` : `${Math.floor(dur / 60)}h ${dur % 60}m`;
    if (el('si-lines')) el('si-lines').textContent = ApexState.session.linesWritten;
    if (el('si-saves')) el('si-saves').textContent = ApexState.session.saves;
  }

  setInterval(updateSessionUI, 15000);

  window.resetSession = function () {
    ApexState.session = { startTime: Date.now(), linesWritten: 0, saves: 0 };
    updateSessionUI();
    termPrint('output', '[Settings] Session stats reset');
  };

  // Track saves
  const _origSaveFile = window.saveFile;
  window.saveFile = function () {
    ApexState.session.saves++;
    return _origSaveFile?.apply(this, arguments);
  };

  /* ── Auto-save ── */
  let _autoSaveTimer = null;
  ApexState.settings = ApexState.settings || {};
  ApexState.settings.autoSave = true;
  ApexState.settings.autoSaveDelay = 1000;

  window.toggleAutoSave = function (on) {
    ApexState.settings.autoSave = on;
    termPrint('output', `[Settings] Auto-save: ${on ? 'ON' : 'OFF'}`);
  };

  window.setAutoSaveDelay = function (ms) {
    ApexState.settings.autoSaveDelay = parseInt(ms) || 1000;
  };

  function scheduleAutoSave() {
    if (!ApexState.settings.autoSave) return;
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
      if (ApexState.monacoEditor && ApexState.activeTab !== 'welcome') {
        saveFile();
        log('[INFO] Auto-saved');
      }
    }, ApexState.settings.autoSaveDelay);
  }

  // Hook Monaco content change for auto-save via polling (Monaco is loaded asynchronously)
  const _monacoInterval = setInterval(() => {
    if (ApexState.monacoEditor) {
      clearInterval(_monacoInterval);
      ApexState.monacoEditor.onDidChangeModelContent((e) => {
        let deltaLines = 0;
        if (e && Array.isArray(e.changes)) {
          e.changes.forEach((change) => {
            const linesAdded = change.text ? change.text.split('\n').length - 1 : 0;
            const linesRemoved = change.range
              ? change.range.endLineNumber - change.range.startLineNumber
              : 0;
            deltaLines += linesAdded - linesRemoved;
          });
        }
        if (deltaLines < 0) {
          // Only track lines written; ignore pure deletions in this metric.
          deltaLines = 0;
        }
        ApexState.session.linesWritten += deltaLines;
        scheduleAutoSave();
      });
    }
  }, 500);

  /* ── Zen Mode ── */
  ApexState.settings.zenMode = false;
  window.toggleZenMode = function (on) {
    ApexState.settings.zenMode = on;
    document.body.classList.toggle('zen-mode', on);
    termPrint('output', `[Settings] Zen Mode: ${on ? 'ON' : 'OFF'}`);
  };

  /* ── Pomodoro Timer ── */
  let _pomodoroTimer = null;
  let _pomodoroRemaining = 0;
  let _pomodoroPhase = 'work';

  window.togglePomodoro = function (on) {
    const status = document.getElementById('pomodoro-status');
    if (status) status.style.display = on ? '' : 'none';
    if (on) { startPomodoro(); }
    else { clearInterval(_pomodoroTimer); _pomodoroTimer = null; }
  };

  function startPomodoro() {
    const workMins  = parseInt(document.getElementById('settings-pomodoro-work')?.value || 25);
    const breakMins = parseInt(document.getElementById('settings-pomodoro-break')?.value || 5);
    _pomodoroPhase = 'work';
    _pomodoroRemaining = workMins * 60;
    clearInterval(_pomodoroTimer);
    _pomodoroTimer = setInterval(() => {
      _pomodoroRemaining--;
      const m = Math.floor(_pomodoroRemaining / 60);
      const s = _pomodoroRemaining % 60;
      const clockEl = document.getElementById('pomodoro-clock');
      const phaseEl = document.getElementById('pomodoro-phase');
      if (clockEl) clockEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      if (_pomodoroRemaining <= 0) {
        if (_pomodoroPhase === 'work') {
          _pomodoroPhase = 'break';
          _pomodoroRemaining = breakMins * 60;
          if (phaseEl) phaseEl.textContent = '☕ Break';
          termPrint('output', '[Pomodoro] 🍅 Work session done! Take a break.');
          if (ApexState.settings.notificationsEnabled) {
          try { new Notification('APEX IDE', { body: 'Pomodoro work session done! Take a break. ☕' }); } catch (_) {}
          }
        } else {
          _pomodoroPhase = 'work';
          _pomodoroRemaining = workMins * 60;
          if (phaseEl) phaseEl.textContent = '🍅 Work';
          termPrint('output', '[Pomodoro] ☕ Break done! Back to work.');
        }
      }
    }, 1000);
  }

  window.resetPomodoro = function () {
    clearInterval(_pomodoroTimer);
    _pomodoroTimer = null;
    const cb = document.getElementById('settings-pomodoro');
    if (cb) cb.checked = false;
    const status = document.getElementById('pomodoro-status');
    if (status) status.style.display = 'none';
    termPrint('output', '[Pomodoro] Reset');
  };

  /* ── Notifications ── */
  ApexState.settings.notificationsEnabled = false;
  ApexState.settings.soundsEnabled = true;

  window.toggleNotifications = function (on) {
    if (!('Notification' in window)) {
      const cb = document.getElementById('settings-notifs');
      if (cb) cb.checked = false;
      termPrint('warn', '[Settings] Desktop notifications not supported in this browser');
      return;
    }
    if (on && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        ApexState.settings.notificationsEnabled = p === 'granted';
        const cb = document.getElementById('settings-notifs');
        if (cb) cb.checked = ApexState.settings.notificationsEnabled;
      });
    } else {
      ApexState.settings.notificationsEnabled = on && Notification.permission === 'granted';
    }
  };

  window.toggleSounds = function (on) {
    ApexState.settings.soundsEnabled = on;
    termPrint('output', `[Settings] Sound effects: ${on ? 'ON' : 'OFF'}`);
  };

  ApexState.settings.aiChimeEnabled = true;
  window.toggleAIChime = function (on) {
    ApexState.settings.aiChimeEnabled = on;
  };

  /* ── Play a brief Web-Audio chime ── */
  window.playChime = function () {
    if (!ApexState.settings.soundsEnabled || !ApexState.settings.aiChimeEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => ctx.close();
    } catch (_) {}
  };

  /* ── Clear All Settings ── */
  window.clearAllSettings = function () {
    if (!confirm('Clear all APEX settings and reset? This cannot be undone.')) return;
    localStorage.removeItem('apex_state');
    localStorage.removeItem('apex_onboarded');
    localStorage.removeItem('apex_chat_history');
    localStorage.removeItem('apex_file_buffers');
    localStorage.removeItem('apex_theme');
    location.reload();
  };

  /* ── Session update on settings open ── */
  const _origSwitchActivity = window.switchActivity;
  window.switchActivity = function (name, btn) {
    const result = _origSwitchActivity(name, btn);
    if (name === 'settings') updateSessionUI();
    return result;
  };
}());

/* ─── Toast Notification System ────────────────────────────────────── */
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✓', warn: '⚠', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);
  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ─── Theme Switching ─────────────────────────────────────────────── */
const THEMES = {
  'hiphop-dark': {
    '--bg-primary': '#0d0d0f', '--bg-secondary': '#141418', '--bg-tertiary': '#1c1c22',
    '--bg-hover': '#22222a', '--bg-active': '#2a2a36', '--accent-gold': '#f5c518',
    '--accent-pink': '#ff2d78', '--accent-cyan': '#00e5ff', '--accent-purple': '#9b59ff',
    '--text-primary': '#f0f0f5', '--text-secondary': '#9999aa', '--text-muted': '#555566',
    '--border': '#2a2a36', '--border-bright': '#44445a',
    monacoTheme: 'apex-dark',
  },
  'midnight-blue': {
    '--bg-primary': '#0a0e1a', '--bg-secondary': '#111827', '--bg-tertiary': '#1e293b',
    '--bg-hover': '#253049', '--bg-active': '#334155', '--accent-gold': '#60a5fa',
    '--accent-pink': '#f472b6', '--accent-cyan': '#22d3ee', '--accent-purple': '#a78bfa',
    '--text-primary': '#f1f5f9', '--text-secondary': '#94a3b8', '--text-muted': '#475569',
    '--border': '#1e293b', '--border-bright': '#334155',
    monacoTheme: 'vs-dark',
  },
  'solarized-dark': {
    '--bg-primary': '#002b36', '--bg-secondary': '#073642', '--bg-tertiary': '#0a4050',
    '--bg-hover': '#0d4f60', '--bg-active': '#115e70', '--accent-gold': '#b58900',
    '--accent-pink': '#d33682', '--accent-cyan': '#2aa198', '--accent-purple': '#6c71c4',
    '--text-primary': '#fdf6e3', '--text-secondary': '#93a1a1', '--text-muted': '#586e75',
    '--border': '#073642', '--border-bright': '#586e75',
    monacoTheme: 'vs-dark',
  },
  'light': {
    '--bg-primary': '#ffffff', '--bg-secondary': '#f5f5f5', '--bg-tertiary': '#e8e8e8',
    '--bg-hover': '#dcdcdc', '--bg-active': '#d0d0d0', '--accent-gold': '#d97706',
    '--accent-pink': '#db2777', '--accent-cyan': '#0891b2', '--accent-purple': '#7c3aed',
    '--text-primary': '#1a1a1a', '--text-secondary': '#555555', '--text-muted': '#999999',
    '--border': '#e0e0e0', '--border-bright': '#cccccc',
    monacoTheme: 'vs',
  },
};

/* ─── Global Hotkeys ──────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'p') { e.preventDefault(); openCommandPalette(); return; }
  if (ctrl && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').style.display = document.getElementById('sidebar').style.display === 'none' ? '' : 'none'; return; }
  if (ctrl && e.key === '`') { e.preventDefault(); document.getElementById('bottom-panel').style.display = document.getElementById('bottom-panel').style.display === 'none' ? '' : 'none'; document.getElementById('terminal-input')?.focus(); return; }
  if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); switchActivity('explorer'); return; }
  if (ctrl && e.shiftKey && e.key === 'F') { e.preventDefault(); switchActivity('search'); return; }
  if (ctrl && e.shiftKey && e.key === 'G') { e.preventDefault(); switchActivity('git'); return; }
  if (ctrl && e.shiftKey && e.key === 'C') { e.preventDefault(); switchActivity('cli'); return; }
  if (ctrl && e.shiftKey && e.key === 'M') { e.preventDefault(); switchActivity('mcp'); return; }
  if (ctrl && e.shiftKey && e.key === 'L') { e.preventDefault(); switchActivity('logic-mode'); return; }
  if (ctrl && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); openVisualizerTab(); return; }
  if (ctrl && e.shiftKey && e.key === 'J') { e.preventDefault(); switchActivity('chat'); return; }
  if (ctrl && e.key === 'm' && !e.shiftKey) { e.preventDefault(); switchActivity('music-player'); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveFile(); return; }
  if (ctrl && e.key === 'g') { e.preventDefault(); goToLine(); return; }
  if (ctrl && e.key === 'f' && !e.shiftKey) { e.preventDefault(); if (ApexState.monacoEditor) ApexState.monacoEditor.trigger('keyboard', 'actions.find', null); return; }
  if (ctrl && e.key === 'h') { e.preventDefault(); if (ApexState.monacoEditor) ApexState.monacoEditor.trigger('keyboard', 'editor.action.startFindReplaceAction', null); return; }
  if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); return; }
  if (ctrl && e.key === 'z' && e.shiftKey) { e.preventDefault(); redoAction(); return; }
  if (ctrl && e.key === 'y') { e.preventDefault(); redoAction(); return; }
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
  // Restore file buffers from localStorage
  try {
    const savedBuffers = localStorage.getItem('apex_file_buffers');
    if (savedBuffers) ApexState.fileBuffers = JSON.parse(savedBuffers) || {};
  } catch (_) {}

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

/* ─── Drag & Drop File Import ─────────────────────────────────────── */
(function () {
  let _dragOverlay = null;
  let _dragCount = 0;

  document.addEventListener('dragenter', e => {
    e.preventDefault();
    _dragCount++;
    if (_dragCount === 1 && !_dragOverlay) {
      _dragOverlay = document.createElement('div');
      _dragOverlay.className = 'drag-overlay';
      const overlayText = document.createElement('div');
      overlayText.className = 'drag-overlay-text';
      overlayText.textContent = 'DROP FILES TO IMPORT';
      _dragOverlay.appendChild(overlayText);
      document.body.appendChild(_dragOverlay);
    }
  });

  document.addEventListener('dragleave', e => {
    e.preventDefault();
    _dragCount--;
    if (_dragCount <= 0) {
      _dragCount = 0;
      if (_dragOverlay) { _dragOverlay.remove(); _dragOverlay = null; }
    }
  });

  document.addEventListener('dragover', e => e.preventDefault());

  document.addEventListener('drop', e => {
    e.preventDefault();
    _dragCount = 0;
    if (_dragOverlay) { _dragOverlay.remove(); _dragOverlay = null; }

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    let importedCount = 0;
    Array.from(files).forEach(file => {
      // Skip binary/large files
      if (file.size > MAX_IMPORT_FILE_SIZE) { showToast(`Skipped ${file.name} (too large)`, 'warn'); return; }
      const exists = SAMPLE_TREE.some(n => n.name === file.name);
      if (exists) { showToast(`${file.name} already exists`, 'warn'); return; }

      const reader = new FileReader();
      reader.onload = () => {
        const node = { name: file.name, type: 'file', depth: 0, lang: 'javascript' };
        SAMPLE_TREE.push(node);
        const fileId = getFileId(file.name);
        ApexState.fileBuffers[fileId] = reader.result;
        renderFileTree();
        importedCount++;
        showToast(`Imported: ${file.name}`, 'success');
      };
      reader.readAsText(file);
    });
  });
}());

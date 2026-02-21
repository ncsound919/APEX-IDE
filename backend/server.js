/* ═══════════════════════════════════════════════════════════════════════
   APEX IDE — Backend Server
   Provides real filesystem, git, terminal, command execution, and
   LLM proxy so the IDE is a true industry tool — not just a text editor.

   Start with:  node server.js  (from this directory)
                PORT env var controls the port (default: 3001)
                APEX_ROOT env var controls the project root (default: cwd)
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

const express     = require('express');
const cors        = require('cors');
const http        = require('http');
const WebSocket   = require('ws');
const { spawn }   = require('child_process');
const path        = require('path');
const fs          = require('fs');
const https       = require('https');
const os          = require('os');
const crypto      = require('crypto');
const rateLimit   = require('express-rate-limit');

/* ─── Config ─────────────────────────────────────────────────────────── */
const PORT              = parseInt(process.env.PORT || process.env.APEX_PORT || '3001', 10);
const APEX_ROOT         = process.env.APEX_ROOT
  ? path.resolve(process.env.APEX_ROOT)
  : path.resolve(process.cwd(), '..');   // default: parent of backend/ = project root
const MAX_FILE_SIZE_BYTES    = 5 * 1024 * 1024;  // 5 MB
const PROXY_MAX_RESP_BYTES   = 10 * 1024 * 1024; // 10 MB — prevents memory exhaustion from large LLM responses
const TERMINAL_IDLE_MS       = 30 * 60 * 1000;   // 30 minutes idle → close terminal session

/* ─── Rate Limiters ───────────────────────────────────────────────────── */
// Local-only server — high limits prevent runaway automation while staying
// transparent to normal IDE usage.
const fsLimiter = rateLimit({
  windowMs: 60_000,  // 1 minute
  max: 300,          // 300 filesystem requests/minute per IP
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many filesystem requests — slow down' },
});

const execLimiter = rateLimit({
  windowMs: 60_000,  // 1 minute
  max: 60,           // 60 exec/lint requests per minute per IP
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many execution requests — slow down' },
});

/* ─── Helpers ─────────────────────────────────────────────────────────── */

/** Resolve a user-supplied relative path safely within APEX_ROOT. */
function safeResolve(rel) {
  if (!rel) return APEX_ROOT;
  const resolved = path.resolve(APEX_ROOT, rel);
  // path.relative is cross-platform and handles mixed separators / UNC paths
  const relative = path.relative(APEX_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const err = new Error('Path escapes project root');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return resolved;
}

/** Run a git command in the given directory and return stdout. */
function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: cwd || APEX_ROOT });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0 && err.trim()) return reject(new Error(err.trim()));
      resolve((out.trim() || err.trim()) || '');
    });
    proc.on('error', reject);
  });
}

/** Build a sanitized environment for child processes, filtering out
 *  variables that look like they may contain secrets.
 */
function buildSafeEnv(baseEnv) {
  const safeEnv = { ...baseEnv };
  const sensitivePatterns = [
    /key/i,
    /secret/i,
    /token/i,
    /password/i,
    /passwd/i,
    /pwd/i,
    /credential/i,
    /^AWS_/i,
    /^GCP_/i,
    /^AZURE_/i,
  ];

  for (const name of Object.keys(safeEnv)) {
    if (sensitivePatterns.some(re => re.test(name))) {
      delete safeEnv[name];
    }
  }

  // Preserve existing behavior of disabling color in child processes.
  safeEnv.FORCE_COLOR = '0';
  return safeEnv;
}

/** Execute an arbitrary shell command and collect output. */
function runExec(cmd, cwd, timeout) {
  return new Promise((resolve, reject) => {
    const shell  = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const flag   = process.platform === 'win32' ? '/c' : '-c';
    const env    = buildSafeEnv(process.env);
    const proc   = spawn(shell, [flag, cmd], {
      cwd: cwd || APEX_ROOT,
      env,
    });

    let out = '', err = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out'));
    }, timeout || 30000);

    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ output: out, error: err, exitCode: code });
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

/* ─── HTTP Proxy helper (for LLM API calls) ──────────────────────────── */
function proxyPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const options  = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers,
    };
    const bodyStr = JSON.stringify(body);
    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      const chunks = [];
      let bytesReceived = 0;
      res.on('data', d => {
        bytesReceived += d.length;
        if (bytesReceived > PROXY_MAX_RESP_BYTES) {
          // Reject the promise so the caller's catch block sends a 502 to the client
          reject(new Error(`Proxy response exceeded size limit (${PROXY_MAX_RESP_BYTES} bytes)`));
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/* ─── Walk directory tree ─────────────────────────────────────────────── */
function walkTree(dir, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return []; }

  return entries
    .filter(e => !e.name.startsWith('.') || e.name === '.gitignore')
    .map(e => {
      const full = path.join(dir, e.name);
      const rel  = path.relative(APEX_ROOT, full);
      if (e.isDirectory()) {
        return {
          name:     e.name,
          type:     'folder',
          path:     rel,
          children: walkTree(full, depth + 1, maxDepth),
        };
      }
      return { name: e.name, type: 'file', path: rel };
    });
}

/* ─── Express App ─────────────────────────────────────────────────────── */
const app = express();
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no Origin header (e.g., curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '10mb' }));

/* ── Workspace Telemetry & Metrics ── */
const _telemetry = {
  startTime:     Date.now(),
  fileOps:       0,
  execOps:       0,
  llmRequests:   0,
  searchQueries: 0,
  traces:        [],  // ring buffer, max 100
};

// Register telemetry middleware BEFORE routes so every request is counted
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/files'))  _telemetry.fileOps++;
  if (req.path.startsWith('/api/exec'))   _telemetry.execOps++;
  if (req.path.startsWith('/api/llm'))    _telemetry.llmRequests++;
  if (req.path.startsWith('/api/search')) _telemetry.searchQueries++;
  if (_telemetry.traces.length >= 100) _telemetry.traces.shift();
  _telemetry.traces.push({ ts: Date.now(), method: req.method, path: req.path });
  next();
});

/* ── Health ── */
app.get('/api/health', (_req, res) => {
  res.json({
    status:  'ok',
    version: '1.0.0',
    root:    APEX_ROOT,
    node:    process.version,
    platform: os.platform(),
  });
});

/* ── File System ── */
app.get('/api/files', fsLimiter, (req, res) => {
  try {
    const dir      = safeResolve(req.query.path);
    const maxDepth = req.query.depth ? Math.min(parseInt(req.query.depth, 10) || 3, 8) : 3;
    const tree     = walkTree(dir, 0, maxDepth);
    res.json({ tree, root: path.relative(APEX_ROOT, dir) || '.' });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

app.get('/api/files/read', fsLimiter, (req, res) => {
  try {
    const filePath = safeResolve(req.query.path);
    const stat     = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({ error: 'File too large (>5 MB)' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: stat.size, mtime: stat.mtimeMs });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/files/write', fsLimiter, (req, res) => {
  try {
    const { path: rel, content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    const filePath = safeResolve(rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true, path: rel, size: Buffer.byteLength(content) });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/files/create', fsLimiter, (req, res) => {
  try {
    const { path: rel, type } = req.body;
    const fullPath = safeResolve(rel);
    if (type === 'folder') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, '', 'utf8');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

app.delete('/api/files', fsLimiter, (req, res) => {
  try {
    const filePath = safeResolve(req.body.path);
    fs.rmSync(filePath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

app.post('/api/files/rename', fsLimiter, (req, res) => {
  try {
    const from = safeResolve(req.body.from);
    const to   = safeResolve(req.body.to);
    fs.renameSync(from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

/* ── Git ── */
app.get('/api/git/status', fsLimiter, async (_req, res) => {
  try {
    const [status, branch] = await Promise.all([
      runGit(['status', '--short']),
      runGit(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
    ]);
    res.json({ output: status, branch });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/git/log', fsLimiter, async (req, res) => {
  try {
    const n      = Math.min(parseInt(req.query.n, 10) || 20, 100);
    const output = await runGit(['log', `--oneline`, `-${n}`, '--decorate']);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/git/diff', fsLimiter, async (req, res) => {
  try {
    const file   = req.query.file ? ['--', safeResolve(req.query.file)] : [];
    const staged = req.query.staged === '1';
    const args   = staged ? ['diff', '--staged', ...file] : ['diff', ...file];
    const output = await runGit(args);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/git/branches', fsLimiter, async (_req, res) => {
  try {
    const output = await runGit(['branch', '-a']);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/git/commit', fsLimiter, async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.trim()) return res.status(400).json({ error: 'Commit message required' });
    await runGit(['add', '-A']);
    const output = await runGit(['commit', '-m', msg.trim()]);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/git/pull', fsLimiter, async (_req, res) => {
  try {
    const output = await runGit(['pull']);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/git/push', fsLimiter, async (_req, res) => {
  try {
    const output = await runGit(['push']);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Conservative validation for git branch/ref names coming from the client.
// Allows alphanumerics, dot, underscore, hyphen, and forward slash, and
// disallows names starting with '-' to avoid option-style injection.
function isSafeGitRef(ref) {
  if (typeof ref !== 'string') return false;
  if (!ref.length) return false;
  if (ref.startsWith('-')) return false;
  return /^[A-Za-z0-9._\/-]+$/.test(ref);
}

app.post('/api/git/branch', fsLimiter, async (req, res) => {
  try {
    const rawName = req.body.name;
    const name = rawName && rawName.trim();
    if (!name) return res.status(400).json({ error: 'Branch name required' });
    if (!isSafeGitRef(name)) {
      return res.status(400).json({ error: 'Invalid branch name' });
    }
    const output = await runGit(['checkout', '-b', name]);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/git/checkout', fsLimiter, async (req, res) => {
  try {
    const rawBranch = req.body.branch;
    const branch = rawBranch && rawBranch.trim();
    if (!branch) return res.status(400).json({ error: 'Branch name required' });
    if (!isSafeGitRef(branch)) {
      return res.status(400).json({ error: 'Invalid branch name' });
    }
    const output = await runGit(['checkout', branch]);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

/* ── Command Execution ── */
app.post('/api/exec', execLimiter, async (req, res) => {
  try {
    const { command, cwd, timeout } = req.body;
    if (!command || !command.trim()) return res.status(400).json({ error: 'command required' });

    // Resolve working directory within project root
    let workDir = APEX_ROOT;
    if (cwd) {
      try { workDir = safeResolve(cwd); } catch (_) { workDir = APEX_ROOT; }
    }

    const result = await runExec(command.trim(), workDir, timeout);
    res.json(result);
  } catch (err) {
    res.status(err.message === 'Command timed out' ? 408 : 400).json({ error: err.message });
  }
});

/* ── LLM Proxy ── */
app.post('/api/llm/proxy', fsLimiter, async (req, res) => {
  try {
    const { provider, model, messages, system, apiKey, ollamaEndpoint } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    let result;

    if (provider === 'openai' || (model || '').startsWith('gpt') || (model || '').startsWith('o1') || (model || '').startsWith('o3')) {
      const key = apiKey;
      if (!key) return res.status(401).json({ error: 'OpenAI API key required' });
      const body = { model: model || 'gpt-4o', messages, max_tokens: 4096 };
      if (system) body.messages = [{ role: 'system', content: system }, ...messages];
      result = await proxyPost('https://api.openai.com/v1/chat/completions', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      }, body);
    } else if (provider === 'anthropic' || (model || '').startsWith('claude')) {
      const key = apiKey;
      if (!key) return res.status(401).json({ error: 'Anthropic API key required' });
      const body = { model: model || 'claude-3-5-sonnet-20241022', messages, max_tokens: 4096 };
      if (system) body.system = system;
      result = await proxyPost('https://api.anthropic.com/v1/messages', {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      }, body);
    } else if (provider === 'deepseek' || (model || '').startsWith('deepseek')) {
      const key = apiKey;
      if (!key) return res.status(401).json({ error: 'DeepSeek API key required' });
      const body = { model: model || 'deepseek-coder', messages, max_tokens: 4096 };
      if (system) body.messages = [{ role: 'system', content: system }, ...messages];
      result = await proxyPost('https://api.deepseek.com/v1/chat/completions', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      }, body);
    } else {
      // Ollama — forward to local endpoint
      const defaultOllamaEndpoint = 'http://127.0.0.1:11434';
      let endpoint = defaultOllamaEndpoint;

      if (ollamaEndpoint) {
        try {
          const parsed = new URL(ollamaEndpoint);
          const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
          const allowedProtocols = new Set(['http:', 'https:']);

          if (!allowedProtocols.has(parsed.protocol)) {
            throw new Error('Disallowed protocol for Ollama endpoint');
          }

          if (!allowedHosts.has(parsed.hostname)) {
            throw new Error('Disallowed host for Ollama endpoint');
          }

          // Use only the origin (protocol + host + optional port), ignore any user path/query.
          endpoint = parsed.origin;
        } catch (e) {
          // On any parse/validation error, fall back to the default local endpoint.
          endpoint = defaultOllamaEndpoint;
        }
      }
      const ollamaURL = new URL('/api/chat', endpoint);
      result = await proxyPost(ollamaURL.toString(), {
        'Content-Type': 'application/json',
      }, { model: model || 'llama3', messages, stream: false });
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
});

/* ── Lint endpoint ── */
app.post('/api/lint', execLimiter, async (req, res) => {
  try {
    const { code, language } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });

    // Write to a temp file and run appropriate linter
    const ext  = { javascript: '.js', typescript: '.ts', python: '.py' }[language] || '.js';
    const tmp  = path.join(os.tmpdir(), `apex-lint-${crypto.randomUUID()}${ext}`);
    fs.writeFileSync(tmp, code, 'utf8');

    let linter, args;
    if (language === 'python') {
      linter = 'python3';
      args   = ['-m', 'py_compile', tmp];
    } else {
      // Default: node syntax check
      linter = 'node';
      args   = ['--check', tmp];
    }

    // Guard against multiple response sends if both 'close' and 'error' fire
    let responded = false;
    function tryCleanup() {
      try { fs.unlinkSync(tmp); } catch (e) {
        console.warn(`[Lint] Failed to remove temp file ${tmp}:`, e.message);
      }
    }

    const proc = spawn(linter, args);
    let errOut = '';
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('close', code => {
      if (responded) return;
      responded = true;
      tryCleanup();
      if (code === 0) {
        res.json({ ok: true, problems: [] });
      } else {
        res.json({ ok: false, problems: [{ message: errOut.trim(), severity: 'error' }] });
      }
    });
    proc.on('error', e => {
      if (responded) return;
      responded = true;
      tryCleanup();
      res.json({ ok: true, problems: [], warn: `Linter unavailable: ${e.message}` });
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ── Workspace Management ── */
const WORKSPACES = new Map();

function newWorkspaceId() {
  return crypto.randomUUID();
}

app.get('/api/workspaces', fsLimiter, (_req, res) => {
  res.json({ workspaces: Array.from(WORKSPACES.values()) });
});

app.post('/api/workspaces', fsLimiter, (req, res) => {
  const { name, repo_url, branch, compute_profile, container_config } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const id = newWorkspaceId();
  const workspace = {
    id,
    name: name.trim(),
    user_id: 'local',
    repo_url: repo_url || '',
    branch: branch || 'main',
    compute_profile: compute_profile || { cpu: 2, ram_gb: 4, gpu: false },
    container_config: container_config || { image: 'node:20-alpine', ports: [], env: {} },
    status: 'stopped',
    created_at: Date.now(),
    root: APEX_ROOT,
  };
  WORKSPACES.set(id, workspace);
  res.status(201).json(workspace);
});

app.get('/api/workspaces/:id', fsLimiter, (req, res) => {
  const ws = WORKSPACES.get(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(ws);
});

app.post('/api/workspaces/:id/start', execLimiter, (req, res) => {
  const ws = WORKSPACES.get(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const startTime = Date.now();
  ws.status = 'running';
  ws.started_at = startTime;
  WORKSPACES.set(ws.id, ws);
  res.json({ ok: true, workspace: ws, spin_up_time_ms: Date.now() - startTime });
});

app.post('/api/workspaces/:id/stop', execLimiter, (req, res) => {
  const ws = WORKSPACES.get(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  ws.status = 'stopped';
  ws.stopped_at = Date.now();
  WORKSPACES.set(ws.id, ws);
  res.json({ ok: true, workspace: ws });
});

app.delete('/api/workspaces/:id', fsLimiter, (req, res) => {
  if (!WORKSPACES.has(req.params.id)) return res.status(404).json({ error: 'Workspace not found' });
  WORKSPACES.delete(req.params.id);
  res.json({ ok: true });
});

/* ── Project Search & Indexing ── */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'coverage', '__pycache__']);
const SEARCH_MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/**
 * Lightweight ReDoS safety check: rejects patterns containing nested
 * quantifiers on groups/character-classes (e.g. `(a+)+`, `([ab]+)*`).
 * Returns true if the pattern appears safe to compile and run.
 */
function isSafeRegex(pattern) {
  // Reject patterns with nested quantifiers — the primary ReDoS source
  if (/(\(.*\+.*\)|\(.*\*.*\)|\[.*\+.*\]|\[.*\*.*\])[\+\*]/.test(pattern)) return false;
  // Reject excessively long patterns
  if (pattern.length > 200) return false;
  return true;
}

/** Search file contents recursively within APEX_ROOT */
function searchFiles(dir, query, opts, results, depth) {
  if (depth > 6 || results.length >= 200) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    const full = path.join(dir, e.name);
    const rel  = path.relative(APEX_ROOT, full);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) searchFiles(full, query, opts, results, depth + 1);
    } else {
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }

      let re = null;
      if (opts.regex) {
        // Reject patterns with ReDoS-prone constructs before compiling
        if (isSafeRegex(query)) {
          try { re = new RegExp(query, opts.matchCase ? 'g' : 'gi'); } catch (_) { continue; }
        } else {
          continue; // skip file rather than risk catastrophic backtracking
        }
      }

      const lines = content.split('\n');
      const matchLines = [];
      lines.forEach((line, i) => {
        let hit;
        if (re) {
          re.lastIndex = 0;
          hit = re.test(line);
        } else {
          hit = (opts.matchCase ? line : line.toLowerCase()).includes(
            opts.matchCase ? query : query.toLowerCase()
          );
        }
        if (hit) matchLines.push({ line: i + 1, text: line.slice(0, 200) });
      });
      if (matchLines.length > 0) {
        results.push({ file: rel, matches: matchLines.slice(0, 10), total: matchLines.length });
      }
    }
  }
}

app.get('/api/search', fsLimiter, (req, res) => {
  try {
    const { q, regex, matchCase } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'query required' });
    if (regex === '1') {
      if (!isSafeRegex(q.trim())) return res.status(400).json({ error: 'Regex pattern is too complex or potentially unsafe (ReDoS risk). Simplify the pattern.' });
      try { new RegExp(q.trim()); } catch (e) { return res.status(400).json({ error: `Invalid regex: ${e.message}` }); }
    }
    const opts = { regex: regex === '1', matchCase: matchCase === '1' };
    const results = [];
    searchFiles(APEX_ROOT, q.trim(), opts, results, 0);
    res.json({ query: q, results, count: results.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Extract symbols (functions, classes) from a file */
function extractSymbols(content, language) {
  const symbols = [];
  const patterns = {
    javascript: [
      { re: /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm,     kind: 'function' },
      { re: /(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/gm, kind: 'function' },
      { re: /(?:^|\s)class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,                            kind: 'class'    },
    ],
    typescript: [
      { re: /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/gm,   kind: 'function' },
      { re: /(?:^|\s)class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,                            kind: 'class'    },
      { re: /(?:^|\s)interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,                        kind: 'interface' },
      { re: /(?:^|\s)type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm,                         kind: 'type'     },
    ],
    python: [
      { re: /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm,   kind: 'function' },
      { re: /^class\s+([A-Za-z_][A-Za-z0-9_]*)/gm,       kind: 'class'    },
    ],
  };
  const lines = content.split('\n');
  const pats = patterns[language] || patterns.javascript;
  pats.forEach(({ re, kind }) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      symbols.push({ name, kind, line: lineNum, preview: (lines[lineNum - 1] || '').trim().slice(0, 100) });
    }
  });
  return symbols;
}

app.get('/api/symbols', fsLimiter, (req, res) => {
  try {
    const filePath = safeResolve(req.query.path);
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) return res.status(413).json({ error: 'File too large' });
    const content  = fs.readFileSync(filePath, 'utf8');
    const ext      = path.extname(filePath).slice(1).toLowerCase();
    const langMap  = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python' };
    const language = langMap[ext] || 'javascript';
    const symbols  = extractSymbols(content, language);
    res.json({ file: req.query.path, language, symbols });
  } catch (err) {
    res.status(err.code === 'FORBIDDEN' ? 403 : 400).json({ error: err.message });
  }
});

/* ── AI Task Orchestrator ── */
class BoundedMap extends Map {
  constructor(maxSize, entries) {
    super(entries);
    this.maxSize = typeof maxSize === 'number' && maxSize > 0 ? maxSize : Number.MAX_SAFE_INTEGER;
  }

  set(key, value) {
    if (!this.has(key) && this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }
    return super.set(key, value);
  }
}

const MAX_AI_TASKS = 1000;
const AI_TASKS = new BoundedMap(MAX_AI_TASKS);
const AI_TASK_SYSTEM_PROMPTS = {
  generate_code:    'You are an expert software engineer. Generate clean, well-documented, production-ready code based on the given requirements.',
  refactor_module:  'You are an expert software engineer. Refactor the provided code for better readability, performance, and maintainability. Explain key changes.',
  write_tests:      'You are an expert in software testing. Write comprehensive unit tests with clear descriptions and edge cases.',
  generate_docs:    'You are a technical writer. Generate clear, comprehensive documentation for the provided code.',
  debug_analysis:   'You are an expert debugger. Analyze the code for bugs, edge cases, and potential errors. Provide fixes.',
  security_scan:    'You are a security expert. Identify security vulnerabilities, injection risks, and unsafe patterns. Suggest remediation.',
  experiment_setup: 'You are a data scientist. Design an experiment setup with clear hypotheses, steps, and success metrics.',
};

app.get('/api/ai/tasks', fsLimiter, (_req, res) => {
  res.json({ tasks: Array.from(AI_TASKS.values()) });
});

app.post('/api/ai/tasks', execLimiter, async (req, res) => {
  try {
    const { task_type, context, provider, model, apiKey, ollamaEndpoint } = req.body;
    if (!task_type) return res.status(400).json({ error: 'task_type required' });
    if (!context)   return res.status(400).json({ error: 'context required' });

    const taskId = crypto.randomUUID();
    const task = {
      id: taskId,
      task_type,
      status: 'running',
      created_at: Date.now(),
      context: String(context).slice(0, 8000),
    };
    AI_TASKS.set(taskId, task);

    const systemPrompt = AI_TASK_SYSTEM_PROMPTS[task_type] || AI_TASK_SYSTEM_PROMPTS.generate_code;
    const messages = [{ role: 'user', content: String(context).slice(0, 8000) }];

    let proxyResult;
    try {
      const usedProvider = provider || 'openai';
      const usedModel = model || 'gpt-4o';

      if (usedProvider === 'anthropic' || usedModel.startsWith('claude')) {
        if (!apiKey) throw new Error('Anthropic API key required');
        proxyResult = await proxyPost('https://api.anthropic.com/v1/messages', {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }, { model: usedModel, messages, max_tokens: 4096, system: systemPrompt });
      } else if (usedProvider === 'deepseek' || usedModel.startsWith('deepseek')) {
        if (!apiKey) throw new Error('DeepSeek API key required');
        proxyResult = await proxyPost('https://api.deepseek.com/v1/chat/completions', {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        }, { model: usedModel, messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 4096 });
      } else if (usedProvider === 'ollama') {
        let base = 'http://127.0.0.1:11434';
        if (ollamaEndpoint) {
          try { base = new URL(ollamaEndpoint).origin; }
          catch (_) { throw new Error(`Invalid Ollama endpoint URL: "${ollamaEndpoint}". Expected format: http://localhost:11434`); }
        }
        proxyResult = await proxyPost(`${base}/api/chat`, { 'Content-Type': 'application/json' },
          { model: usedModel || 'llama3', messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: false });
      } else {
        if (!apiKey) throw new Error('OpenAI API key required');
        proxyResult = await proxyPost('https://api.openai.com/v1/chat/completions', {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        }, { model: usedModel, messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 4096 });
      }

      // Treat non-2xx HTTP responses from the LLM provider as task errors
      const httpOk = proxyResult.status >= 200 && proxyResult.status < 300;
      if (!httpOk) {
        task.status = 'error';
        task.completed_at = Date.now();
        task.duration_ms = task.completed_at - task.created_at;
        task.error = `LLM provider returned HTTP ${proxyResult.status}`;
        AI_TASKS.set(taskId, task);
        res.status(proxyResult.status).json({ task_id: taskId, task_type, status: 'error', error: task.error, result: proxyResult.body });
      } else {
        task.status = 'done';
        task.completed_at = Date.now();
        task.duration_ms = task.completed_at - task.created_at;
        task.result = proxyResult.body;
        AI_TASKS.set(taskId, task);
        res.status(proxyResult.status).json({ task_id: taskId, task_type, status: 'done', result: proxyResult.body });
      }
    } catch (llmErr) {
      task.status = 'error';
      task.error = llmErr.message;
      AI_TASKS.set(taskId, task);
      res.status(502).json({ task_id: taskId, status: 'error', error: llmErr.message });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/ai/tasks/:id', fsLimiter, (req, res) => {
  const task = AI_TASKS.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.get('/api/metrics', fsLimiter, (_req, res) => {
  const uptimeMs = Date.now() - _telemetry.startTime;
  const mem = process.memoryUsage();
  res.json({
    uptime_ms:       uptimeMs,
    uptime_s:        Math.floor(uptimeMs / 1000),
    file_ops:        _telemetry.fileOps,
    exec_ops:        _telemetry.execOps,
    llm_requests:    _telemetry.llmRequests,
    search_queries:  _telemetry.searchQueries,
    memory_heap_mb:  Math.round(mem.heapUsed / 1024 / 1024),
    memory_rss_mb:   Math.round(mem.rss / 1024 / 1024),
    workspace_count: WORKSPACES.size,
    ai_task_count:   AI_TASKS.size,
    node_version:    process.version,
    platform:        os.platform(),
  });
});

app.get('/api/traces', fsLimiter, (_req, res) => {
  res.json({ traces: _telemetry.traces.slice(-50) });
});

/* ─── HTTP Server + WebSocket Terminal ───────────────────────────────── */
const server = http.createServer(app);

/**
 * WebSocket terminal — each connection spawns a real shell session.
 * Messages to/from client: JSON  { type: 'input'|'output'|'error'|'exit', data: string }
 */
const wss = new WebSocket.Server({ server, path: '/ws/terminal' });

wss.on('connection', (ws) => {
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');
  const proc  = spawn(shell, [], {
    cwd: APEX_ROOT,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const send = (type, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  };

  // Idle timeout — close sessions that have been silent for TERMINAL_IDLE_MS
  let idleTimer = setTimeout(() => {
    send('error', '[Terminal] Session closed due to inactivity');
    ws.close();
  }, TERMINAL_IDLE_MS);

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send('error', '[Terminal] Session closed due to inactivity');
      ws.close();
    }, TERMINAL_IDLE_MS);
  }

  proc.stdout.on('data', d => { send('output', d.toString()); resetIdle(); });
  proc.stderr.on('data', d => { send('error',  d.toString()); resetIdle(); });
  proc.on('close', code => {
    clearTimeout(idleTimer);
    send('exit', `Process exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  proc.on('error', e => send('error', `Shell error: ${e.message}`));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input' && typeof msg.data === 'string') {
        resetIdle();
        proc.stdin.write(msg.data);
      } else if (msg.type === 'resize') {
        // node-pty resize would go here; no-op without node-pty
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    clearTimeout(idleTimer);
    try { proc.kill(); } catch (_) {}
  });
});

/* ─── Start ───────────────────────────────────────────────────────────── */
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n⬡  APEX IDE Backend — running on http://127.0.0.1:${PORT}`);
  console.log(`   Project root : ${APEX_ROOT}`);
  console.log(`   Node version : ${process.version}`);
  console.log(`   Platform     : ${os.platform()} ${os.arch()}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} already in use. Set PORT env var to use a different port.`);
  } else {
    console.error('[ERROR]', err.message);
  }
  process.exit(1);
});

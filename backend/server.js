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
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

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
  if (!resolved.startsWith(APEX_ROOT + path.sep) && resolved !== APEX_ROOT) {
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

/** Execute an arbitrary shell command and collect output. */
function runExec(cmd, cwd, timeout) {
  return new Promise((resolve, reject) => {
    const shell  = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const flag   = process.platform === 'win32' ? '/c' : '-c';
    const proc   = spawn(shell, [flag, cmd], {
      cwd: cwd || APEX_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
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
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
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
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

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
    const file   = req.query.file ? ['--', req.query.file] : [];
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

app.post('/api/git/branch', fsLimiter, async (req, res) => {
  try {
    const name = req.body.name;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Branch name required' });
    const output = await runGit(['checkout', '-b', name.trim()]);
    res.json({ output });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/git/checkout', fsLimiter, async (req, res) => {
  try {
    const branch = req.body.branch;
    if (!branch || !branch.trim()) return res.status(400).json({ error: 'Branch name required' });
    const output = await runGit(['checkout', branch.trim()]);
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
      const endpoint = (ollamaEndpoint || 'http://localhost:11434').replace(/\/$/, '');
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
    const { code, language, path: rel } = req.body;
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

    const proc = spawn(linter, args);
    let errOut = '';
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('close', code => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (code === 0) {
        res.json({ ok: true, problems: [] });
      } else {
        res.json({ ok: false, problems: [{ message: errOut.trim(), severity: 'error' }] });
      }
    });
    proc.on('error', e => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      res.json({ ok: true, problems: [], warn: `Linter unavailable: ${e.message}` });
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

  proc.stdout.on('data', d => send('output', d.toString()));
  proc.stderr.on('data', d => send('error',  d.toString()));
  proc.on('close', code => {
    send('exit', `Process exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  proc.on('error', e => send('error', `Shell error: ${e.message}`));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input' && typeof msg.data === 'string') {
        proc.stdin.write(msg.data);
      } else if (msg.type === 'resize') {
        // node-pty resize would go here; no-op without node-pty
      }
    } catch (_) {}
  });

  ws.on('close', () => {
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

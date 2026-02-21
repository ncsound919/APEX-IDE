# ⬡ APEX IDE — Megacode Edition

> **Where Code Meets Culture** — A hip-hop themed desktop IDE built from the `Desktop IDE` JSON specification.

![APEX IDE](https://img.shields.io/badge/APEX-IDE-f5c518?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMMyA3djEwbDkgNSA5LTVWN3oiIGZpbGw9IiNmNWM1MTgiLz48L3N2Zz4=)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

## Features

Built from the [`Desktop IDE`](Desktop%20IDE) JSON specification:

### 🏗️ Core Components
| Component | Description |
|-----------|-------------|
| **Window Manager** | Tiling/floating layout with split editor panes |
| **Terminal Emulator** | Multi-tab terminal with command history and Megacode session support |
| **File Browser** | Git-aware file tree with language icons |

### 🧠 Megacode Optimizations
| Panel | Description |
|-------|-------------|
| **LLM Router Panel** | Provider health dashboard, cache hit rates, token usage charts, one-click failover |
| **IDE Bridge Hub** | VSCode/Zed/Cursor/JetBrains bridge cards, quality score indicators |
| **Inspired Workflows** | Cursor Composer Flow, Antigravity Context Orbit, VSCode Command Brain, Windsurf Flow Mode |
| **Vibe Layer Dashboard** | Confidence/Intent scores (live), one-click fixes queue, undo stack visualizer, Rookie/Expert mode |

### 🎛️ Domain Adapters
- 🎵 **Music Production** — DAW plugin scaffolder, WebAudio preview, Beat script runner (Ollama/DeepSeek)
- 🧬 **Biotech** — PubChem/SMILES visualizer, Histotripsy sim console, MuTracker hook
- 🎨 **Graphic Novels / NFTs** — NFT mint preview, Panel layout editor, Gemini Vision storyboarding

### 💰 Monetization Panel
- Gumroad / Stripe revenue dashboard
- NFT Drop Scheduler
- Session stats for pro tiers

### ⚡ Performance
- `<2GB` target via lazy modules, virtual scrolling, no Docker
- SQLite-ready session architecture (offline-first)
- Multi-LLM token optimizer
- Offline-first with Ollama

### 🎨 UI/UX
- **Hip-hop culture theme** — Bold Bebas Neue fonts, comic gradients, boxing sim motifs
- **Vim-like hotkeys** — Customizable via settings
- **Onboarding wizard** — LLM key setup, project import (Overlay365/Cheetah)
- **Monaco Editor** — VSCode-grade code editing with APEX dark theme

## Quick Start

```bash
# Install dependencies
npm install

# Launch dev server (frontend only — simulation mode)
npm start
# → http://localhost:3000
```

Or just open `index.html` directly in a modern browser.

## Backend Server (Real Industry Power)

The optional backend server unlocks real execution — no more simulation:

| Feature | Without Backend | With Backend |
|---------|----------------|--------------|
| **Terminal** | Simulated commands | Real shell (bash/sh) via WebSocket |
| **File System** | Static demo tree | Real read/write/create/delete |
| **Git** | Fake output | Real git status/commit/pull/push/branch/log |
| **CLI Runner** | Simulated npm/vite | Real command execution |
| **Save File** | Log message only | Actually writes to disk |
| **LLM Proxy** | Direct browser fetch (CORS issues) | Proxied through backend (CORS-free) |
| **Code Lint** | None | Server-side syntax checking |

```bash
# Start backend (in a separate terminal)
npm run backend
# → APEX Backend running on http://127.0.0.1:3001

# Start frontend in another terminal
npm start
# → http://localhost:3000
```

The IDE auto-detects the backend on startup. The topbar badge shows **⬡ LIVE** when connected or **⬡ SIM** in simulation mode.

### Backend API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Server health & info |
| `GET` | `/api/files` | List directory tree |
| `GET` | `/api/files/read` | Read file content |
| `POST` | `/api/files/write` | Write file content |
| `POST` | `/api/files/create` | Create file or folder |
| `DELETE` | `/api/files` | Delete file or folder |
| `POST` | `/api/files/rename` | Rename/move file |
| `GET` | `/api/git/status` | Git working tree status |
| `GET` | `/api/git/log` | Recent commit history |
| `GET` | `/api/git/diff` | Diff of working tree |
| `POST` | `/api/git/commit` | Stage all and commit |
| `POST` | `/api/git/pull` | Pull from remote |
| `POST` | `/api/git/push` | Push to remote |
| `POST` | `/api/git/branch` | Create new branch |
| `POST` | `/api/exec` | Execute shell command |
| `POST` | `/api/llm/proxy` | Proxy LLM API calls |
| `POST` | `/api/lint` | Lint code server-side |
| `WS` | `/ws/terminal` | Real interactive terminal |

## Security Considerations

The APEX IDE backend exposes powerful operations, including:

- Arbitrary command execution via `/api/exec`
- Interactive terminal sessions via `/ws/terminal`
- Read/write access to the local filesystem and Git repositories

**This backend is intended _only_ for use in trusted, local development environments.**

- By default, the server binds to `localhost`, but this does **not** remove all risk.
- There is **no authentication** built in; any process or user on the same machine that can reach the port can issue requests.
- Do **not** expose the backend directly to the internet or to untrusted networks (e.g., via port forwarding, reverse proxies, or public cloud hosts) without adding your own strong authentication, authorization, and network controls.
- Avoid running the backend on multi-user or shared machines where untrusted users have access.
- Be aware that running the backend grants its process the same level of access to your files and system as the user account that started it.
- Terminal WebSocket sessions are automatically closed after **30 minutes of inactivity**.
- All file paths are sandboxed to the project root — no path traversal is permitted.
- All API routes are rate-limited (300 FS requests/min, 60 exec/lint requests/min).

Use this backend only when you understand and accept these risks. For production or shared environments, you should treat this code as a starting point and add appropriate security hardening (authentication, authorization, sandboxing, and network isolation).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command Palette |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+Shift+E` | Explorer |
| `Ctrl+Shift+F` | Search |
| `Ctrl+Shift+G` | Git |
| `Ctrl+S` | Save File |
| `Ctrl+\` | Split Editor |

## Architecture

```
APEX-IDE/
├── index.html          # Main entry point (all components)
├── src/
│   ├── styles.css      # Hip-hop theme (CSS variables + components)
│   └── app.js          # Application logic + ApexBackend client
├── backend/
│   ├── server.js       # Node.js backend (Express + WebSocket)
│   └── package.json    # Backend dependencies (express, cors, ws)
├── package.json        # npm config + frontend & backend scripts
└── Desktop IDE         # Original JSON specification
```

## Spec Reference

The IDE was built from the `Desktop IDE` file, which defines:
- Core components (window manager, terminal, file browser)
- Megacode optimizations (LLM router, IDE bridge, vibe layer)
- Project ecosystem support (domain adapters, monetization)
- Low-spec constraints (`<2GB` RAM, 460GB storage, lazy modules)
- UI/UX guidelines (hip-hop aesthetic, hotkeys, onboarding)

---

*APEX IDE — Toward the $500M Vision* 🚀

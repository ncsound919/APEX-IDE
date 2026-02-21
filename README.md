# ⬡ APEX IDE — Megacode Edition

> **Where Code Meets Culture** — A hip-hop themed desktop IDE built from the `Desktop IDE` JSON specification.

![APEX IDE](https://img.shields.io/badge/APEX-IDE-f5c518?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMMyA3djEwbDkgNSA5LTVWN3oiIGZpbGw9IiNmNWM1MTgiLz48L3N2Zz4=)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-2.0.0-9b59ff?style=for-the-badge)

## Features

Built from the [`Desktop IDE`](Desktop%20IDE) JSON specification:

### 🏗️ Core Components
| Component | Description |
|-----------|-------------|
| **Window Manager** | Tiling/floating layout with split editor panes |
| **Terminal Emulator** | Multi-tab terminal with 20+ built-in commands, history, and Megacode session support |
| **File Browser** | Git-aware file tree with language icons and drag-and-drop file import |
| **Monaco Editor** | VSCode-grade code editing with undo/redo, find/replace, and per-file buffer management |

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
- **4 color themes** — Hip-Hop Dark, Midnight Blue, Solarized Dark, and Light with persistent preference
- **Toast notifications** — Visual feedback for save, theme changes, and file import actions
- **Vim-like hotkeys** — Customizable via settings
- **Onboarding wizard** — LLM key setup, project import (Overlay365/Cheetah)
- **Monaco Editor** — VSCode-grade code editing with APEX dark theme

### 🆕 v2.0.0 Upgrades
| Feature | Description |
|---------|-------------|
| **Undo/Redo** | Connected to Monaco editor API (`Ctrl+Z` / `Ctrl+Shift+Z`) |
| **Find & Replace** | Triggers Monaco's built-in find widget (`Ctrl+F` / `Ctrl+H`) |
| **Real Search** | Actual text-matching search across file names and content (with regex/case-sensitive options) |
| **File Persistence** | File content saved to localStorage, preserved across sessions |
| **Per-file Buffers** | Editor content preserved when switching between tabs |
| **Theme System** | 4 switchable themes with CSS variables and Monaco integration |
| **Toast Notifications** | Visual toast notifications for key actions (save, theme, import) |
| **Drag & Drop Import** | Drag files onto the IDE to import into the file tree |
| **Extended Terminal** | 20+ commands: `cat`, `touch`, `mkdir`, `rm`, `history`, `date`, `env`, `theme`, etc. |

## Quick Start

```bash
# Install dependencies
npm install

# Launch dev server
npm start
# → http://localhost:3000
```

Or just open `index.html` directly in a modern browser.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command Palette |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+F` | Find in Editor |
| `Ctrl+H` | Find & Replace |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save File |
| `Ctrl+G` | Go to Line |
| `Ctrl+Shift+E` | Explorer |
| `Ctrl+Shift+F` | Search in Files |
| `Ctrl+Shift+G` | Git |
| `Ctrl+Shift+J` | AI Chat |
| `Ctrl+Shift+L` | Logic Mode |
| `Alt+E` | AI: Explain Code |
| `Alt+R` | AI: Refactor |
| `Alt+T` | AI: Write Tests |
| `Alt+F` | AI: Fix Errors |
| `Shift+Alt+F` | Format Document |

## Terminal Commands

| Command | Description |
|---------|-------------|
| `help` | Show all available commands |
| `ls` | List files in project |
| `cat <file>` | Display file contents |
| `touch <file>` | Create a new file |
| `mkdir <dir>` | Create a new directory |
| `rm <file>` | Remove a file or directory |
| `git status` | Show git status |
| `git pull/push` | Git operations |
| `history` | Show command history |
| `date` | Show current date/time |
| `uptime` | Show session uptime |
| `env` | Show environment variables |
| `whoami` | Show current user |
| `echo <text>` | Echo text |
| `theme <name>` | Switch color theme |
| `version` | Show IDE version |
| `clear` | Clear terminal |

## Architecture

```
APEX-IDE/
├── index.html          # Main entry point (all components)
├── src/
│   ├── styles.css      # Hip-hop theme (CSS variables + components)
│   └── app.js          # Application logic, state, terminal, Monaco init
├── package.json        # npm config + dev server
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

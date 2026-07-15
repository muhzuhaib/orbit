# Orbit

**A multi-model desktop AI workspace for Windows.** Orbit is a Claude‑Desktop‑style app that runs
*any* model — Anthropic, OpenAI, Google Gemini, local Ollama, or **any OpenAI‑compatible API**
(Groq, DeepSeek, GLM, Kimi, Qwen, OpenRouter, LM Studio, …) — from one clean, fast interface.

Bring your own API keys; they’re stored encrypted on your machine (Electron `safeStorage`) and never
leave it except to talk to the provider you chose.

---

## Features

- **Chat with any model** — streaming responses, markdown + syntax highlighting, math rendering
  (KaTeX), a searchable model picker with per‑provider grouping and favourites.
- **Multi‑provider** — Anthropic, OpenAI, Google, Ollama (local), Ollama Cloud, and any
  OpenAI‑compatible endpoint. Model lists are fetched live from each provider.
- **Assistant** — an agent that works inside a folder you choose (read/write files, run commands)
  with an approval flow, diff previews, and a live activity timeline.
- **Code** — a developer coding agent that works in a real project folder (git, tests, refactors).
- **Studio** — describe a UI in plain words and get a live, self‑contained HTML preview to refine.
- **Team** — a lead model plans a task, delegates to worker models in parallel, and combines results.
- **Compare & Council** — ask several models the same prompt side‑by‑side, optionally with a judge.
- **Projects + RAG** — attach documents to a project; relevant chunks are retrieved into context.
- **MCP** — connect Model Context Protocol servers (stdio + HTTP) and use their tools in chat.
- **Web search** — keyless lookup (Wikipedia + news) so models can answer current questions.
- **Extras** — extended‑thinking controls, cost/token dashboard, persistent memory, screenshot &
  image attachments, Office file import/export, prompt templates, read‑aloud & dictation,
  light/dark themes, an accent‑colour picker, density options, and in‑app auto‑update.

## Tech stack

- **Electron + React + TypeScript**, bundled with **electron‑vite**
- **Vercel AI SDK** (`ai`) as the unified provider/streaming/tool layer
- **electron‑updater** for auto‑updates via GitHub Releases
- Local JSON storage per conversation; API keys via Electron `safeStorage`

## Getting started (development)

```bash
npm install
npm run dev
```

Then open **Settings → Providers**, add an API key for any provider (or start a local Ollama), and
begin a chat.

### Build a Windows installer

```bash
npm run dist
```

The signed NSIS installer is written to `release/Orbit-Setup-<version>.exe`.

## Project layout

- `src/main` — Electron main process (providers, agents, IPC, storage, updater)
- `src/preload` — the context‑isolated bridge exposed to the UI
- `src/renderer/src` — the React UI (views, components, styles)
- `src/shared` — types and helpers shared across processes

## License

[MIT](LICENSE) © Muhammad Zuhaib Zahid

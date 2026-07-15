# Orbit (multi-model Claude Desktop clone)

Electron + React + TS desktop app: Claude Desktop clone named **Orbit** (Chat + Cowork) that runs
ANY model (Anthropic / OpenAI / Gemini / Ollama / any OpenAI-compatible API).

**Before doing anything: read `docs/LOG.md` (where we stopped) and `docs/PLAN.md` (batch roadmap
and fixed architecture decisions).** The user runs out of token quota often and switches models —
these two files are the single source of truth for progress. Append to LOG.md at end of every session.

- Dev: `npm run dev` (electron-vite)
- Layout: `src/main` (Electron main), `src/preload`, `src/renderer/src` (React UI)
- Provider layer: Vercel AI SDK. Cowork: own agent loop (NOT Claude Agent SDK — Anthropic-only).

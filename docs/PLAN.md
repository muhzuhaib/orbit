# Orbit — Build Plan

Orbit: multi-model desktop chat app for Windows (Claude Desktop clone: Chat + Cowork, no Claude Code).
Supports ANY model provider: Anthropic, OpenAI, Google Gemini, Ollama (local), and any
OpenAI-compatible API (Groq, Mistral, DeepSeek, OpenRouter, LM Studio...).

## Architecture (decided, do not re-litigate)
- **Electron + React + TypeScript + electron-vite**
- **Vercel AI SDK** (`ai` package) as the unified provider layer (streaming + tool calling)
- **Own agent loop** for Cowork (Claude Agent SDK NOT used — it's Anthropic-only)
- **Official MCP TypeScript SDK** for MCP client support
- **RAG**: local embeddings via Ollama (`nomic-embed-text`) with fallback to provider APIs
- **Storage**: JSON files per conversation under app userData dir (simple, portable); may move to SQLite later if perf demands
- API keys stored via `safeStorage` (Electron encrypted storage), never in plain JSON
- Token counter: per-provider (Anthropic/Gemini count-tokens APIs, tiktoken for OpenAI,
  Ollama response counts) + model registry with context-window sizes → show tokens + %

## Batches
- [x] **Batch 1 — App shell**: electron-vite scaffold, main/preload/renderer, dark Claude-style
      UI shell (sidebar: Chats / Projects / Cowork / Settings), IPC skeleton, runs via `npm run dev`
- [x] **Batch 2 — Provider layer + Settings**: Vercel AI SDK integration, model registry
      (built-in models + user-added custom endpoints: protocol/baseURL/key/model/context-window),
      Settings UI for providers & keys (safeStorage), Ollama auto-detection (localhost:11434)
- [x] **Batch 3 — Chat**: streaming chat UI, markdown rendering + code highlighting,
      conversation persistence, history sidebar, model picker per conversation, stop/regenerate,
      system prompt per conversation
- [x] **Batch 4 — Token counter**: live usage display (input/output tokens + % of context window),
      per-provider counting strategies, warning near limit
- [x] **Batch 5 — Projects + RAG**: project entities (instructions + attached files), file ingestion
      (txt/md/pdf/docx), chunking + embeddings + vector store (local file-based), retrieval into context
- [x] **Batch 6 — MCP client**: MCP server config UI (stdio + HTTP), connect via official SDK,
      tool discovery, tool-call approval UI, tool calls in chat for any tool-capable model
- [x] **Extra (user-requested) — full MS Office support in chat**: attach docx/xlsx/xls/pptx/pdf/
      txt/md/csv to any message (text extracted + sent to model); export any assistant reply as
      .docx (md→HTML→OOXML), .xlsx (md tables→sheets), or .pptx (headings→slides, PptxGenJS)
- [x] **Extra (user-requested) — collapsible sidebar**: hide/show left nav for full-width chat,
      persisted in localStorage
- [x] **Batch 7 — Skills**: skill folder format (SKILL.md + resources), skill picker/auto-trigger,
      injection into context, bundled example skills
- [x] **Batch 8 — Cowork**: agent loop (model→tools→results→model) over provider layer,
      workspace folder sandbox, file read/write/list + shell tools with approval modes,
      progress/timeline UI, works with any tool-capable model
- [x] **Batch 9 — Cowork diff viewer** (user-proposed 2026-07-11): when Cowork
      asks to approve a write_file, show a git-style before/after diff (red/green lines) instead
      of raw JSON args; also per-file "what changed" view in the timeline
- [x] **Batch 10 — Artifacts + split screen** (user-proposed): side panel that live-renders
      model output — HTML/CSS/JS in a sandboxed iframe, SVG, markdown preview, code with
      copy/save; opens automatically when a reply contains a renderable block
- [x] **Batch 11 — Extended thinking + persistent memory** (user-proposed): reasoning display
      (collapsible "thinking…" block) with per-provider reasoning options (Anthropic budgets /
      OpenAI reasoning effort / Gemini thinking) + off/auto toggle; memory = userData/memory.md
      injected into system prompt + a save_memory tool so any chat can remember facts
- [x] **Batch 12 — Vision: screen capture + image attachments** (user-proposed): Electron
      desktopCapturer screenshot button + image file attachments, sent as file parts to
      vision-capable models (decided AGAINST registry vision flags: any model gets the image;
      non-vision models surface the provider's own error in chat — simpler than maintaining
      per-model capability lists for arbitrary custom providers)
- [x] **Batch 13 — Polish + packaging** (was Batch 9): retry button on chat errors,
      electron-builder NSIS installer for Windows (`npm run dist` → release/Orbit-Setup-*.exe,
      config in electron-builder.yml, icon generated in build/). Theming DEFERRED to next version.
- [x] **Extra (user-reported fixes, 2026-07-11) — live model lists + native Office generation**:
      (1) model lists now fetched LIVE from each provider's list-models API (Anthropic/OpenAI/
      Google/any OpenAI-compat) with 1h cache in userData/models-cache.json + offline fallback +
      Settings refresh button — new models appear and deprecated ones disappear WITHOUT app
      updates (parsing/filtering in src/shared/modelCatalog.ts, fetching in src/main/registry.ts);
      (2) create_document chat tool (docx/xlsx/pptx from markdown, save dialog = consent) + a
      standing system-prompt section so NO model ever refuses Office file requests — the app does
      the conversion, non-tool models are told to output markdown for the export buttons.

- [x] **v0.2.0 (user-reported fixes after installing v0.1.0)**: grouped model picker
      (optgroup per provider, shared ModelSelect component), collapsed-sidebar toolbar overlap
      fix, Google unusable-model probe filter (list API returns models an account can't call —
      1-token probe drops 404 "no longer available" and 429 "limit: 0" models).

- [x] **v0.4.0 (user's third test round — minimalist redesign)**: full de-orange minimalist
      restyle (neutral slate-blue accent, styled orbit logo/wordmark, line-icon set, thin
      theme-aware scrollbars) + **light/dark theme** (theme.ts, localStorage, OS default); searchable
      model picker with Thinking/Fast badges (classifyModel) solving "list too long / which is which";
      much larger context-window heuristics for OpenAI-compat models (compatContext, unknown default
      128K not 8K, up to 1M) + a model-cache version bump so upgrades refetch; last-used model
      remembered for new chats (prefs.ts); project detail now lists the chats started in it
      (ConversationMeta.projectId); DeepSeek / Qwen / GLM added as built-in providers; new minimalist
      app icon (scripts/make-icon.mjs). See LOG.md 2026-07-12 for the full 11-item mapping.

- [x] **v0.5.0 (user's fourth round — power features)**: (fixes) resizable split-screen preview
      (drag left edge, persisted), extended-thinking toggle only shown for models that support it
      (`supportsThinking`), multi-select + delete-all chats (native confirm). (features) **Compare**
      view — ask 2–3 models one prompt, answers stream side-by-side (main `compare.ts`, ephemeral,
      multi-turn); **cross-chat search** (title + message text with snippets); **prompt template
      library** (Settings CRUD + a Templates button in the composer). See LOG.md 2026-07-12
      sessions 5 & 6.

- [x] **v0.6.0 (user's fifth round — 15-feature power update)**: rename chats (dbl-click/menu);
      pin + folders (config-stored folders, grouped list, per-chat ⋯ menu); command palette Ctrl+K +
      Ctrl+N (CommandPalette.tsx); copy every message + edit-and-resend user messages
      (chat.editAndResend); Compare Live/History tabs (last 3, compareHistory.ts); regenerate a reply
      with a different model (chat:regenerate takes a model); tokens/sec per reply (ChatMessage.tps);
      **Kimi (Moonshot)** built-in provider; cost & token dashboard (shared/modelPricing.ts, 💰 panel);
      read-aloud (speechSynthesis) + dictation (webkitSpeechRecognition); keyless web-search tool
      (DuckDuckGo, per-chat 🌐 toggle); ★ favourite models pinned to top of the picker (prefs.ts);
      font picker (font.ts, Settings → Appearance); stronger bad-model filter (COMPAT_NOT_CHAT);
      per-provider Free/Paid plan (freeTierAllows hides paid-only models). See LOG.md 2026-07-12
      session 7 for the full 15-item mapping + verification.

- [x] **v0.3.0 (user's second test round)**: built-in "Ollama Cloud" provider with API-key card
      (+ one-time migration from the old custom provider incl. conversations/cowork/secrets) and
      1-token tier probe so free keys don't see paid-only models; truthful Test button for
      ollama.com; atom-style icon; Claude-Desktop-style split screen (generated documents render
      in the panel with saved path; code blocks ≥8 lines get ⌨ chips + auto-open, code-only panel).

- [x] **v0.9.0 (user's eighth round)**: dark mode is now the DEFAULT for new users (theme.ts) and
      100%-width / sidebar-hidden is the DEFAULT (App.tsx navHidden `!== '0'`) — both only affect
      unset prefs, saved choices still win. Settings converted from a full page to a **ChatGPT-style
      popup modal** (App.tsx settingsOpen + `.modal`, Esc/✕/backdrop to close; SettingsView unchanged).
      Two NEW sidebar sections: **Studio** (design — describe a UI, model returns one self-contained
      HTML doc rendered in a live artifact:// iframe, iterative; src/main/studio.ts) and **Forge**
      (Claude Code clone — developer terminal-style agentic coder on a real project folder, git/tests/
      error-fixing, own storage; src/main/forge.ts mirrors Cowork's loop with a dev system prompt +
      auto-edits default). Note: this supersedes the earlier "no Claude Code" stance — the user
      explicitly requested it. See LOG.md 2026-07-12 session 11.

- [x] **v0.10.0-beta.1 → v0.10.0 STABLE (sessions 15–16)**: 4 toggleable features (Cost preview,
      Autopilot smart-routing, Council, Personal benchmarks — all default ON, `orbit-beta-*` keys +
      benchmarks.json additive so 0.9.3 rollback stays clean), cut to stable in session 16 after the
      user loved them (labels de-beta'd, features kept). Session-16 fixes: **elegant shared
      SectionComposer** (file attachments + dictation) across Swarm/Cowork/Code/Studio/Compare/Council;
      **built-in maths rendering** — remark-math + rehype-katex via a shared `views/MarkdownView.tsx`,
      `mathFormat.ts` delimiter normalisation, and a `shared/mathPrompt.ts` system-prompt instruction in
      every section, with a LaTeX(default)/Unicode setting; **Autopilot now only routes to providers that
      have a usable key** (`hasKey || !needsKey`). See LOG.md sessions 15 & 16.

## Future versions (documented for the next model/session — NOT built)
- Custom-frame title bar so it also follows the light/dark theme (currently OS-dark)
- User-selectable accent colour (theme system + CSS vars already in place — just needs a picker)
- Context-window numbers for OpenAI/Anthropic come from pattern heuristics
  (their list APIs don't return limits) — revisit if they add it; Google returns real limits
- Auto-update (electron-updater) — installer is manual-download for now
- Code signing the installer (needs a paid certificate; unsigned = SmartScreen warning)

## Roadmap to 8.5/10 (agreed with user, session 27 — 2026-07-16; NOT built)
Prioritized backlog from the app-quality review. Current rating ~7/10; the ceiling is held down by
reliability + long-tail polish, not capability. Start with the Top 3 unless the user says otherwise.

**⭐ Top 3 (biggest felt-quality jump):**
1. **Chat reading-width + spacing system** — constrain assistant/user messages to a centered reading
   column (~720–780px) on wide screens, composer aligned to the same width; constrain the CONTENT column,
   not the window (keep the 100%-width sidebar preference). Add a consistent spacing scale (4/8/12/16/24)
   and a type ramp so paddings stop feeling ad-hoc. (Held back in session 26 as risky — do it carefully.)
2. **Auto-update** (electron-updater) — no more manual installer re-downloads.
3. **Conversation-list date grouping** in the sidebar — Today / Yesterday / Last 7 days / Older.

**Other visual / layout (elegance):**
4. Subtle per-message identity (model badge or avatar) so long chats are scannable.
5. Friendlier empty states / first-run for the section views (Team, Studio, …).
6. Density toggle (Comfortable / Compact).
7. Accent-colour picker (theme CSS vars already exist — just expose it; dupes item above).

**Functional:**
8. Optional keyed search provider (Brave/Tavily) as a fallback behind the keyless Wikipedia+News search
   (session 27 removed DuckDuckGo) — makes web search bulletproof.
9. Conversation export/share (Markdown/PDF) + full backup/restore of app data.
10. Image generation (providers that expose it).
11. Better RAG citations — show which chunk answered, inline.
12. Global keyboard shortcuts for every action + a shortcuts cheat-sheet.
13. Chat tabs / multi-window.

**Polish / cleanup (lower priority):**
14. Code-split the renderer bundle (~1.7 MB) for faster cold start.
15. Short first-launch onboarding tour.
16. Rename the chat `.tool-card` CSS class to fix the collision noted in LOG session 27.

NOTE on 9–12: order CONFIRMED by user 2026-07-11 (session 2). STANDING INSTRUCTION from the
user: they are low on usage quota — when they say "finalize the app", STOP feature work
immediately, jump to Batch 13 (stability + electron-builder installer), and leave any unbuilt
batches documented here for the next version/model to pick up.
Already covered elsewhere, do NOT rebuild: "local projects" = Projects tab (Batch 5);
"adaptive thinking" folds into the Batch 11 auto toggle.

## How to continue (the user pastes this prompt for any future update)
> Continue the Orbit project in `orbit/`. FIRST read `orbit/docs/LOG.md` (newest entry = exact
> current state and gotchas) and `orbit/docs/PLAN.md` (architecture decisions — do not change
> them). The app is COMPLETE and installed on my PC; you are making an incremental update, so
> do not rebuild or restructure anything that works. I am non-technical: do all the work
> yourself, verify everything before claiming it works (typecheck + the E2E patterns described
> in LOG.md), bump the version in package.json, build a new installer with `npm run dist`, and
> confirm the packaged app boots. The installer upgrades in place — I just run it. Append a
> LOG.md entry at the end. Here is what I need changed: <describe the change>

## Rules for whoever continues this
1. Read `docs/LOG.md` first — it says exactly where work stopped.
2. Work in the batch order above. Check off batches here when done.
3. At the END of every work session, append an entry to `docs/LOG.md` (format is in that file).
4. Verify `npm run dev` still boots before ending a session.
5. Don't swap out the architecture choices above without the user asking.

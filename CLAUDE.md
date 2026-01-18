# OpenAI Agentic Chat Scaffold

## Project Overview
A monorepo scaffold providing:
- Minimal chat UI (Next.js 14 App Router) + Express backend
- OpenAI Agents SDK streaming chat with agentic memory
- SQLite persistence + embeddings retrieval for conversation memory
- MCP "sandbox notes" server the agent can call
- Multimodal image input (upload -> base64 data URL -> model vision)
- Models: gpt-5.1 (primary), gpt-5-mini (fallback), text-embedding-3-large (embeddings)
- Tracing with local SQLite summary (traceId/runId/model/tools/timing)
- 10 deterministic eval cases

## Tech Stack
- **Runtime**: Node.js 22.x (Active LTS)
- **Package Manager**: npm workspaces
- **Backend**: Express + TypeScript
- **Frontend**: Next.js 14 + TypeScript (App Router)
- **Tests**: Vitest + Supertest
- **Lint**: ESLint + TypeScript typecheck
- **Database**: SQLite (better-sqlite3) with prepared statements
- **Validation**: Zod
- **Streaming**: NDJSON over chunked HTTP response

## Directory Structure
```
/
├── package.json          # Workspaces root
├── .nvmrc                # Node version (22)
├── .env.example          # Environment template (no secrets!)
├── tsconfig.base.json    # Shared TS config
├── apps/
│   ├── web/              # Next.js chat UI
│   ├── api/              # Express + Agents SDK
│   └── mcp-notes/        # MCP Streamable HTTP server
├── packages/
│   ├── shared/           # Zod schemas, types, redaction helper
│   └── evals/            # 10 eval cases + runner
└── scripts/              # Dev convenience scripts
```

## Commands
```bash
npm install              # Install all workspaces
npm run dev              # Run web + api + mcp-notes concurrently
npm run test             # Unit tests (Vitest)
npm run lint             # ESLint across workspaces
npm run typecheck        # TypeScript check across workspaces
npm run build            # Build web + api
npm run evals            # Run 10 eval cases (skips if no OPENAI_API_KEY)
```

## Environment Variables
Copy `.env.example` to `.env` and set:
- `OPENAI_API_KEY` (required for runtime)
- `OPENAI_MODEL_PRIMARY` (default: gpt-5.1)
- `OPENAI_MODEL_FALLBACK` (default: gpt-5-mini)
- `OPENAI_EMBEDDING_MODEL` (default: text-embedding-3-large)
- `MCP_NOTES_URL` (default: http://localhost:8787/sse)

---

## Development Guidelines

### TDD Where Feasible
Use Red-Green-Refactor:
1. Write a failing test that defines the behaviour
2. Implement minimal code to pass the test
3. Refactor while keeping tests passing

### Plan-First for Non-Trivial Work
For non-trivial tasks, provide a short plan (files + steps) before editing.

### Change Discipline
- Follow existing conventions and patterns in this repo
- Keep diffs minimal and focused
- Do not refactor unrelated code

---

## Completion and Honesty Policy

### Evidence-Based Claims (Mandatory)
Do NOT claim "fixed", "working", "success", or "complete" unless you ran relevant checks.
For every check you ran, list:
- Command
- Result (pass/fail)
- Brief key output (if useful)

If you could not run checks, explicitly write: **NOT VERIFIED** and explain why.

### Status Taxonomy (End of Every Task)
End every task with a **Status** block using ONLY:
- **DONE**: implemented + verified by tests/linters/build as applicable
- **PARTIAL**: implemented but not fully verified OR acceptance criteria incomplete
- **BLOCKED**: cannot proceed due to missing info/access/prerequisite failure

### Required End-of-Task Report
1. Status: DONE / PARTIAL / BLOCKED
2. What changed: bullet list of files + short description
3. Verification: commands run + results
4. Known issues / follow-ups
5. Assumptions

---

## Security Non-Negotiables

### Secrets & Sensitive Data
- Never place secrets in code, tests, config examples, README, commit messages, logs, or comments
- No credentials, tokens, connection strings, private URLs, customer data, or "temporary" keys anywhere in the repo
- Use env vars injected at runtime
- If a secret may have been exposed: STOP, flag it clearly, and propose rotation/containment steps

### Runtime & Dependencies
- Node.js: production must use Active LTS or Maintenance LTS only (currently 22.x)
- Prefer minimal dependency footprint; avoid adding libraries for trivial functionality
- If adding a dependency, state why

### Injection & Data Handling
- All SQLite access must use parameterised queries (prepared statements); never build SQL via string concatenation
- Validate all external inputs server-side with Zod
- Encode/escape outputs based on context

### Logging
- Logs must not include secrets, tokens, auth headers, session IDs, PII, prompts, or images
- Use the redaction helper from `@scaffold/shared` for all log output
- Log only safe metadata (traceId, conversationId, model name, tool names, timing)

---

## Code Standards

### TypeScript
- Strict mode enabled
- Prefer explicit types for function parameters and return values
- Use Zod schemas for runtime validation, infer types from schemas where possible
- No `any` without explicit justification

### API Design
- All endpoints validate input with Zod before processing
- Streaming responses use NDJSON (newline-delimited JSON)
- Error responses include safe error messages only (no stack traces in production)

### Database
- SQLite with better-sqlite3
- All queries use prepared statements
- Embeddings stored as BLOB (Float32Array buffer)

### Testing
- Unit tests must not require network access
- Use Vitest for all tests
- Mock external services (OpenAI API) in unit tests
- Integration tests may use Supertest for Express routes

---

## Streaming Contract (NDJSON)

**Endpoint**: `POST /api/chat`

**Request**:
```json
{
  "conversationId": "optional-string",
  "message": "user message",
  "images": [{ "mimeType": "image/png", "base64": "..." }]
}
```

**Response**: Stream with `Content-Type: application/x-ndjson`

Event types:
- `{type:"meta", conversationId, traceId}`
- `{type:"delta", text:"..."}`
- `{type:"tool", server:"mcp-notes", toolName:"notes.search", status:"start"|"end"}`
- `{type:"final", text:"...", usage?, traceId}`
- `{type:"error", message:"safe message"}`

---

## Memory Architecture

### Local Embeddings Retrieval
- Every user+assistant message stored in SQLite with timestamp and embedding vector
- On new user turn: compute embedding, retrieve top-K (default 6) similar past messages
- Retrieved context injected server-side before agent call

### MCP Notes (Durable Memory)
- Agent can call `notes.add`, `notes.search`, `notes.get` via MCP
- Notes stored in separate SQLite DB in mcp-notes app
- Used for higher-level durable facts/preferences

---

## Verification Checklist
Before marking DONE, run and report:
```bash
npm install
npm run typecheck
npm run test
npm run lint
npm run build
npm audit
```

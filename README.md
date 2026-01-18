# OpenAI Agentic Chat Scaffold

A production-ready monorepo scaffold for building agentic chat applications with:

- **Streaming chat UI** (Next.js 14 App Router)
- **Express backend** with OpenAI Agents SDK
- **Agentic memory** via SQLite embeddings retrieval + MCP notes server
- **Multimodal input** (image upload with vision support)
- **Tracing** with local persistence and UI visibility
- **10 eval cases** for quality assurance

## Features

- **Real-time streaming** - NDJSON streaming from backend to browser
- **Memory system** - Dual memory: embeddings-based retrieval + durable MCP notes
- **Model fallback** - Automatic retry with fallback model on errors
- **Image support** - Upload images for multimodal conversations
- **Tool visibility** - See when the agent uses MCP tools in real-time
- **Trace tracking** - Every run persisted with trace IDs visible in UI
- **Security-first** - Redacted logging, parameterized SQL, no secrets in repo

## Quick Start

### Prerequisites

- Node.js 22.x (Active LTS) - use `nvm use` if you have nvm installed
- OpenAI API key

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd openai-agentic-chat-scaffold

# Install dependencies
npm install

# Copy environment file and add your API key
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=your-key-here

# Start development servers (web + api + mcp-notes)
npm run dev
```

Open http://localhost:3000 to use the chat interface.

## Project Structure

```
/
├── apps/
│   ├── web/          # Next.js 14 chat UI
│   ├── api/          # Express + Agents SDK backend
│   └── mcp-notes/    # MCP server for durable notes
├── packages/
│   ├── shared/       # Zod schemas, types, redaction helper
│   └── evals/        # 10 eval cases + runner
├── .env.example      # Environment template (no secrets!)
├── CLAUDE.md         # Development guidelines
└── README.md
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services (web, api, mcp-notes) |
| `npm run build` | Build all packages |
| `npm run test` | Run unit tests (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |
| `npm run evals` | Run 10 eval cases (requires OPENAI_API_KEY) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | Your OpenAI API key |
| `OPENAI_MODEL_PRIMARY` | No | `gpt-5.1` | Primary model for chat |
| `OPENAI_MODEL_FALLBACK` | No | `gpt-5-mini` | Fallback model on errors |
| `OPENAI_EMBEDDING_MODEL` | No | `text-embedding-3-large` | Model for embeddings |
| `MCP_NOTES_URL` | No | `http://localhost:8787/sse` | MCP notes server URL |
| `API_PORT` | No | `3001` | API server port |
| `MCP_NOTES_PORT` | No | `8787` | MCP notes server port |

## How Memory Works

### Embeddings-Based Retrieval

1. Every message is embedded using OpenAI's embedding model
2. Embeddings stored in SQLite alongside message content
3. On each new user message:
   - Compute embedding for the message
   - Find top-K similar past messages (default: 6)
   - Inject as context before the agent call

### MCP Notes (Durable Memory)

The agent has access to three MCP tools:

- `notes.add` - Store durable facts, preferences, or important information
- `notes.search` - Search previously stored notes by query
- `notes.get` - Retrieve a specific note by ID

Notes persist across conversations and are stored in a separate SQLite database.

## Swapping MCP Servers

To use a different MCP server:

1. Set `MCP_NOTES_URL` to your server's SSE endpoint
2. Ensure your server implements the Streamable HTTP transport
3. Expose compatible tools (or update the agent instructions)

To add additional MCP servers, modify `apps/api/src/agent.ts` to include more `MCPServerStreamableHttp` instances.

## Running Evals

```bash
# Evals require OPENAI_API_KEY to be set
npm run evals
```

The eval runner will:
- Run 10 deterministic test cases
- Output a results table
- Exit with code 1 if any cases fail
- Skip gracefully if OPENAI_API_KEY is not set

Eval cases are defined in `packages/evals/src/evalcases.json`.

## API Endpoints

### POST /api/chat

Stream a chat message through the agent.

**Request:**
```json
{
  "conversationId": "optional-uuid",
  "message": "Hello!",
  "images": [{ "mimeType": "image/png", "base64": "..." }]
}
```

**Response:** NDJSON stream with events:
- `{type:"meta", conversationId, traceId}` - Session metadata
- `{type:"delta", text:"..."}` - Incremental text
- `{type:"tool", server, toolName, status}` - Tool usage
- `{type:"final", text, traceId}` - Complete response
- `{type:"error", message}` - Error occurred

### GET /api/runs

List recent runs (last 20).

**Response:**
```json
{
  "runs": [
    {
      "id": "...",
      "traceId": "...",
      "conversationId": "...",
      "modelUsed": "gpt-5.1",
      "toolsUsed": ["notes.search"],
      "success": true
    }
  ]
}
```

## Authentication (Optional)

This project includes optional Google OAuth authentication via [oauth2_proxy](https://github.com/oauth2-proxy/oauth2-proxy).

### Setup Google OAuth

1. **Create Google OAuth credentials:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create a new OAuth 2.0 Client ID (Web application)
   - Add authorized redirect URI: `http://localhost:4180/oauth2/callback`
   - Copy the Client ID and Client Secret

2. **Configure environment variables:**
   ```bash
   # Add to your .env file
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret

   # Generate a cookie secret
   OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_')

   # Enable auth in the API
   AUTH_ENABLED=true
   ```

3. **Start with Docker Compose:**
   ```bash
   # Start oauth2_proxy (requires Docker)
   docker compose up -d

   # Start the app as usual
   npm run dev
   ```

4. **Access via authenticated proxy:**
   - Open `http://localhost:4180` (instead of port 3000)
   - You'll be redirected to Google login
   - Only emails from your configured domain can access

### Configuration

The oauth2_proxy is pre-configured for domain `gianlucaformica.net`. To change:

1. Edit `docker-compose.yml`:
   ```yaml
   OAUTH2_PROXY_EMAIL_DOMAINS: yourdomain.com
   ```

2. Or allow any email:
   ```yaml
   OAUTH2_PROXY_EMAIL_DOMAINS: "*"
   ```

### Architecture

```
User → oauth2_proxy (port 4180) → Express API (port 3001)
              ↓
       Google OAuth
```

oauth2_proxy adds these headers to authenticated requests:
- `X-Forwarded-User`: username
- `X-Forwarded-Email`: user's email
- `X-Forwarded-Access-Token`: OAuth token

## Security Notes

- **No secrets in repo** - All credentials via environment variables
- **Redacted logging** - Sensitive fields automatically redacted
- **Parameterized SQL** - All queries use prepared statements
- **Input validation** - Zod schemas validate all inputs
- **Safe error messages** - No stack traces exposed to clients
- **OAuth 2.0** - Optional Google authentication with domain restriction

## Development Guidelines

See [CLAUDE.md](./CLAUDE.md) for:
- TDD workflow
- Security requirements
- Code standards
- Completion policy

## License

MIT

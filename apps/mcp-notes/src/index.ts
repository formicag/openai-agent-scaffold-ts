import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response } from 'express';
import { NotesAddSchema, NotesSearchSchema, NotesGetSchema, safeLog } from '@scaffold/shared';
import { NotesDatabase } from './db.js';

const PORT = parseInt(process.env['MCP_NOTES_PORT'] ?? '8787', 10);

const app = express();
const db = new NotesDatabase();

// Create MCP server
const mcpServer = new Server(
  {
    name: 'mcp-notes',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'notes.add',
      description: 'Add a new note to the sandbox. Use for durable memory of facts, preferences, or important information.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Optional title for the note',
            maxLength: 200,
          },
          content: {
            type: 'string',
            description: 'The content of the note',
            minLength: 1,
            maxLength: 10000,
          },
          tags: {
            type: 'array',
            items: { type: 'string', maxLength: 50 },
            maxItems: 10,
            description: 'Optional tags for categorization',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'notes.search',
      description: 'Search notes by query. Returns matching notes with snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against note titles and content',
            minLength: 1,
            maxLength: 500,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
            minimum: 1,
            maximum: 50,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'notes.get',
      description: 'Get a specific note by ID. Returns full content.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the note to retrieve',
          },
        },
        required: ['id'],
      },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, (request) => {
  const { name, arguments: args } = request.params;

  safeLog('info', 'tool_call', { tools: [name] });

  try {
    switch (name) {
      case 'notes.add': {
        const parsed = NotesAddSchema.parse(args);
        const result = db.addNote(parsed);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }

      case 'notes.search': {
        const parsed = NotesSearchSchema.parse(args);
        const results = db.searchNotes(parsed.query, parsed.limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results }),
            },
          ],
        };
      }

      case 'notes.get': {
        const parsed = NotesGetSchema.parse(args);
        const note = db.getNote(parsed.id);
        if (!note) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Note not found' }),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(note),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    safeLog('error', 'tool_error', { tools: [name], errorType: message });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
});

// Map to track active transports
const transports = new Map<string, SSEServerTransport>();

// SSE endpoint for MCP Streamable HTTP transport
app.get('/sse', (req: Request, res: Response) => {
  safeLog('info', 'sse_connection_start');

  const transport = new SSEServerTransport('/messages', res);
  const sessionId = crypto.randomUUID();
  transports.set(sessionId, transport);

  res.on('close', () => {
    transports.delete(sessionId);
    safeLog('info', 'sse_connection_close');
  });

  // Connect the transport to the MCP server
  mcpServer.connect(transport).catch((err) => {
    safeLog('error', 'mcp_connect_error', { errorType: String(err) });
  });
});

// Messages endpoint for SSE transport
app.post('/messages', express.json(), (req: Request, res: Response) => {
  // The SSE transport handles incoming messages via the transport object
  // This endpoint receives JSON-RPC messages and routes them
  const sessionId = req.query['sessionId'] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId' });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Forward the message to the transport
  void transport.handlePostMessage(req, res);
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'mcp-notes' });
});

// Direct HTTP endpoints for tools (used by the agent)
app.post('/tool/notes_add', express.json(), (req: Request, res: Response) => {
  try {
    const parsed = NotesAddSchema.parse(req.body);
    const result = db.addNote(parsed);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

app.post('/tool/notes_search', express.json(), (req: Request, res: Response) => {
  try {
    const parsed = NotesSearchSchema.parse(req.body);
    const results = db.searchNotes(parsed.query, parsed.limit);
    res.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

app.post('/tool/notes_get', express.json(), (req: Request, res: Response) => {
  try {
    const parsed = NotesGetSchema.parse(req.body);
    const note = db.getNote(parsed.id);
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    res.json(note);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Start server
app.listen(PORT, () => {
  safeLog('info', 'server_start', { model: 'mcp-notes' });
  console.info(`MCP Notes server running on http://localhost:${PORT}`);
  console.info(`SSE endpoint: http://localhost:${PORT}/sse`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  safeLog('info', 'server_shutdown');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  safeLog('info', 'server_shutdown');
  db.close();
  process.exit(0);
});

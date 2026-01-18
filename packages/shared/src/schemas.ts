import { z } from 'zod';

// Chat request schema
export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(32000),
  images: z
    .array(
      z.object({
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
        base64: z.string().min(1),
      })
    )
    .max(5)
    .optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Stream event schemas
export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meta'),
    conversationId: z.string(),
    traceId: z.string().optional(),
  }),
  z.object({
    type: z.literal('delta'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool'),
    server: z.string(),
    toolName: z.string(),
    status: z.enum(['start', 'end']),
  }),
  z.object({
    type: z.literal('final'),
    text: z.string(),
    usage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        totalTokens: z.number(),
      })
      .optional(),
    traceId: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// MCP Notes schemas
export const NotesAddSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(10000),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export type NotesAdd = z.infer<typeof NotesAddSchema>;

export const NotesSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export type NotesSearch = z.infer<typeof NotesSearchSchema>;

export const NotesGetSchema = z.object({
  id: z.string().uuid(),
});

export type NotesGet = z.infer<typeof NotesGetSchema>;

export const NoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  content: z.string(),
  tags: z.array(z.string()).nullable(),
  createdAt: z.string().datetime(),
});

export type Note = z.infer<typeof NoteSchema>;

export const NotesSearchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string().nullable(),
      snippet: z.string(),
      tags: z.array(z.string()).nullable(),
      createdAt: z.string().datetime(),
    })
  ),
});

export type NotesSearchResult = z.infer<typeof NotesSearchResultSchema>;

// Trace summary schema (for local persistence)
export const TraceSummarySchema = z.object({
  traceId: z.string(),
  conversationId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  modelUsed: z.string(),
  toolsUsed: z.array(z.string()),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

export type TraceSummary = z.infer<typeof TraceSummarySchema>;

import OpenAI from 'openai';
import type { StreamEvent, ImageInput, MemoryContext } from '@scaffold/shared';
import { safeLog } from '@scaffold/shared';
import { v4 as uuidv4 } from 'uuid';

// Retry configuration per OpenAI best practices
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (rate limit or server error)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    // Rate limit (429) or server errors (5xx) are retryable
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function getRetryDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s...
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  // Add jitter (0-500ms) to prevent thundering herd
  const jitter = Math.random() * 500;
  return exponentialDelay + jitter;
}

const AGENT_INSTRUCTIONS = `You are a helpful, concise assistant with persistent memory via a notes system.

# Response Format
- Use short paragraphs (2-3 sentences max)
- Use bullet points for lists
- Use **bold** for emphasis sparingly
- Avoid redundant phrases like "I'd be happy to help"
- Get to the point quickly

# Tools

## notes_add
Store durable information (preferences, facts, important details).
- Call IMMEDIATELY when user says "remember" or shares persistent info
- Never promise to call later - call now or not at all

## notes_search
Query stored notes by keyword.
- Call when user asks about something previously stored
- Not for general knowledge - only YOUR notes

## notes_get
Fetch full note by ID after search.

# Rules
1. Be concise - short answers unless detail is requested
2. Call tools immediately when needed, don't announce intentions
3. Never fabricate note contents - only cite what you retrieve
4. If a tool fails, briefly explain and offer alternatives`;

// Tool definitions for the agent
// Per OpenAI best practices: use strict: true for reliable schema adherence
// With strict: true, ALL properties must be in 'required' array
// Optional fields use type: ["string", "null"] pattern
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'notes_add',
      description: 'Store durable information (facts, preferences, important details) that should persist across conversations. Call this IMMEDIATELY when user asks you to remember something - do not promise to call it later.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: ['string', 'null'],
            description: 'Short descriptive title for the note (optional but recommended)',
          },
          content: {
            type: 'string',
            description: 'The information to store',
          },
          tags: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Categorization tags (e.g., "preference", "fact", "contact")',
          },
        },
        required: ['title', 'content', 'tags'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes_search',
      description: 'Search your previously stored notes. Use when user asks about something you may have recorded, or when prior context would improve your response. Only returns YOUR notes, not general knowledge.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search terms to match against note titles and content',
          },
          limit: {
            type: ['number', 'null'],
            description: 'Maximum results to return (1-50, default: 10)',
          },
        },
        required: ['query', 'limit'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes_get',
      description: 'Retrieve full content of a specific note by its UUID. Use after notes_search returns a note ID when you need complete details.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the note (from search results)',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
];

export interface AgentRunParams {
  message: string;
  images?: ImageInput[];
  memoryContext?: MemoryContext;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  primaryModel: string;
  fallbackModel: string;
  mcpNotesUrl: string;
  apiKey: string;
}

async function callMcpTool(
  mcpNotesUrl: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  // Call the MCP notes server directly via HTTP
  const baseUrl = mcpNotesUrl.replace('/sse', '');

  // Filter out null values - OpenAI sends null for optional fields,
  // but MCP server expects undefined (or field to be absent)
  const filteredArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== null) {
      filteredArgs[key] = value;
    }
  }

  try {
    // For simplicity, we'll call the tools via a direct HTTP endpoint
    // In a full implementation, this would use the MCP protocol properly
    const response = await fetch(`${baseUrl}/tool/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filteredArgs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({ error: `Tool call failed: ${response.status} - ${errorText}` });
    }

    return await response.text();
  } catch (error) {
    return JSON.stringify({ error: `Tool call failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
}

export interface AgentRunResult {
  traceId: string;
  toolsUsed: string[];
  finalText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function* runAgentStream(
  params: AgentRunParams
): AsyncGenerator<StreamEvent, AgentRunResult> {
  const traceId = uuidv4();
  const toolsUsed: string[] = [];
  let finalText = '';
  let currentModel = params.primaryModel;
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  safeLog('info', 'agent_run_start', {
    traceId,
    model: currentModel,
  });

  const client = new OpenAI({ apiKey: params.apiKey });

  // Build system message with memory context
  let systemMessage = AGENT_INSTRUCTIONS;

  if (params.memoryContext && params.memoryContext.messages.length > 0) {
    const contextStr = params.memoryContext.messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');
    systemMessage += `\n\nRelevant context from previous conversations:\n${contextStr}`;
  }

  // Build messages array
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemMessage },
  ];

  // Add conversation history
  if (params.conversationHistory) {
    for (const msg of params.conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add current message (potentially with images)
  if (params.images && params.images.length > 0) {
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: params.message },
    ];
    for (const img of params.images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
        },
      });
    }
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: params.message });
  }

  const runWithModel = async function* (model: string): AsyncGenerator<StreamEvent> {
    let continueLoop = true;
    const currentMessages = [...messages];

    while (continueLoop) {
      continueLoop = false;

      // Retry loop with exponential backoff for rate limits
      let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | undefined;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          stream = await client.chat.completions.create({
            model,
            messages: currentMessages,
            tools: TOOLS,
            stream: true as const,
            // Per OpenAI best practices: include usage stats with streaming
            stream_options: { include_usage: true },
          });
          break; // Success, exit retry loop
        } catch (error) {
          if (attempt < MAX_RETRIES && isRetryableError(error)) {
            const delay = getRetryDelay(attempt);
            safeLog('warn', 'api_retry', {
              traceId,
              attempt: attempt + 1,
              delayMs: Math.round(delay),
              errorType: error instanceof Error ? error.name : 'Unknown',
            });
            await sleep(delay);
          } else {
            throw error;
          }
        }
      }

      if (!stream) {
        throw new Error('Failed to create stream after retries');
      }

      let currentToolCall: {
        id: string;
        name: string;
        arguments: string;
      } | null = null;

      let assistantContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Track usage from streaming (appears in final chunk)
        if (chunk.usage) {
          totalUsage.promptTokens += chunk.usage.prompt_tokens;
          totalUsage.completionTokens += chunk.usage.completion_tokens;
          totalUsage.totalTokens += chunk.usage.total_tokens;
        }

        if (delta?.content) {
          finalText += delta.content;
          assistantContent += delta.content;
          yield { type: 'delta', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.id) {
              // New tool call starting
              currentToolCall = {
                id: toolCall.id,
                name: toolCall.function?.name ?? '',
                arguments: toolCall.function?.arguments ?? '',
              };
            } else if (currentToolCall && toolCall.function?.arguments) {
              currentToolCall.arguments += toolCall.function.arguments;
            }
            if (toolCall.function?.name && currentToolCall) {
              currentToolCall.name = toolCall.function.name;
            }
          }
        }

        // Check if this is the end of the chunk
        if (chunk.choices[0]?.finish_reason === 'tool_calls' && currentToolCall) {
          // Execute the tool
          toolsUsed.push(currentToolCall.name);
          yield {
            type: 'tool',
            server: 'mcp-notes',
            toolName: currentToolCall.name,
            status: 'start',
          };

          let toolResult: string;
          try {
            const args = JSON.parse(currentToolCall.arguments) as Record<string, unknown>;
            toolResult = await callMcpTool(params.mcpNotesUrl, currentToolCall.name, args);
          } catch {
            toolResult = JSON.stringify({ error: 'Failed to execute tool' });
          }

          yield {
            type: 'tool',
            server: 'mcp-notes',
            toolName: currentToolCall.name,
            status: 'end',
          };

          // Add assistant message with tool call
          currentMessages.push({
            role: 'assistant',
            content: assistantContent || null,
            tool_calls: [
              {
                id: currentToolCall.id,
                type: 'function',
                function: {
                  name: currentToolCall.name,
                  arguments: currentToolCall.arguments,
                },
              },
            ],
          });

          // Add tool result
          currentMessages.push({
            role: 'tool',
            tool_call_id: currentToolCall.id,
            content: toolResult,
          });

          // Continue the loop to get the model's response to the tool result
          continueLoop = true;
          currentToolCall = null;
          assistantContent = '';
        }
      }
    }
  };

  try {
    yield* runWithModel(currentModel);
  } catch (error) {
    // Check if we should fallback
    if (
      currentModel === params.primaryModel &&
      error instanceof Error &&
      (error.message.includes('404') ||
       error.message.includes('permission') ||
       error.message.includes('does not exist'))
    ) {
      safeLog('warn', 'model_fallback', {
        traceId,
        model: params.fallbackModel,
        errorType: error.name,
      });
      currentModel = params.fallbackModel;
      finalText = '';

      yield* runWithModel(currentModel);
    } else {
      throw error;
    }
  }

  safeLog('info', 'agent_run_complete', {
    traceId,
    model: currentModel,
    tools: toolsUsed,
    tokens: totalUsage.totalTokens,
  });

  return {
    traceId,
    toolsUsed,
    finalText,
    usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
  };
}

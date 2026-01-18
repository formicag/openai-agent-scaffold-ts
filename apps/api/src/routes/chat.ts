import { Router, Request, Response } from 'express';
import { ChatRequestSchema, safeLog } from '@scaffold/shared';
import type { StreamEvent } from '@scaffold/shared';
import { ApiDatabase } from '../db.js';
import { EmbeddingsService } from '../embeddings.js';
import { runAgentStream } from '../agent.js';
import { getConfig } from '@scaffold/shared';

export function createChatRouter(db: ApiDatabase): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    // Validate request
    const parseResult = ChatRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parseResult.error.issues.map((i) => i.message),
      });
      return;
    }

    const { message, images, conversationId: requestConversationId } = parseResult.data;

    let config;
    try {
      config = getConfig();
    } catch {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    // Get or create conversation
    let conversationId = requestConversationId;
    if (conversationId) {
      const existing = db.getConversation(conversationId);
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
    } else {
      const newConversation = db.createConversation();
      conversationId = newConversation.id;
    }

    // Set up streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const writeEvent = (event: StreamEvent) => {
      res.write(JSON.stringify(event) + '\n');
    };

    let runId: string | undefined;
    let traceId: string | undefined;

    try {
      // Create embeddings service
      const embeddingsService = new EmbeddingsService(
        config.openaiApiKey,
        config.embeddingModel
      );

      // Compute embedding for the user message
      const userEmbedding = await embeddingsService.embed(message);

      // Store user message
      db.addMessage({
        conversationId,
        role: 'user',
        content: message,
        embedding: userEmbedding,
      });

      // Retrieve similar messages for context
      const similarMessages = db.searchSimilarMessages(userEmbedding, 6);
      const memoryContext = {
        messages: similarMessages.map((m) => ({
          role: m.role,
          content: m.content,
          similarity: m.similarity,
          createdAt: m.createdAt,
        })),
      };

      // Get conversation history
      const conversationHistory = db.getConversationMessages(conversationId).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Remove the last message (the one we just added) from history
      conversationHistory.pop();

      // Create run record
      traceId = crypto.randomUUID();
      runId = db.createRun({
        traceId,
        conversationId,
        modelUsed: config.primaryModel,
      });

      // Send meta event
      writeEvent({
        type: 'meta',
        conversationId,
        traceId,
      });

      // Run agent with streaming
      let finalText = '';
      const toolsUsed: string[] = [];

      const generator = runAgentStream({
        message,
        images,
        memoryContext,
        conversationHistory,
        primaryModel: config.primaryModel,
        fallbackModel: config.fallbackModel,
        mcpNotesUrl: config.mcpNotesUrl,
        apiKey: config.openaiApiKey,
      });

      for await (const event of generator) {
        writeEvent(event);
        if (event.type === 'delta') {
          finalText += event.text;
        } else if (event.type === 'tool' && event.status === 'start') {
          toolsUsed.push(event.toolName);
        }
      }

      // Store assistant response
      const assistantEmbedding = await embeddingsService.embed(finalText);
      db.addMessage({
        conversationId,
        role: 'assistant',
        content: finalText,
        embedding: assistantEmbedding,
      });

      // Update conversation timestamp
      db.updateConversationTimestamp(conversationId);

      // Complete run record
      db.completeRun({
        id: runId,
        toolsUsed,
        success: true,
      });

      // Send final event
      writeEvent({
        type: 'final',
        text: finalText,
        traceId,
      });

      safeLog('info', 'chat_complete', {
        traceId,
        conversationId,
        tools: toolsUsed,
        success: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';

      safeLog('error', 'chat_error', {
        traceId,
        conversationId,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });

      if (runId) {
        db.completeRun({
          id: runId,
          toolsUsed: [],
          success: false,
          errorMessage,
        });
      }

      writeEvent({
        type: 'error',
        message: 'An error occurred processing your request',
      });
    } finally {
      res.end();
    }
  });

  return router;
}

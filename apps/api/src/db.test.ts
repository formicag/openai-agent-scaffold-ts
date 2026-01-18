import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiDatabase } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ApiDatabase', () => {
  let db: ApiDatabase;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `api-test-${Date.now()}.sqlite`);
    db = new ApiDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('conversations', () => {
    it('should create and retrieve a conversation', () => {
      const conversation = db.createConversation();

      expect(conversation.id).toBeDefined();
      expect(conversation.createdAt).toBeDefined();

      const retrieved = db.getConversation(conversation.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(conversation.id);
    });

    it('should return null for non-existent conversation', () => {
      const result = db.getConversation('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('messages', () => {
    it('should add and retrieve messages', () => {
      const conversation = db.createConversation();

      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'Hello',
      });

      db.addMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Hi there!',
      });

      const messages = db.getConversationMessages(conversation.id);

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hello');
      expect(messages[1]?.role).toBe('assistant');
      expect(messages[1]?.content).toBe('Hi there!');
    });

    it('should store and retrieve embeddings', () => {
      const conversation = db.createConversation();
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'Test message',
        embedding,
      });

      const messages = db.getConversationMessages(conversation.id);

      expect(messages[0]?.embedding).not.toBeNull();
      expect(messages[0]?.embedding?.length).toBe(4);
      expect(messages[0]?.embedding?.[0]).toBeCloseTo(0.1);
    });
  });

  describe('similarity search', () => {
    it('should find similar messages by embedding', () => {
      const conversation = db.createConversation();

      // Add messages with embeddings
      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'I love pizza',
        embedding: new Float32Array([0.9, 0.1, 0.0, 0.0]),
      });

      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'I enjoy pasta',
        embedding: new Float32Array([0.8, 0.2, 0.0, 0.0]),
      });

      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: 'I hate math',
        embedding: new Float32Array([0.0, 0.0, 0.9, 0.1]),
      });

      // Search with embedding similar to food
      const queryEmbedding = new Float32Array([0.85, 0.15, 0.0, 0.0]);
      const results = db.searchSimilarMessages(queryEmbedding, 2);

      expect(results).toHaveLength(2);
      // Most similar should be "I love pizza"
      expect(results[0]?.content).toBe('I love pizza');
      expect(results[1]?.content).toBe('I enjoy pasta');
    });
  });

  describe('runs', () => {
    it('should create and complete a run', () => {
      const conversation = db.createConversation();

      const runId = db.createRun({
        traceId: 'trace-123',
        conversationId: conversation.id,
        modelUsed: 'gpt-5.1',
      });

      db.completeRun({
        id: runId,
        toolsUsed: ['notes.add', 'notes.search'],
        success: true,
      });

      const runs = db.getRecentRuns(10);

      expect(runs).toHaveLength(1);
      expect(runs[0]?.traceId).toBe('trace-123');
      expect(runs[0]?.toolsUsed).toEqual(['notes.add', 'notes.search']);
      expect(runs[0]?.success).toBe(true);
      expect(runs[0]?.endedAt).not.toBeNull();
    });
  });

  describe('SQL injection prevention', () => {
    it('should safely handle malicious input in message content', () => {
      const conversation = db.createConversation();

      // Attempt SQL injection
      db.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: "'; DROP TABLE messages; --",
      });

      // Database should still work
      const messages = db.getConversationMessages(conversation.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("'; DROP TABLE messages; --");
    });
  });
});

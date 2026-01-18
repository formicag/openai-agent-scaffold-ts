import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { StoredMessage, RunRecord, Conversation } from '@scaffold/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ApiDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const finalPath = dbPath ?? path.join(dataDir, 'api.sqlite');
    this.db = new Database(finalPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        model_used TEXT NOT NULL,
        tools_used TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
    `);
  }

  // Conversation methods
  createConversation(): Conversation {
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, created_at, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, now, now);

    return { id, createdAt: now, updatedAt: now };
  }

  getConversation(id: string): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT id, created_at, updated_at
      FROM conversations
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | { id: string; created_at: string; updated_at: string }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateConversationTimestamp(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  // Message methods
  addMessage(params: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    embedding?: Float32Array;
  }): StoredMessage {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const embeddingBlob = params.embedding ? Buffer.from(params.embedding.buffer) : null;

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, params.conversationId, params.role, params.content, embeddingBlob, createdAt);

    return {
      id,
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      embedding: params.embedding ?? null,
      createdAt,
    };
  }

  getConversationMessages(conversationId: string): StoredMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, conversation_id, role, content, embedding, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      embedding: Buffer | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
      createdAt: row.created_at,
    }));
  }

  // Similarity search for memory retrieval
  searchSimilarMessages(
    embedding: Float32Array,
    limit: number = 6,
    excludeConversationId?: string
  ): Array<StoredMessage & { similarity: number }> {
    // Get all messages with embeddings
    let query = `
      SELECT id, conversation_id, role, content, embedding, created_at
      FROM messages
      WHERE embedding IS NOT NULL
    `;
    const params: unknown[] = [];

    if (excludeConversationId) {
      query += ` AND conversation_id != ?`;
      params.push(excludeConversationId);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      embedding: Buffer;
      created_at: string;
    }>;

    // Calculate cosine similarity in JS (SQLite doesn't have vector ops)
    const results = rows.map((row) => {
      const storedEmbedding = new Float32Array(row.embedding.buffer);
      const similarity = this.cosineSimilarity(embedding, storedEmbedding);
      return {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        embedding: storedEmbedding,
        createdAt: row.created_at,
        similarity,
      };
    });

    // Sort by similarity descending and take top K
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  // Run/trace methods
  createRun(params: {
    traceId: string;
    conversationId: string;
    modelUsed: string;
  }): string {
    const id = uuidv4();
    const startedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO runs (id, trace_id, conversation_id, started_at, model_used, tools_used, success)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(id, params.traceId, params.conversationId, startedAt, params.modelUsed, '[]');

    return id;
  }

  completeRun(params: {
    id: string;
    toolsUsed: string[];
    success: boolean;
    errorMessage?: string;
  }): void {
    const endedAt = new Date().toISOString();
    const toolsJson = JSON.stringify(params.toolsUsed);

    const stmt = this.db.prepare(`
      UPDATE runs
      SET ended_at = ?, tools_used = ?, success = ?, error_message = ?
      WHERE id = ?
    `);
    stmt.run(endedAt, toolsJson, params.success ? 1 : 0, params.errorMessage ?? null, params.id);
  }

  getRecentRuns(limit: number = 20): RunRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, trace_id, conversation_id, started_at, ended_at, model_used, tools_used, success, error_message
      FROM runs
      ORDER BY started_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<{
      id: string;
      trace_id: string;
      conversation_id: string;
      started_at: string;
      ended_at: string | null;
      model_used: string;
      tools_used: string;
      success: number;
      error_message: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      traceId: row.trace_id,
      conversationId: row.conversation_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      modelUsed: row.model_used,
      toolsUsed: JSON.parse(row.tools_used) as string[],
      success: row.success === 1,
      errorMessage: row.error_message,
    }));
  }

  close(): void {
    this.db.close();
  }
}

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface NoteRecord {
  id: string;
  title: string | null;
  content: string;
  tags: string | null; // JSON array stored as string
  created_at: string;
}

export class NotesDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const finalPath = dbPath ?? path.join(dataDir, 'notes.sqlite');
    this.db = new Database(finalPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
    `);
  }

  addNote(params: { title?: string; content: string; tags?: string[] }): {
    id: string;
    createdAt: string;
  } {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

    const stmt = this.db.prepare(`
      INSERT INTO notes (id, title, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, params.title ?? null, params.content, tagsJson, createdAt);

    return { id, createdAt };
  }

  searchNotes(
    query: string,
    limit: number = 10
  ): Array<{
    id: string;
    title: string | null;
    snippet: string;
    tags: string[] | null;
    createdAt: string;
  }> {
    // Simple search: match query in title or content (case-insensitive)
    const searchPattern = `%${query}%`;

    const stmt = this.db.prepare(`
      SELECT id, title, content, tags, created_at
      FROM notes
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(searchPattern, searchPattern, limit) as NoteRecord[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: this.createSnippet(row.content, query),
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
      createdAt: row.created_at,
    }));
  }

  getNote(id: string): {
    id: string;
    title: string | null;
    content: string;
    tags: string[] | null;
    createdAt: string;
  } | null {
    const stmt = this.db.prepare(`
      SELECT id, title, content, tags, created_at
      FROM notes
      WHERE id = ?
    `);

    const row = stmt.get(id) as NoteRecord | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
      createdAt: row.created_at,
    };
  }

  private createSnippet(content: string, _query: string): string {
    // Return first 200 chars as snippet
    if (content.length <= 200) {
      return content;
    }
    return content.slice(0, 200) + '...';
  }

  close(): void {
    this.db.close();
  }
}

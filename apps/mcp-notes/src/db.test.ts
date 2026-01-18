import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotesDatabase } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('NotesDatabase', () => {
  let db: NotesDatabase;
  let testDbPath: string;

  beforeEach(() => {
    // Create a temp database for each test
    testDbPath = path.join(os.tmpdir(), `notes-test-${Date.now()}.sqlite`);
    db = new NotesDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('addNote', () => {
    it('should add a note and return id and createdAt', () => {
      const result = db.addNote({
        content: 'Test note content',
      });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(result.createdAt).toBeDefined();
    });

    it('should add a note with title and tags', () => {
      const result = db.addNote({
        title: 'My Note',
        content: 'Test content',
        tags: ['tag1', 'tag2'],
      });

      const retrieved = db.getNote(result.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('My Note');
      expect(retrieved?.content).toBe('Test content');
      expect(retrieved?.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('searchNotes', () => {
    it('should find notes by content', () => {
      db.addNote({ content: 'The quick brown fox' });
      db.addNote({ content: 'Lazy dog sleeping' });
      db.addNote({ content: 'Fox hunting season' });

      const results = db.searchNotes('fox');

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.snippet.toLowerCase().includes('fox'))).toBe(true);
    });

    it('should find notes by title', () => {
      db.addNote({ title: 'Important Meeting', content: 'Notes from meeting' });
      db.addNote({ title: 'Shopping List', content: 'Buy groceries' });

      const results = db.searchNotes('Meeting');

      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Important Meeting');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        db.addNote({ content: `Note number ${i} about topic` });
      }

      const results = db.searchNotes('topic', 5);

      expect(results).toHaveLength(5);
    });

    it('should return empty array when no matches', () => {
      db.addNote({ content: 'Hello world' });

      const results = db.searchNotes('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('getNote', () => {
    it('should retrieve a note by id', () => {
      const { id } = db.addNote({
        title: 'Test Note',
        content: 'Test content here',
        tags: ['test'],
      });

      const note = db.getNote(id);

      expect(note).not.toBeNull();
      expect(note?.id).toBe(id);
      expect(note?.title).toBe('Test Note');
      expect(note?.content).toBe('Test content here');
      expect(note?.tags).toEqual(['test']);
    });

    it('should return null for non-existent id', () => {
      const note = db.getNote('00000000-0000-0000-0000-000000000000');

      expect(note).toBeNull();
    });
  });

  describe('SQL injection prevention', () => {
    it('should safely handle malicious input in content', () => {
      // Attempt SQL injection
      const result = db.addNote({
        content: "'; DROP TABLE notes; --",
      });

      // Should succeed without breaking the database
      expect(result.id).toBeDefined();

      // Database should still work
      const note = db.getNote(result.id);
      expect(note?.content).toBe("'; DROP TABLE notes; --");
    });

    it('should safely handle malicious input in search', () => {
      db.addNote({ content: 'Normal note' });

      // Attempt SQL injection in search
      const results = db.searchNotes("'; DROP TABLE notes; --");

      // Should return empty results, not crash
      expect(Array.isArray(results)).toBe(true);

      // Database should still work
      const allResults = db.searchNotes('Normal');
      expect(allResults).toHaveLength(1);
    });

    it('should safely handle special characters', () => {
      const specialContent = "Test with % and _ wildcards and 'quotes'";
      const { id } = db.addNote({ content: specialContent });

      const note = db.getNote(id);
      expect(note?.content).toBe(specialContent);
    });
  });
});

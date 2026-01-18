import { describe, it, expect } from 'vitest';
import { redact, safeLogObject } from './redact.js';

describe('redact', () => {
  it('should redact sensitive keys', () => {
    const input = {
      apiKey: 'secret-key-123',
      password: 'mypassword',
      username: 'john',
    };

    const result = redact(input);

    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.username).toBe('john');
  });

  it('should redact nested objects', () => {
    const input = {
      user: 'john',
      auth: {
        token: 'bearer-token',
        apiKey: 'key-123',
      },
    };

    const result = redact(input);

    expect(result.user).toBe('john');
    expect(result.auth).toEqual({
      token: '[REDACTED]',
      apiKey: '[REDACTED]',
    });
  });

  it('should redact authorization header (case insensitive)', () => {
    const input = {
      Authorization: 'Bearer xyz',
      authorization: 'Bearer abc',
      AUTHORIZATION: 'Bearer def',
    };

    const result = redact(input);

    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.AUTHORIZATION).toBe('[REDACTED]');
  });

  it('should redact message content', () => {
    const input = {
      traceId: 'trace-123',
      message: 'User secret message',
      content: 'More secret content',
    };

    const result = redact(input);

    expect(result.traceId).toBe('trace-123');
    expect(result.message).toBe('[REDACTED]');
    expect(result.content).toBe('[REDACTED]');
  });

  it('should redact base64 image data', () => {
    const input = {
      mimeType: 'image/png',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk...',
    };

    const result = redact(input);

    expect(result.mimeType).toBe('image/png');
    expect(result.base64).toBe('[REDACTED]');
  });

  it('should handle arrays', () => {
    const input = {
      items: [
        { id: 1, secret: 'abc' },
        { id: 2, apiKey: 'xyz' },
      ],
    };

    const result = redact(input);

    expect(result.items).toEqual([
      { id: 1, secret: '[REDACTED]' },
      { id: 2, apiKey: '[REDACTED]' },
    ]);
  });

  it('should handle null and undefined', () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('should handle primitives', () => {
    expect(redact('string')).toBe('string');
    expect(redact(123)).toBe(123);
    expect(redact(true)).toBe(true);
  });

  it('should never leak OpenAI API keys', () => {
    const inputs = [
      { openai_api_key: 'sk-...' },
      { openaiApiKey: 'sk-...' },
      { 'openai-api-key': 'sk-...' },
      { OPENAI_API_KEY: 'sk-...' },
    ];

    for (const input of inputs) {
      const result = redact(input);
      const values = Object.values(result);
      expect(values.every((v) => v === '[REDACTED]')).toBe(true);
    }
  });
});

describe('safeLogObject', () => {
  it('should only include allowed fields', () => {
    const input = {
      traceId: 'trace-123',
      conversationId: 'conv-456',
      model: 'gpt-5.1',
      secretField: 'should-not-appear',
      password: 'should-not-appear',
    };

    const result = safeLogObject(input);

    expect(result).toEqual({
      traceId: 'trace-123',
      conversationId: 'conv-456',
      model: 'gpt-5.1',
    });
    expect(result).not.toHaveProperty('secretField');
    expect(result).not.toHaveProperty('password');
  });

  it('should handle missing optional fields', () => {
    const input = {
      traceId: 'trace-123',
    };

    const result = safeLogObject(input);

    expect(result).toEqual({
      traceId: 'trace-123',
    });
  });
});

import OpenAI from 'openai';
import { safeLog } from '@scaffold/shared';

// Per OpenAI best practices: retry with exponential backoff
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  return false;
}

function getRetryDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return exponentialDelay + jitter;
}

export class EmbeddingsService {
  private client: OpenAI;
  private model: string;
  private dimensions: number | undefined;

  /**
   * Create an embeddings service.
   * @param apiKey - OpenAI API key
   * @param model - Embedding model (default: text-embedding-3-large)
   * @param dimensions - Optional dimension reduction (e.g., 1024 or 256 for text-embedding-3-large)
   */
  constructor(
    apiKey: string,
    model: string = 'text-embedding-3-large',
    dimensions?: number
  ) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    // Per OpenAI best practices: use dimensions param to reduce storage/compute
    // text-embedding-3-large supports: 256, 1024, 3072 (default)
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const startTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: text,
          ...(this.dimensions && { dimensions: this.dimensions }),
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
          throw new Error('No embedding returned from API');
        }

        safeLog('info', 'embedding_created', {
          model: this.model,
          dimensions: this.dimensions ?? 'default',
          durationMs: Date.now() - startTime,
        });

        return new Float32Array(embedding);
      } catch (error) {
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          const delay = getRetryDelay(attempt);
          safeLog('warn', 'embedding_retry', {
            attempt: attempt + 1,
            delayMs: Math.round(delay),
            errorType: error instanceof Error ? error.name : 'Unknown',
          });
          await sleep(delay);
        } else {
          safeLog('error', 'embedding_error', {
            model: this.model,
            errorType: error instanceof Error ? error.name : 'Unknown',
            durationMs: Date.now() - startTime,
          });
          throw error;
        }
      }
    }

    throw new Error('Embedding request failed after retries');
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const startTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: texts,
          ...(this.dimensions && { dimensions: this.dimensions }),
        });

        const embeddings = response.data.map((d) => new Float32Array(d.embedding));

        safeLog('info', 'batch_embedding_created', {
          model: this.model,
          dimensions: this.dimensions ?? 'default',
          count: texts.length,
          durationMs: Date.now() - startTime,
        });

        return embeddings;
      } catch (error) {
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          const delay = getRetryDelay(attempt);
          safeLog('warn', 'batch_embedding_retry', {
            attempt: attempt + 1,
            delayMs: Math.round(delay),
            errorType: error instanceof Error ? error.name : 'Unknown',
          });
          await sleep(delay);
        } else {
          safeLog('error', 'batch_embedding_error', {
            model: this.model,
            errorType: error instanceof Error ? error.name : 'Unknown',
            durationMs: Date.now() - startTime,
          });
          throw error;
        }
      }
    }

    throw new Error('Batch embedding request failed after retries');
  }
}

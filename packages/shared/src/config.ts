/**
 * Shared configuration utilities.
 * Reads from environment variables with safe defaults.
 */

export interface AppConfig {
  openaiApiKey: string;
  primaryModel: string;
  fallbackModel: string;
  embeddingModel: string;
  mcpNotesUrl: string;
  apiPort: number;
  mcpNotesPort: number;
}

/**
 * Get configuration from environment variables.
 * Throws if required variables are missing.
 */
export function getConfig(): AppConfig {
  const openaiApiKey = process.env['OPENAI_API_KEY'];
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    openaiApiKey,
    primaryModel: process.env['OPENAI_MODEL_PRIMARY'] ?? 'gpt-5.1',
    fallbackModel: process.env['OPENAI_MODEL_FALLBACK'] ?? 'gpt-5-mini',
    embeddingModel: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-large',
    mcpNotesUrl: process.env['MCP_NOTES_URL'] ?? 'http://localhost:8787/sse',
    apiPort: parseInt(process.env['API_PORT'] ?? '3001', 10),
    mcpNotesPort: parseInt(process.env['MCP_NOTES_PORT'] ?? '8787', 10),
  };
}

/**
 * Get configuration without requiring API key (for tests/evals that may skip).
 */
export function getConfigOptional(): Partial<AppConfig> & Omit<AppConfig, 'openaiApiKey'> {
  return {
    openaiApiKey: process.env['OPENAI_API_KEY'],
    primaryModel: process.env['OPENAI_MODEL_PRIMARY'] ?? 'gpt-5.1',
    fallbackModel: process.env['OPENAI_MODEL_FALLBACK'] ?? 'gpt-5-mini',
    embeddingModel: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-large',
    mcpNotesUrl: process.env['MCP_NOTES_URL'] ?? 'http://localhost:8787/sse',
    apiPort: parseInt(process.env['API_PORT'] ?? '3001', 10),
    mcpNotesPort: parseInt(process.env['MCP_NOTES_PORT'] ?? '8787', 10),
  };
}

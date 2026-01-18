// Message types for conversation storage
export interface StoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  embedding: Float32Array | null;
  createdAt: string;
}

// Conversation metadata
export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// Memory retrieval result
export interface MemoryContext {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    similarity: number;
    createdAt: string;
  }>;
}

// Run/trace record for the runs API
export interface RunRecord {
  id: string;
  traceId: string;
  conversationId: string;
  startedAt: string;
  endedAt: string | null;
  modelUsed: string;
  toolsUsed: string[];
  success: boolean;
  errorMessage: string | null;
}

// Image input for multimodal
export interface ImageInput {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
}

// Agent configuration
export interface AgentConfig {
  primaryModel: string;
  fallbackModel: string;
  embeddingModel: string;
  mcpNotesUrl: string;
  memoryTopK: number;
}

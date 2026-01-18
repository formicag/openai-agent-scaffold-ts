/**
 * Redaction helper for safe logging.
 * Removes sensitive fields from objects before logging.
 */

// All keys should be lowercase since we compare with key.toLowerCase()
const SENSITIVE_KEYS = new Set([
  // Auth & API keys
  'authorization',
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearer',
  'secret',
  'secretkey',
  'secret_key',
  'password',
  'passwd',
  'pwd',
  'credentials',
  'credential',
  // Session & cookies
  'cookie',
  'cookies',
  'session',
  'sessionid',
  'session_id',
  'sid',
  // Personal data
  'ssn',
  'socialsecuritynumber',
  'social_security_number',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  // OpenAI specific
  'openai_api_key',
  'openaiapikey',
  'openai-api-key',
  // Image data (can be large and potentially sensitive)
  'base64',
  'imagedata',
  'image_data',
  // Message content (don't log user prompts)
  'prompt',
  'prompts',
  'content',
  'message',
  'messages',
  'input',
  'inputs',
]);

const REDACTED = '[REDACTED]';

/**
 * Check if a key should be redacted (case-insensitive)
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Deep clone and redact sensitive fields from an object.
 * Returns a new object safe for logging.
 */
export function redact<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return obj.map((item: unknown) => redact(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Create a safe log object with only allowed fields.
 * Use this for structured logging.
 */
export function safeLogObject(data: {
  traceId?: string;
  conversationId?: string;
  model?: string;
  tools?: string[];
  durationMs?: number;
  success?: boolean;
  errorType?: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  const allowedKeys = [
    'traceId',
    'conversationId',
    'model',
    'tools',
    'durationMs',
    'success',
    'errorType',
    'timestamp',
    'level',
    'event',
  ];

  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in data && data[key] !== undefined) {
      result[key] = data[key];
    }
  }
  return result;
}

/**
 * Log helper that automatically redacts and formats.
 */
export function safeLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeLogObject(data ?? {}),
  };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(logData));
}

export interface EvalMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EvalRubric {
  mustContain?: string[];
  mustNotContain?: string[];
  containsAnyOf?: string[];
  minLength?: number;
  maxLength?: number;
  jsonValid?: boolean;
}

export interface EvalCase {
  name: string;
  description: string;
  messages: EvalMessage[];
  rubric: EvalRubric;
}

export interface EvalResult {
  name: string;
  passed: boolean;
  response: string;
  errors: string[];
  durationMs: number;
}

export interface EvalReport {
  totalCases: number;
  passed: number;
  failed: number;
  skipped: number;
  results: EvalResult[];
}

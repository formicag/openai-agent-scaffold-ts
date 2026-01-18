import type { EvalRubric, EvalResult } from './types.js';

export function evaluateResponse(
  caseName: string,
  response: string,
  rubric: EvalRubric,
  durationMs: number
): EvalResult {
  const errors: string[] = [];

  // Check mustContain
  if (rubric.mustContain) {
    for (const term of rubric.mustContain) {
      if (!response.includes(term)) {
        errors.push(`Missing required term: "${term}"`);
      }
    }
  }

  // Check mustNotContain
  if (rubric.mustNotContain) {
    for (const term of rubric.mustNotContain) {
      if (response.toLowerCase().includes(term.toLowerCase())) {
        errors.push(`Contains forbidden term: "${term}"`);
      }
    }
  }

  // Check containsAnyOf
  if (rubric.containsAnyOf && rubric.containsAnyOf.length > 0) {
    const hasAny = rubric.containsAnyOf.some((term) =>
      response.toLowerCase().includes(term.toLowerCase())
    );
    if (!hasAny) {
      errors.push(`Must contain at least one of: ${rubric.containsAnyOf.join(', ')}`);
    }
  }

  // Check minLength
  if (rubric.minLength !== undefined && response.length < rubric.minLength) {
    errors.push(`Response too short: ${response.length} < ${rubric.minLength}`);
  }

  // Check maxLength
  if (rubric.maxLength !== undefined && response.length > rubric.maxLength) {
    errors.push(`Response too long: ${response.length} > ${rubric.maxLength}`);
  }

  // Check JSON validity
  if (rubric.jsonValid) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        JSON.parse(jsonMatch[0]);
      } else {
        errors.push('No valid JSON object found in response');
      }
    } catch {
      errors.push('Response contains invalid JSON');
    }
  }

  return {
    name: caseName,
    passed: errors.length === 0,
    response: response.slice(0, 500) + (response.length > 500 ? '...' : ''),
    errors,
    durationMs,
  };
}

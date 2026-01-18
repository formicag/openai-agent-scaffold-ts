import OpenAI from 'openai';
import { getConfigOptional } from '@scaffold/shared';
import { evaluateResponse } from './evaluator.js';
import type { EvalCase, EvalResult, EvalReport } from './types.js';
import evalCasesData from './evalcases.json' with { type: 'json' };

const evalCases = evalCasesData.cases as EvalCase[];

async function runEval(
  client: OpenAI,
  model: string,
  evalCase: EvalCase
): Promise<EvalResult> {
  const startTime = Date.now();

  try {
    const messages = evalCase.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.1, // Low temperature for deterministic-ish results
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const durationMs = Date.now() - startTime;

    return evaluateResponse(evalCase.name, content, evalCase.rubric, durationMs);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      name: evalCase.name,
      passed: false,
      response: '',
      errors: [`API Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      durationMs,
    };
  }
}

function printTable(results: EvalResult[]): void {
  const nameWidth = 25;
  const statusWidth = 8;
  const timeWidth = 10;

  console.info('\n' + '='.repeat(60));
  console.info('EVAL RESULTS');
  console.info('='.repeat(60));
  console.info(
    'Name'.padEnd(nameWidth) +
      'Status'.padEnd(statusWidth) +
      'Time (ms)'.padEnd(timeWidth) +
      'Errors'
  );
  console.info('-'.repeat(60));

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const statusColor = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.info(
      result.name.slice(0, nameWidth - 1).padEnd(nameWidth) +
        statusColor +
        status.padEnd(statusWidth) +
        reset +
        String(result.durationMs).padEnd(timeWidth) +
        (result.errors.length > 0 ? result.errors[0] : '')
    );

    // Print additional errors indented
    for (let i = 1; i < result.errors.length; i++) {
      console.info(' '.repeat(nameWidth + statusWidth + timeWidth) + result.errors[i]);
    }
  }

  console.info('='.repeat(60));
}

async function main(): Promise<void> {
  const config = getConfigOptional();

  if (!config.openaiApiKey) {
    console.info('\x1b[33m[SKIP]\x1b[0m OPENAI_API_KEY not set. Skipping evals.');
    console.info('To run evals, set OPENAI_API_KEY environment variable.');
    process.exit(0);
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const model = config.primaryModel;

  console.info(`Running ${evalCases.length} eval cases with model: ${model}`);
  console.info('');

  const results: EvalResult[] = [];

  for (const evalCase of evalCases) {
    process.stdout.write(`Running: ${evalCase.name}... `);
    const result = await runEval(client, model, evalCase);
    results.push(result);

    if (result.passed) {
      console.info('\x1b[32mPASS\x1b[0m');
    } else {
      console.info('\x1b[31mFAIL\x1b[0m');
    }
  }

  printTable(results);

  const report: EvalReport = {
    totalCases: evalCases.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    skipped: 0,
    results,
  };

  console.info(`\nSummary: ${report.passed}/${report.totalCases} passed`);

  if (report.failed > 0) {
    console.info('\x1b[31mSome evals failed.\x1b[0m');
    process.exit(1);
  } else {
    console.info('\x1b[32mAll evals passed!\x1b[0m');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Eval runner error:', error);
  process.exit(1);
});

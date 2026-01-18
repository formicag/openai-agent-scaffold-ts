import { Router, Request, Response } from 'express';
import { ApiDatabase } from '../db.js';

export function createRunsRouter(db: ApiDatabase): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const runs = db.getRecentRuns(20);

    // Return only safe metadata
    const safeRuns = runs.map((run) => ({
      id: run.id,
      traceId: run.traceId,
      conversationId: run.conversationId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      modelUsed: run.modelUsed,
      toolsUsed: run.toolsUsed,
      success: run.success,
    }));

    res.json({ runs: safeRuns });
  });

  return router;
}

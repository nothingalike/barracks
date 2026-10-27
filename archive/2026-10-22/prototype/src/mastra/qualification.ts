import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { inspectLocalRuntime } from '../qualification/local-runtime.ts';

const inspect = createStep({
  id: 'inspect-local-runtime',
  inputSchema: z.object({ liveDispatch: z.literal(false) }).strict(),
  outputSchema: z.object({ report: z.unknown() }),
  execute: async () => ({ report: await inspectLocalRuntime() }),
});

export const qualificationWorkflow = createWorkflow({
  id: 'qualify-local-runtime',
  inputSchema: z.object({ liveDispatch: z.literal(false) }).strict(),
  outputSchema: z.object({ report: z.unknown() }),
  options: { autoRestartActiveRuns: false },
}).then(inspect).commit();
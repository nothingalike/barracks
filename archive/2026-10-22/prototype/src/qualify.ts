import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { qualificationWorkflow } from './mastra/qualification.ts';

const state = resolve('.barracks');
await mkdir(state, { recursive: true });
const storage = new LibSQLStore({ id: 'barracks-local', url: `file:${resolve(state, 'mastra.db').replaceAll('\\', '/')}` });
const mastra = new Mastra({ storage, workflows: { qualificationWorkflow } });
try {
  const run = await mastra.getWorkflow('qualificationWorkflow').createRun();
  const result = await run.start({ inputData: { liveDispatch: false } });
  if (result.status !== 'success') throw new Error(`Qualification workflow ${result.status}`);
  const report = { runId: run.runId, ...result.result as { report: unknown } };
  await writeFile(resolve(state, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mastra.shutdown();
  await storage.close();
}
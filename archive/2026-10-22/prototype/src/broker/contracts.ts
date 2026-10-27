import { z } from 'zod';

export const launchSpec = z.object({
  kind: z.literal('qualification-fixture'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const processIdentity = z.object({
  pid: z.number().int().positive(), startUtc: z.iso.datetime(),
}).strict();
export type LaunchSpec = z.infer<typeof launchSpec>;
export type ProcessIdentity = z.infer<typeof processIdentity>;
export interface LaunchRecord {
  jobId: string; spec: LaunchSpec;
  state: 'reserved' | 'running' | 'reconciliation-required' | 'terminal';
  identity: ProcessIdentity | null; reason: string | null;
}

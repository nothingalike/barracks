import { z } from 'zod';

export const participantId = z.enum(['lead', 'ba', 'builder-a', 'builder-b']);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const workerResult = z.object({
  jobId: z.string().min(1),
  project: z.string().min(1),
  ticket: z.string().min(1),
  participant: participantId,
  attempt: z.number().int().positive(),
  baseSha: sha,
  candidateSha: sha,
  status: z.enum(['ready-for-review', 'blocked', 'failed']),
  requestedNextAction: z.enum(['independent-review', 'unblock', 'repair']),
  evidence: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
  blocker: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'ready-for-review' &&
      (value.evidence.length === 0 || value.requestedNextAction !== 'independent-review')) {
    ctx.addIssue({ code: 'custom', message: 'Review handoffs require evidence and a review request.' });
  }
  if (value.status === 'blocked' && (!value.blocker || value.requestedNextAction !== 'unblock')) {
    ctx.addIssue({ code: 'custom', message: 'Blocked work requires an explicit reason and unblock request.' });
  }
  if (value.status === 'failed' && value.requestedNextAction !== 'repair') {
    ctx.addIssue({ code: 'custom', message: 'Failed work requires a repair request.' });
  }
});

// Qualification cannot activate a team or grant repository mutation authority.
export const qualificationProject = z.object({
  id: z.string().min(1),
  repository: z.string().min(1),
  integrationBranch: z.string().min(1),
  protectedBranches: z.array(z.string()).min(1),
  participants: z.array(participantId).length(4),
  liveDispatch: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.participants).size !== 4) {
    ctx.addIssue({ code: 'custom', message: 'Configure each of the four participants exactly once.' });
  }
  if (value.protectedBranches.includes(value.integrationBranch)) {
    ctx.addIssue({ code: 'custom', message: 'The integration branch cannot be protected.' });
  }
});
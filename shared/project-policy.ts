import {z} from 'zod';
import {sourceGrantSchema} from './source-grants.ts';
import {reviewAxisSchema} from './participants.ts';
import {evidenceKindSchema} from './evidence.ts';
export const deliveryPolicySchema=z.object({
  selection:z.enum(['epic','explicit']).default('epic'),excludeLabels:z.array(z.string().min(1)).default([]),excludeRollups:z.boolean().default(false),
  requirePathGrants:z.boolean().default(false),sharedPaths:z.array(sourceGrantSchema).default([]),leadDelegation:z.enum(['listed','project']).default('listed'),reviewAxes:z.array(reviewAxisSchema).default([]),
  evidencePolicy:z.enum(['legacy','explicit']).default('legacy'),requireEvidenceKinds:z.array(evidenceKindSchema).default([]),completion:z.enum(['review','accepted']).default('review'),publication:z.enum(['working-tree','reviewed-branch']).default('working-tree')
}).strict();
export const leadDelegationUpdateSchema=z.object({mode:z.enum(['listed','project']),reason:z.string().trim().min(1).max(8000)}).strict();

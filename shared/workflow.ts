import { z } from 'zod';
import {interfaceRequestSchema,sourceGrantSchema,leadMayGrant,type SourceDelegation} from './source-grants.ts';
import type {ReviewAxis} from './participants.ts';
import {evidenceRequirementSchema,type EvidenceRequirement} from './evidence.ts';
import type {TicketCriterion} from './ticket-criteria.ts';

export const states = ['queued', 'refining', 'ready', 'implementing', 'reviewing', 'blocked', 'complete', 'cancelled'] as const;
export type State = typeof states[number];
export type Stage = 'queued' | 'refining' | 'implementing' | 'reviewing' | 'blocked';
export type Role = 'lead' | 'ba' | 'builder' | 'reviewer';
export const roleFor: Record<Stage, Role> = { queued: 'lead', refining: 'ba', implementing: 'builder', reviewing: 'reviewer',blocked:'lead' };
export const configSchema = z.object({
  name: z.string().min(1), mode: z.enum(['simulation','mixed']),
  parallelism: z.object(Object.fromEntries(states.map(state => [state, z.number().int().min(1).max(32).default(1)])) as Record<State, z.ZodDefault<z.ZodNumber>>),
  simulationDelayMs: z.number().int().min(10).max(60000),
  maxReviewCycles: z.number().int().min(1).nullable(),
  maxTechnicalResolutions:z.number().int().min(0).max(10).default(1),
  maxRepeatedReviewFindings:z.number().int().min(2).max(10).default(3),
}).strict();
export type WorkflowConfig = z.infer<typeof configSchema>;
export const inputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10000).default(''),
  specificationReady: z.boolean().default(false),
  requestChangesOnce: z.boolean().default(true),
  execution: z.enum(['simulation','codex']).default('simulation'),
  projectId: z.string().regex(/^[a-z0-9-]+$/).default('demo'),
}).strict();
export type TaskInput = z.input<typeof inputSchema>;
export interface Task extends z.output<typeof inputSchema> {
  projectSnapshot?:unknown;
  writablePaths?:string[];
  interfaceRequest?:z.infer<typeof interfaceRequestSchema>;
  reviewVerdicts?:Partial<Record<ReviewAxis,{candidate:string;approved:boolean;reviewer:string;assignmentId:string;notes:string}>>;
  acceptanceCriteria?:TicketCriterion[];
  evidenceRequirements?:EvidenceRequirement[];
  transferContext?:{transferId:string;participantId:string;sourceHead:string;priorReviewPins:string[];nextAction:string;conflicts:boolean};
  id: string; state: State; createdAt: string; updatedAt: string;
  candidate: string | null; verified: boolean; author: string | null;
  reviewCycles: number; resumeState: State | null; blocker: string | null;
  reviewNotes?: string; resolution?: string; cancelRequested?: boolean; cleanupRequired?: boolean;
  plan?:string;triageNotes?:string;
  baseTaskId?:string;baseCandidate?:string;
  coordinated?:boolean;
  blockerKind?:'technical'|'product'|'authority'|'recovery';technicalAttempts?:number;
  repeatedReviewFindings?:number;
  lastRejectedCandidate?:string;unchangedCandidateReviews?:number;
  worktree?:{runId:string;commit:string};
}
export interface Assignment {
  participantId?:string;
  reviewAxis?:ReviewAxis;
  id: string; taskId: string; stage: Stage; role: Role; worker: string;
  candidate: string | null; status: 'running' | 'finished' | 'cancelled' | 'interrupted';
  startedAt: string;
}
export interface HistoryEntry { id: number; taskId: string; at: string; message: string }
export const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('triaged'), specificationReady: z.boolean(),summary:z.string().optional(),requirements:z.array(evidenceRequirementSchema).optional(),ownedPaths:z.array(sourceGrantSchema).optional() }).strict(),
  z.object({ kind: z.literal('refined'),summary:z.string().optional(),requirements:z.array(evidenceRequirementSchema).optional() }).strict(),
  z.object({ kind: z.literal('built'), candidate: z.string().regex(/^[a-f0-9]{40}$/), verified: z.boolean() }).strict(),
  z.object({ kind: z.literal('reviewed'), candidate: z.string().regex(/^[a-f0-9]{40}$/), approved: z.boolean(), notes: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('blocked'), reason: z.string().min(1),blockerKind:z.enum(['technical','product','authority','recovery']).default('product'),interfaceRequest:interfaceRequestSchema.optional() }).strict(),
  z.object({kind:z.literal('resolved'),resolution:z.string().min(1),grantedPaths:z.array(sourceGrantSchema).optional(),ownedPaths:z.array(sourceGrantSchema).optional()}).strict(),
]);
export type WorkerResult = z.infer<typeof resultSchema>;

/** Validate the assignment's result before advancing any persisted state. */
export function advance(task: Task, assignment: Assignment, result: WorkerResult, config: WorkflowConfig): Task {
  if (assignment.taskId !== task.id || assignment.stage !== task.state || assignment.status !== 'running' || roleFor[assignment.stage] !== assignment.role) throw new Error('Result does not match the active task assignment.');
  const next = { ...task, updatedAt: new Date().toISOString() };
  if (result.kind === 'blocked') {if(result.interfaceRequest&&(assignment.role!=='builder'||result.blockerKind!=='technical'))throw Error('Shared-interface coordination is a Builder technical request.');return { ...next, state: 'blocked', resumeState: task.state==='blocked'?task.resumeState:task.state, blocker: result.reason,blockerKind:result.blockerKind,interfaceRequest:result.interfaceRequest };}
  if(task.state==='blocked'&&result.kind==='resolved'){
    if(!task.resumeState||task.cleanupRequired)throw new Error('Lead cannot resolve an unreconciled process attempt.');
    for(const path of result.grantedPaths??[])if(!task.interfaceRequest?.paths.includes(path)||!leadMayGrant(task.projectSnapshot as SourceDelegation|undefined,path))throw Error('Lead path grant exceeds the requested project delegation: '+path);
    return {...next,state:task.resumeState,resumeState:null,blocker:null,blockerKind:undefined,resolution:result.resolution,interfaceRequest:undefined,writablePaths:task.writablePaths===undefined?undefined:[...new Set([...task.writablePaths,...result.grantedPaths??[]])],repeatedReviewFindings:0,lastRejectedCandidate:undefined,unchangedCandidateReviews:0};
  }
  if (task.state === 'queued' && result.kind === 'triaged') return { ...next, state: result.specificationReady ? 'ready' : 'refining', specificationReady: result.specificationReady,triageNotes:result.summary,evidenceRequirements:result.requirements??task.evidenceRequirements };
  if (task.state === 'refining' && result.kind === 'refined') return { ...next, state: 'ready', specificationReady: true,plan:result.summary,evidenceRequirements:result.requirements??task.evidenceRequirements };
  if (task.state === 'implementing' && result.kind === 'built') {
    if (!result.verified) return { ...next, state: 'blocked', resumeState: 'implementing', blocker: 'Implementation verification failed.' };
    return { ...next, state: 'reviewing', candidate: result.candidate, verified: true, author: assignment.worker,reviewVerdicts:undefined };
  }
  if (task.state === 'reviewing' && result.kind === 'reviewed') {
    if (!task.candidate || result.candidate !== task.candidate || assignment.candidate !== task.candidate || !task.verified) throw new Error('Review must match the verified candidate revision.');
    if (assignment.worker === task.author || assignment.role !== 'reviewer') throw new Error('Review requires an independent Reviewer.');
    const reviewCycles = task.reviewCycles + 1;
    next.reviewNotes = result.notes;
    if (result.approved) return { ...next, state: 'complete', reviewCycles,repeatedReviewFindings:0,lastRejectedCandidate:undefined,unchangedCandidateReviews:0 };
    const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
    next.repeatedReviewFindings=task.reviewNotes&&normalize(task.reviewNotes)===normalize(result.notes)?(task.repeatedReviewFindings??1)+1:1;
    next.lastRejectedCandidate=result.candidate;
    next.unchangedCandidateReviews=task.lastRejectedCandidate===result.candidate?(task.unchangedCandidateReviews??0)+1:1;
    if(next.unchangedCandidateReviews>=config.maxRepeatedReviewFindings)return {...next,state:'blocked',resumeState:'implementing',verified:false,reviewCycles,blockerKind:'technical',blocker:'The unchanged candidate was rejected repeatedly without source progress. Lead must resolve the evidence, environment or implementation blocker before another build/review cycle.'};
    if(next.repeatedReviewFindings>=config.maxRepeatedReviewFindings)return {...next,state:'blocked',resumeState:'implementing',verified:false,reviewCycles,blockerKind:'technical',blocker:'The same review findings recurred across implementation attempts. Lead intervention is required.'};
    if (config.maxReviewCycles !== null && reviewCycles >= config.maxReviewCycles) return { ...next, state: 'blocked', resumeState: 'implementing', reviewCycles, blocker: 'Configured review cycle budget exhausted; Lead intervention required.' };
    return { ...next, state: 'implementing', verified: false, reviewCycles };
  }
  throw new Error(`Unexpected ${result.kind} result for ${task.state}.`);
}

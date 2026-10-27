import {readFileSync,mkdirSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {WorkflowRun} from '../shared/factory.ts';
import {ticketPlanSchema} from '../shared/factory.ts';
import {currentState,stateInputs,type HandoffResult} from '../shared/state-machine.ts';
import {prepare,candidate,inventory,runtimeSettings,verificationTool,runProject} from './projects.ts';
import {runOwned,reconcileProcess,CommandFailedError,RepeatedFailureError} from './process.ts';
import {deliveryCandidate} from './delivery-candidate.ts';
import {verificationPlan} from './verification.ts';
import {prepareReview,assertReviewCandidate,saveReviewEvidence} from './review-evidence.ts';
import {runVerification,projectEnvironment} from './project-command.ts';
import {validateRunEvidence} from './acceptance-evidence.ts';
import {EvidenceLedger,approvedEvidenceFile} from './evidence-ledger.ts';
export const acceptanceCriterionSchema=z.object({criterion:z.string().min(1),status:z.enum(['passed','failed','unverified','waived']),evidence:z.string().min(1),evidenceIds:z.array(z.string().uuid()).optional()}).strict();
export type DiscoveryReply=HandoffResult&{document:string;questions:string[];plan:unknown;criteria?:z.infer<typeof acceptanceCriterionSchema>[]};
export function validateAcceptance(reply:DiscoveryReply,required:string[]=[]){
  const criteria=z.array(acceptanceCriterionSchema).min(1).parse(reply.criteria);
  if(required.some(id=>!criteria.some(item=>item.criterion===id)))throw new InvalidWorkerOutput('Acceptance must report every supplied criterion ID: '+required.join(', '));
  if(new Set(criteria.map(item=>item.criterion)).size!==criteria.length)throw new InvalidWorkerOutput('Acceptance criteria must have unique IDs.');
  if(reply.event==='acceptance_passed'&&criteria.some(item=>!['passed','waived'].includes(item.status)))throw new InvalidWorkerOutput('Acceptance passes only when every criterion is passed or explicitly waived with evidence.');
  if(reply.event==='changes'&&!criteria.some(item=>item.status==='failed'))throw new InvalidWorkerOutput('Acceptance changes require a failed criterion and reproduction evidence.');
  if(reply.event==='blocked'&&(!reply.questions.length||!criteria.some(item=>item.status==='unverified')))throw new InvalidWorkerOutput('Blocked acceptance requires an unverified criterion and a concrete resolution question.');
  return criteria;
}
export class InvalidWorkerOutput extends Error {readonly cleanupConfirmed=true;}
export class DiscoveryAgent {
  private execute:typeof runOwned;
  constructor(execute:typeof runOwned=runOwned){this.execute=execute;}
  async run(run:WorkflowRun,signal:AbortSignal,checkpoint:()=>void):Promise<DiscoveryReply>{
    const state=currentState(run.definition,run.phase);if(state.type!=='agent'||!['conversation','acceptance','retrospective','resolve-delivery','integrate-tickets'].includes(state.executor??'')||!state.persona)throw Error('This state does not assign a read-only document worker.');
    const persona=run.personaInstructions[state.persona];if(!persona)throw Error('The task has no pinned instructions for persona '+state.persona);
    const inputs=stateInputs(state,run.artifacts),events=Object.keys(state.on).filter(event=>event!=='invalid_output'&&!(state.executor==='integrate-tickets'&&event==='repair_started'));if(!events.length)throw Error('This worker state has no configured worker events.');
    const transferred=run.artifacts.transfer_snapshot as {id:string;contexts:unknown;retainedDecisions:unknown;pendingActions:unknown;artifacts:unknown}|undefined;if(transferred)inputs.transfer_context={id:transferred.id,roles:transferred.contexts,retainedDecisions:transferred.retainedDecisions,pendingActions:transferred.pendingActions,priorArtifacts:transferred.artifacts};
    const acceptance=state.executor==='acceptance',integration=state.executor==='integrate-tickets',delivery=acceptance||integration||state.executor==='retrospective'||state.executor==='resolve-delivery';
    const planning=Object.values(state.on).some(edge=>Object.values(edge.outputs).some(source=>source==='plan'||source.startsWith('plan.')));
    const inspected=integration?run.parallel?.plan?.candidate:run.baseCandidate;
    const context=integration?prepare({id:run.parallel!.plan!.taskId,projectId:run.projectId}):delivery?deliveryCandidate(run):prepare({id:run.id,projectId:run.projectId,projectSnapshot:runProject(run)}),settings=runtimeSettings(),attempt=join(context.root,'discovery',randomUUID());mkdirSync(attempt,{recursive:true});run.attempts.push(attempt);checkpoint();
    let directory=context.workspace;
    if(delivery){if(candidate(context.root)!==inspected)throw Error('Supplied delivery inspection candidate changed.');const evidence=prepareReview(context,'delivery-'+randomUUID(),inspected!);directory=evidence.directory;inputs.candidate_evidence=evidence;}
    const sourceBefore=inventory(context.workspace),before=inventory(directory);
    if(acceptance||integration){
      if(acceptance&&inputs.delivery_candidate!==run.baseCandidate)throw Error('Acceptance input does not match the delivered candidate.');
      const commands=verificationPlan(context.project,context.root);
      const required=acceptance?run.artifacts.acceptance_criteria as {id:string}[]:[];
      if(!commands.length)return {event:integration?'technical_blocker':'blocked',document:'The delivered candidate has no executable verification plan.',questions:['Configure meaningful verification for this project before retrying.'],plan:null,...(acceptance?{criteria:required.map(item=>({criterion:item.id,status:'unverified' as const,evidence:'No executable verification plan is available.'}))}:{})};
      const receipts=[];
      for(const [index,command] of commands.entries()){
        const capture=()=>new EvidenceLedger(run.id).command(inspected!,command,join(attempt,'verify-'+index),(command.artifacts??[]).filter(artifact=>existsSync(join(directory,artifact.path))).map(artifact=>({...artifact,name:artifact.name??basename(artifact.path),path:approvedEvidenceFile(directory,artifact.path)})),command.evidenceKind??'command');
        try{const result=await runVerification({project:context.project,workspace:directory,node:context.node},command,join(attempt,'verify-'+index),signal,this.execute);const receiptDirectory=join(attempt,'verify-'+index);receipts.push({command,exitCode:result.exitCode,stdoutTail:result.stdout.slice(-8000),stderrTail:result.stderr.slice(-1000),receiptDirectory});if(acceptance&&run.artifacts.acceptance_requirements)new EvidenceLedger(run.id).command(inspected!,command,receiptDirectory,(command.artifacts??[]).map(artifact=>({...artifact,name:artifact.name??basename(artifact.path),path:approvedEvidenceFile(directory,artifact.path)})),command.evidenceKind??'command');}
        catch(error){if(error instanceof CommandFailedError){const failed=acceptance&&run.artifacts.acceptance_requirements?capture():undefined;return {event:integration?'technical_blocker':'changes',document:'Combined verification failed: '+error.message+(failed?' Retained failed measurement: '+failed.id:''),questions:integration?[error.message]:[],plan:null,...(acceptance?{criteria:[...required.map(item=>({criterion:item.id,status:'unverified' as const,evidence:'Cumulative verification failed before user-journey inspection.'})),{criterion:'Cumulative verification',status:'failed' as const,evidence:error.message,evidenceIds:failed?[failed.id]:[]}]}:{})};}throw error;}
      }
      const verified=inventory(directory);for(const [name,hash] of Object.entries(before))if(verified[name]!==hash)throw Error('Acceptance verification changed candidate source: '+name);
      assertReviewCandidate(directory,inspected!);if(integration){if(candidate(context.root)!==inspected)throw Error('Integration candidate changed during verification.');}else deliveryCandidate(run);
      inputs.verification_receipts={candidate:inspected,commands:receipts,attempt};
      if(acceptance&&run.artifacts.acceptance_requirements){
        inputs.acceptance_requirements=run.artifacts.acceptance_requirements;
        inputs.evidence_ledger=new EvidenceLedger(run.id).list(inspected);
        inputs.evidence_citation_rules='For EACH passed criterion, evidenceIds must cover EVERY kind in its acceptance_requirements entry. A source receipt proves source inspection only. A passed unit receipt containing command metadata can cover both unit and command. Cite command/unit receipts for each applicable criterion, even when the same workspace test receipt supports several criteria. Cite only actual matching-candidate receipts and inspect their coverage. Missing evidence remains unverified; a malformed citation is an output correction, not an operator decision.';
      }
    }
    if(delivery)saveReviewEvidence(directory,{candidate:inputs.candidate_evidence,verification:inputs.verification_receipts});
    const evidenceContract=delivery?'\nThe runner supplied candidate_evidence with resolvable candidate and baseline Git trees and a full local diff. Trees need no commit or HEAD. Use git -c '+JSON.stringify('safe.directory='+directory.replaceAll('\\','/'))+' diff '+(inputs.candidate_evidence as {baseline:string}).baseline+' '+inspected+' -- for source comparison. Node executable: '+context.node+(acceptance||integration?'. Independent write-capable checks ran before this assignment; verification_receipts contains their actual exit codes and output. Read those receipts and inspect the executed test procedures to map coverage to criteria; distinguish that evidence from any additional observations.':'. No fresh verification was run for this assignment. Use the supplied acceptance report and retained execution evidence; state any gaps explicitly.')+' Keep source read-only. Missing environment/evidence is a technical_blocker when that event is configured; describe the missing capability and unverified criteria. No source defect is established merely because a write-capable command cannot be rerun by this read-only model.':'';
    const prompt=`${persona}\nCurrent state: ${run.phase}\nState assignment: ${state.instructions}\nHandoff inputs: ${JSON.stringify(inputs)}\nAllowed events and handoffs: ${JSON.stringify(state.on)}${evidenceContract}\nReturn JSON {event,document,questions,plan${acceptance?',criteria':''}}. ${acceptance?'criteria must enumerate every acceptance_criteria ID exactly as criterion, with {criterion,status,evidence,evidenceIds}, status passed, failed, unverified or waived. When evidence_ledger is supplied, cite its exact receipt IDs for every passed/waived criterion according to acceptance_requirements. Prose cannot substitute for receipts. Only an explicit operator waiver permits waived status. Additional epic journey criteria may be included with distinct names. Report concrete commands/steps and observations as evidence. acceptance_passed requires every criterion passed; changes requires a failed criterion; blocked requires unverified criteria and resolution questions.':''} event must be one of ${events.join(', ')}. Use plan:null unless producing an epic/ticket plan. The runner applies configured outputs, guards and next state; select an allowed outcome. Work read-only in the supplied candidate workspace. The runner writes artifacts. Use local inspection only, without delegation, source edits, Git commits or external communication.`;
    const schema={type:'object',properties:{event:{type:'string',enum:events},document:{type:'string'},questions:{type:'array',items:{type:'string'}},plan:{anyOf:[{type:'null'},{type:'object',properties:{epic:{type:'object',properties:{title:{type:'string'},description:{type:'string'}},required:['title','description'],additionalProperties:false},tickets:{type:'array',items:{type:'object',properties:{title:{type:'string'},description:{type:'string'},acceptanceCriteria:{type:'array',items:{type:'string'}},dependsOn:{type:'array',items:{type:'integer'}}},required:['title','description','acceptanceCriteria','dependsOn'],additionalProperties:false}}},required:['epic','tickets'],additionalProperties:false}]}},required:['event','document','questions','plan'],additionalProperties:false};
    if(acceptance)Object.assign(schema,{properties:{...schema.properties,criteria:{type:'array',items:{type:'object',properties:{criterion:{type:'string'},status:{type:'string',enum:['passed','failed','unverified','waived']},evidence:{type:'string'},evidenceIds:{type:'array',items:{type:'string'}}},required:['criterion','status','evidence','evidenceIds'],additionalProperties:false}}},required:[...schema.required,'criteria']});
    if(!planning)Object.assign(schema.properties,{plan:{type:'null'}});
    writeFileSync(join(attempt,'schema.json'),JSON.stringify(schema));writeFileSync(join(attempt,'prompt.txt'),prompt);const workerBefore=inventory(directory);
    try{await this.execute({executable:settings.codexExecutable,args:['--no-daemon','exec','--ignore-user-config','--disable','multi_agent','--disable','multi_agent_v2','--sandbox','read-only','-c','windows.sandbox="elevated"','-c','approval_policy="never"','--skip-git-repo-check','--json','--output-schema',join(attempt,'schema.json'),'--output-last-message',join(attempt,'reply.json'),'-C',directory,'-'],cwd:directory,node:context.node,input:prompt,directory:join(attempt,'codex'),signal,timeoutMs:state.assignmentTimeoutMs===undefined?settings.attemptTimeoutMs:state.assignmentTimeoutMs,supervision:{workspace:directory,warningAfterMs:settings.inactivityWarningMs}});}
    catch(error){
      if(error instanceof RepeatedFailureError){
        if(JSON.stringify(sourceBefore)!==JSON.stringify(inventory(context.workspace))||JSON.stringify(workerBefore)!==JSON.stringify(inventory(directory)))throw Error('Read-only worker changed source; loop result refused.');
        const event=state.on.technical_blocker?'technical_blocker':state.on.needs_user?'needs_user':state.on.blocked?'blocked':undefined;
        if(event)return {event,document:error.message,questions:['Resolve the repeated command failure using the retained worker evidence before retrying.'],plan:null,...(acceptance?{criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:'unverified' as const,evidence:error.message}))}:{})};
      }
      throw error;
    }
    if(JSON.stringify(sourceBefore)!==JSON.stringify(inventory(context.workspace))||JSON.stringify(workerBefore)!==JSON.stringify(inventory(directory)))throw Error('Read-only worker changed source; result refused.');
    if(delivery){if(integration){if(candidate(context.root)!==inspected)throw Error('Integration source changed during Lead review.');}else deliveryCandidate(run);assertReviewCandidate(directory,inspected!);}
    let raw:unknown;try{raw=JSON.parse(readFileSync(join(attempt,'reply.json'),'utf8'));}catch{throw new InvalidWorkerOutput('Reply must be valid JSON matching the supplied response schema.');}
    const fields={event:z.string().refine(value=>events.includes(value),'Event is not configured for this state.'),document:z.string().min(1),questions:z.array(z.string()),plan:planning?ticketPlanSchema.nullable():z.null()};
    const parsed=(acceptance?z.object({...fields,criteria:z.array(acceptanceCriterionSchema).min(1)}):z.object(fields)).strict().safeParse(raw);
    if(!parsed.success)throw new InvalidWorkerOutput('Correct the structured reply: '+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('; ')+'. Ticket dependency indexes are zero-based: first ticket [], second ticket [0] if it depends on the first.');
    if(acceptance){validateAcceptance(parsed.data,(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>item.id));try{validateRunEvidence(run,inspected!,('criteria' in parsed.data)?parsed.data.criteria:undefined);}catch(error){throw new InvalidWorkerOutput(String(error));}}
    return parsed.data;
  }
  async reconcile(run:Pick<WorkflowRun,'attempts'>){for(const attempt of run.attempts)for(const entry of readdirSync(attempt,{withFileTypes:true}))if(entry.isDirectory()&&(entry.name==='codex'||/^verify-\d+$/.test(entry.name)))await reconcileProcess(join(attempt,entry.name));}
}

import {readFileSync,mkdirSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import type {Worker} from './runner.ts';
import type {Assignment,Task,WorkerResult} from '../shared/workflow.ts';
import {runOwned,reconcileProcess,readJson,readActivity,CommandFailedError,RepeatedFailureError} from './process.ts';
import {prepare,candidate,inventory,checkProtected,taskRoot,runtimeSettings,verificationTool,verificationCommandSchema} from './projects.ts';
import {verificationPlan,establishVerification} from './verification.ts';
import {prepareReview,assertReviewCandidate,saveReviewEvidence} from './review-evidence.ts';
import {runVerification,projectEnvironment} from './project-command.ts';
import {interfaceRequestSchema,sourceGrantSchema,assertSourceGrants,sourceDelegationInstructions} from '../shared/source-grants.ts';
import {evidenceRequirementSchema,type EvidenceRequirement} from '../shared/evidence.ts';
const stageActions={queued:['ready','refine','blocked'],refining:['refined','blocked'],implementing:['implemented','blocked'],reviewing:['approved','changes','blocked'],blocked:['resolved','blocked']} as const;
export function parseReply(stage:Assignment['stage'],raw:unknown,withVerification=false):{action:string;summary:string;blockerKind:'none'|'technical'|'product'|'authority'|'recovery';verificationCommands?:z.infer<typeof verificationCommandSchema>[];interfaceRequest?:z.infer<typeof interfaceRequestSchema>|null;grantedPaths?:string[];ownedPaths?:string[];requirements?:EvidenceRequirement[]} {
  const base=z.object({action:z.enum(stageActions[stage]),summary:z.string().min(1),blockerKind:z.enum(['none','technical','product','authority','recovery']),interfaceRequest:stage==='implementing'?interfaceRequestSchema.nullable().optional():z.null().optional(),grantedPaths:z.array(sourceGrantSchema).optional(),ownedPaths:z.array(sourceGrantSchema).optional(),requirements:z.array(evidenceRequirementSchema).optional()}).strict();
  return withVerification?base.extend({verificationCommands:z.array(verificationCommandSchema).max(10)}).parse(raw):base.parse(raw);
}
function responseSchema(stage:Assignment['stage'],withVerification=false){return {type:'object',properties:{action:{type:'string',enum:stageActions[stage]},summary:{type:'string'},blockerKind:{type:'string',enum:['none','technical','product','authority','recovery']},interfaceRequest:stage==='implementing'?{anyOf:[{type:'null'},{type:'object',properties:{question:{type:'string'},paths:{type:'array',items:{type:'string'}}},required:['question','paths'],additionalProperties:false}]}:{type:'null'},grantedPaths:{type:'array',items:{type:'string'}},ownedPaths:{type:'array',items:{type:'string'}},requirements:{type:'array',items:{type:'object',properties:{criterion:{type:'string'},kinds:{type:'array',items:{type:'string',enum:['command','source','unit','native','browser','physical']}}},required:['criterion','kinds'],additionalProperties:false}},...(withVerification?{verificationCommands:{type:'array',items:{type:'object',properties:{executable:{type:'string'},args:{type:'array',items:{type:'string'}},sandbox:{type:'string',enum:['read-only','workspace-write']}},required:['executable','args','sandbox'],additionalProperties:false}}}:{})},required:['action','summary','blockerKind','interfaceRequest','grantedPaths','ownedPaths','requirements',...(withVerification?['verificationCommands']:[])],additionalProperties:false};}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class CodexWorker implements Worker {
  private execute:typeof runOwned;
  constructor(execute:typeof runOwned=runOwned){this.execute=execute;}
  async run(assignment:Assignment,task:Task,signal:AbortSignal,instructions?:{persona:string;assignment:string;timeoutMs?:number|null}):Promise<WorkerResult>{
    const context=prepare(task),{root,workspace,node,project}=context,settings=runtimeSettings();
    let commands=verificationPlan(project,root);
    const needsVerification=assignment.role==='builder'&&commands.length===0;
    if(assignment.role==='builder'&&project.delivery?.requirePathGrants&&!task.writablePaths?.length)return {kind:'blocked',blockerKind:'technical',reason:'The project Lead must plan explicit source ownership before this ticket can build.'};
    const attempt=join(root,'attempts',assignment.id);mkdirSync(attempt,{recursive:true});
    const before=inventory(workspace);checkProtected(context,before);
    if(assignment.role==='builder')assertSourceGrants(context.baseline,before,task.writablePaths);
    let directory=workspace;
    const verify=async(expected:Record<string,string>)=>{
      const receipts=[];
      if(!commands.length)throw Error('A verification plan is required before build or review can pass.');
      for(const [index,command] of commands.entries()){
        const result=await runVerification({project,workspace:directory,node},command,join(attempt,'verify-'+index),signal,this.execute);
        const files=inventory(directory);for(const [name,hash] of Object.entries(expected))if(files[name]!==hash)throw Error('Verification changed existing source: '+name);
        receipts.push({command,exitCode:result.exitCode,stdoutTail:result.stdout.slice(-4000),stderrTail:result.stderr.slice(-1000),receiptDirectory:join(attempt,'verify-'+index)});
      }
      return receipts;
    };
    let reviewEvidence='';
    if(assignment.role==='reviewer'){
      if(!assignment.candidate||candidate(root)!==assignment.candidate)throw new Error('Candidate changed before review. Reconcile to build and verify a fresh candidate.');
      const snapshot=prepareReview(context,assignment.id,assignment.candidate);directory=snapshot.directory;
      let receipts;try{receipts=await verify(inventory(directory));}catch(error){if(error instanceof CommandFailedError)return {kind:'blocked',blockerKind:'technical',reason:'Independent review verification failed before verdict. '+error.message};throw error;}
      assertReviewCandidate(directory,assignment.candidate);
      if(candidate(root)!==assignment.candidate||!same(before,inventory(workspace)))throw Error('Candidate changed during independent review verification.');
      const evidence={...snapshot,verification:receipts,verifiedAt:new Date().toISOString()};
      const file=saveReviewEvidence(directory,evidence);
      reviewEvidence='\nRunner-owned review evidence (checked before this verdict): '+JSON.stringify(evidence)+'\nEvidence file: '+file+'. The candidate and baseline are Git tree objects in this isolated repository, not commits. Use git -c '+JSON.stringify('safe.directory='+directory.replaceAll('\\','/'))+' diff '+snapshot.baseline+' '+assignment.candidate+' -- to inspect predecessor changes; HEAD may be unborn. Read the supplied diff and verification receipts. Checks requiring writes have already run independently with their configured permissions; review their results and inspect source read-only. Report a concrete source/acceptance defect as changes. If required evidence or environment capability is unavailable, choose blocked with blockerKind technical and the specific missing evidence; the Lead owns its resolution.';
    }
    const snapshot=inventory(directory);
    const persona=(instructions?.persona??readFileSync(resolve('config/personas',assignment.role+'.md'),'utf8'))+'\nConfigured state assignment: '+(instructions?.assignment??'Use the role-specific execution contract.')+'\nProject instructions: '+project.instructions+'\nVerification commands: '+JSON.stringify(commands)+(needsVerification?'\nThis is a new project with no verification configured. Build the requested project and meaningful tests. Include verificationCommands in your JSON reply: an array of {executable,args,sandbox}, where executable is node or a native .exe, args is a string array and sandbox is read-only or workspace-write. Use node with the supplied Node executable for JavaScript tests. For action implemented provide at least one command that checks the requested behavior. The runner executes these commands independently and the Reviewer receives an independent rerun before its verdict. If blocked, verificationCommands may be empty.':'')+reviewEvidence;
    const staged=task.projectId==='slug'&&task.requestChangesOnce;
    const challenge=staged&&assignment.role==='builder'&&task.reviewCycles===0?'This is a controlled review/fix test. In this first Builder assignment change only slug.mjs; the Reviewer will request the separate edge-case regression later.':'';
    const review=staged?'Require slug.edge.test.mjs containing a real test for slugify(\'  A___B---C  \') === \'a-b-c\'.':'';
    const reviewContext=assignment.reviewAxis?task.reviewVerdicts?.[assignment.reviewAxis]?.notes??'':task.reviewNotes??'';
    const ownershipPlanning=project.delivery?.requirePathGrants&&!task.writablePaths?.length?'Initial source ownership is pending. The project Lead must inspect the ticket and existing source and return ownedPaths containing the smallest explicit relative source files/directories needed for this ticket. Ownership planning is read-only; Builders remain held until the Lead supplies it. Lead may supply ownedPaths during triage or technical resolution. Preserve protected files and existing ownership; other roles return ownedPaths:[].':'Existing source ownership is pinned. Return ownedPaths:[]; use the shared-interface decision path for additional grants.';
    const interfaceRole=assignment.role==='builder'?'':'This is a '+assignment.role+' assignment: return interfaceRequest:null. Report technical or authority blockers in summary and blockerKind; shared-file requests originate from the Builder.';
    const prompt=`${persona}\n${interfaceRole}\n${ownershipPlanning}\nTask: ${task.title}\n${task.description}\nProject review criteria: ${project.reviewChecklist}\n${task.plan??''}\nLead assessment: ${task.triageNotes??''}\nReview axis: ${assignment.reviewAxis??'combined'}. Reviewer finding: ${reviewContext}\nOperator resolution: ${task.resolution??''}\n${challenge}\n${assignment.role==='reviewer'?review:''}\n${assignment.role==='lead'?'The operator says scope ready: '+task.specificationReady:''}\n${assignment.stage==='blocked'?'Resolve this routine technical blocker within existing scope and return action resolved with the actionable resolution in summary. Otherwise classify the blocker for operator escalation. Blocker: '+task.blocker:''}\nTransferred prior progress: ${JSON.stringify(task.transferContext??null)}. When present, the runner seeded retained source in this private workspace. Preserve existing behavior and complete the recorded next action; prior review pins are context and current-candidate verification/reviews still apply. Resolve any imported conflict markers as part of the scoped implementation. Acceptance criterion IDs: ${JSON.stringify(task.acceptanceCriteria??[])}. Existing evidence plan: ${JSON.stringify(task.evidenceRequirements??[])}. Evidence policy: ${project.delivery?.evidencePolicy??"legacy"}. For explicit readiness, Lead ready or BA refined must return requirements:[{criterion,kinds}] covering every assigned ID, including command plus the relevant source/unit/native/browser/physical proof. Scope each kind honestly; supplied native input does not prove physical devices. Return requirements:[] when no new readiness plan is needed. Source ownership grants: ${JSON.stringify(task.writablePaths??(project.delivery?.requirePathGrants?"pending Lead ownership plan":"legacy unrestricted task source"))}. Pending interface decision: ${JSON.stringify(task.interfaceRequest??null)}. Project Lead source coordination: ${sourceDelegationInstructions(project)}. Before editing a shared file outside your ownership, Builder returns blocked/technical with interfaceRequest {question,paths}; preserve its current source. This schedules the project Lead through configured technical recovery. Lead resolves the engineering contract in summary and may return grantedPaths only for the requested paths inside the project delegation. Use interfaceRequest:null and grantedPaths:[] otherwise. Protected source files: ${project.protectedPaths.join(', ')}.\nNode executable: ${node}. Working directory: ${directory}. Candidate: ${assignment.candidate??'not built'}.\nAllowed actions for this ${assignment.stage} assignment: ${stageActions[assignment.stage].join(', ')}. For Lead triage, needing BA is normal routing: choose refine, never blocked. Blocked means an actual missing operator decision or an execution blocker, not waiting for another configured role. For completed BA planning choose refined; Builder choose implemented; Reviewer choose approved or changes. Return JSON {action,summary,blockerKind,interfaceRequest,grantedPaths,ownedPaths,requirements}; use blockerKind none unless action is blocked.\nUse local commands only. Publish no branches or commits. Builders edit source; other roles are read-only. Use the supplied Node path for tests. Use no external skills, accounts, delegation or projects.`;
    writeFileSync(join(attempt,'assignment.json'),JSON.stringify(assignment));writeFileSync(join(attempt,'prompt.txt'),prompt);writeFileSync(join(attempt,'schema.json'),JSON.stringify(responseSchema(assignment.stage,needsVerification)));
    const args=['--no-daemon','exec','--ignore-user-config','--disable','multi_agent','--disable','multi_agent_v2','--sandbox',assignment.role==='builder'?'workspace-write':'read-only','-c','windows.sandbox="elevated"','-c','approval_policy="never"','--skip-git-repo-check','--json','--output-schema',join(attempt,'schema.json'),'--output-last-message',join(attempt,'reply.json'),'-C',directory,'-'];
    let output:{stdout:string;stderr:string};
    try{output=await this.execute({executable:settings.codexExecutable,args,cwd:directory,input:prompt,node,env:projectEnvironment(project,directory,node),directory:join(attempt,'codex'),timeoutMs:instructions?.timeoutMs===undefined?settings.attemptTimeoutMs:instructions.timeoutMs,signal,supervision:{workspace:directory,warningAfterMs:settings.inactivityWarningMs}});}
    catch(error){if(error instanceof RepeatedFailureError){const after=inventory(workspace);checkProtected(context,after);if(assignment.role!=='builder'&&(!same(before,after)||!same(snapshot,inventory(directory))))throw Error('Read-only assignment source changed; loop result refused.');return {kind:'blocked',blockerKind:'technical',reason:error.message};}throw error;}
    const answer=parseReply(assignment.stage,JSON.parse(readFileSync(join(attempt,'reply.json'),'utf8')),needsVerification);
    if(answer.ownedPaths?.length&&assignment.role!=='lead')throw Error('Only the project Lead can plan source ownership.');
    const thread=output.stdout.split('\n').map(line=>{try{return JSON.parse(line);}catch{return {};}}).find(event=>event.type==='thread.started')?.thread_id;
    if(!thread)throw new Error('Codex returned no session identity.');
    writeFileSync(join(attempt,'result.json'),JSON.stringify({assignment,sessionId:thread,reply:answer,at:new Date().toISOString()},null,2));
    const after=inventory(workspace);checkProtected(context,after);
    if(assignment.role==='builder')assertSourceGrants(context.baseline,after,task.writablePaths);
    if(assignment.role!=='builder'&&(!same(before,after)||!same(snapshot,inventory(directory))))throw new Error('Read-only assignment source changed; verdict refused.');
    if(answer.action==='blocked'){if(answer.blockerKind==='none')throw new Error('A blocked decision requires a concrete blocker classification.');if(answer.interfaceRequest&&(assignment.role!=='builder'||answer.blockerKind!=='technical'))throw Error('Shared-interface requests come from a Builder as technical coordination.');return {kind:'blocked',reason:answer.summary,blockerKind:answer.blockerKind,...(answer.interfaceRequest?{interfaceRequest:answer.interfaceRequest}:{})};}
    if(assignment.stage==='blocked')return {kind:'resolved',resolution:answer.summary,grantedPaths:answer.grantedPaths,ownedPaths:answer.ownedPaths};
    const requirements=answer.requirements?.length?answer.requirements:task.evidenceRequirements;
    if(assignment.stage==='queued')return {kind:'triaged',specificationReady:answer.action==='ready',summary:answer.summary,requirements,ownedPaths:answer.ownedPaths};
    if(assignment.stage==='refining')return {kind:'refined',summary:answer.summary,requirements};
    if(challenge&&Object.keys(after).some(name=>before[name]!==after[name]&&name!=='slug.mjs'))throw new Error('First challenge Builder changed files outside slug.mjs.');
    if(needsVerification){
      if(!answer.verificationCommands?.length)throw Error('The first build must provide verification commands before it can proceed to review.');
      for(const command of answer.verificationCommands)verificationTool(command.executable,node);
      commands=establishVerification(root,answer.verificationCommands);
    }
    if(assignment.stage==='implementing'){
      try{await verify(after);}catch(error){if(error instanceof CommandFailedError)return {kind:'blocked',blockerKind:'technical',reason:'Independent verification failed. '+error.message};throw error;}
      assertSourceGrants(context.baseline,inventory(workspace),task.writablePaths);
      const tree=candidate(root);writeFileSync(join(attempt,'candidate.json'),JSON.stringify({candidate:tree,inventory:after}));
      return {kind:'built',candidate:tree,verified:true};
    }
    assertReviewCandidate(directory,assignment.candidate!);
    if(candidate(root)!==assignment.candidate||!same(before,inventory(workspace)))throw new Error('Candidate changed during review; stale verdict refused.');
    if(answer.action==='approved'&&staged&&!existsSync(join(directory,'slug.edge.test.mjs')))throw new Error('Approval lacks required regression coverage.');
    return {kind:'reviewed',candidate:assignment.candidate!,approved:answer.action==='approved',notes:answer.summary};
  }
  async reconcile(task:Task,assignments:Assignment[]){
    const root=taskRoot(task);
    for(const assignment of assignments){const attempt=join(root,'attempts',assignment.id);if(!existsSync(attempt))continue;for(const child of readdirSync(attempt,{withFileTypes:true}).filter(item=>item.isDirectory()))await reconcileProcess(join(attempt,child.name));}
    const context=prepare(task);checkProtected(context,inventory(context.workspace));
    assertSourceGrants(context.baseline,inventory(context.workspace),task.writablePaths);
    return {restartImplementation:task.resumeState==='reviewing'&&candidate(root)!==task.candidate};
  }
  details(task:Task,assignments?:Assignment[]){
    const root=taskRoot(task),attempts=join(root,'attempts');
    const entries=existsSync(attempts)?readdirSync(attempts).map(id=>{
      const path=join(attempts,id),result=readJson<{sessionId:string;reply:{summary:string}}>(join(path,'result.json'));
      const log=join(path,'codex','stdout.log');
      return {id,sessionId:result?.sessionId,summary:result?.reply.summary,process:readJson(join(path,'codex/process.json')),activity:readActivity(join(path,'codex'),assignments?assignments.some(assignment=>assignment.id===id&&assignment.status==='running'):!['blocked','complete','cancelled'].includes(task.state)),log:existsSync(log)?readFileSync(log,'utf8').slice(-18000):''};
    }):[];
    return {workspace:join(root,'workspace'),attempts:entries};
  }
}

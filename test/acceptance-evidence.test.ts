import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DiscoveryAgent} from '../server/discovery-agent.ts';
import {prepare,candidate,projectSchema,inventory} from '../server/projects.ts';
import {reviewGit} from '../server/review-evidence.ts';
import {deliveryOutput} from '../server/delivery-output.ts';
import {CommandFailedError} from '../server/process.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {EvidenceLedger} from '../server/evidence-ledger.ts';
import {validateRunEvidence} from '../server/acceptance-evidence.ts';

for(const mode of ['pass','failed-check','model-edit','strict-pass','strict-failure','strict-omitted-citations','strict-forged-retry','invented-waiver'] as const)test('acceptance receives candidate mapping and actual verification results: '+mode,async()=>{
  const root=resolve('.state/acceptance-evidence-tests',randomUUID()),source=join(root,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'app.mjs'),'export const value=1;');
  const project=projectSchema.parse({id:'acceptance-evidence',name:'Acceptance evidence',kind:'fixture',path:source,reviewChecklist:'value is 2.',verify:[{executable:'node',args:['--test','behavior.test.mjs'],sandbox:'workspace-write'}]});
  const settings=join(root,'projects.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));const previous=process.env.BARRACKS_PROJECTS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;
  try{
    const taskId=randomUUID(),context=prepare({id:taskId,projectId:project.id});writeFileSync(join(context.workspace,'app.mjs'),'export const value=2;');const tree=candidate(context.root),before=inventory(context.workspace);
    const definition=JSON.parse(readFileSync('config/workflows.json','utf8')).find((item:{id:string})=>item.id==='delivery');
    const run:WorkflowRun={id:randomUUID(),projectId:project.id,workflowId:'delivery',title:'Observe acceptance evidence',description:'',definition,status:'running',phase:'acceptance',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),turns:[],questions:[],message:'Acceptance',recovery:false,attempts:[],baseTaskId:taskId,baseCandidate:tree,artifacts:{task:{title:'Observe'},project:{id:project.id},epic:{id:'E01'},delivery_candidate:tree,delivery_tickets:[],acceptance_criteria:[{id:'T1:1',description:'value is 2.'}]},personaInstructions:{'acceptance-tester':'# Acceptance Tester'},handoffs:[]};
    const events:string[]=[];
    if(mode.startsWith('strict'))run.artifacts.acceptance_requirements=[{criterion:'T1:1',kinds:['command']}];
    const agent=new DiscoveryAgent(async command=>{
      if(command.args[0]==='sandbox'){events.push('verify');if(mode.startsWith('strict')){mkdirSync(command.directory,{recursive:true});writeFileSync(join(command.directory,'process.json'),JSON.stringify({status:'exited',drained:true,exitCode:mode==='strict-failure'?1:0,jobName:'Local\\Barracks-'+randomUUID()}));writeFileSync(join(command.directory,'command-result.json'),JSON.stringify({code:mode==='strict-failure'?101:0}));}if(mode==='failed-check'||mode==='strict-failure')throw new CommandFailedError('fixture failed');return {stdout:'Observed value 2; browser journey passed.',stderr:''};}
      events.push('model');assert.deepEqual(events,['verify','model']);
      const inputs=JSON.parse(command.input!.split('\nHandoff inputs: ')[1]!.split('\nAllowed events')[0]!);
      if(mode.startsWith('strict')){assert.deepEqual(inputs.acceptance_requirements,run.artifacts.acceptance_requirements,'Acceptance must receive the criterion-level evidence plan.');assert.match(inputs.evidence_citation_rules,/EACH passed criterion/);}
      assert.equal(inputs.candidate_evidence.candidate,tree);assert.equal(inputs.verification_receipts.commands[0].exitCode,0);assert.match(inputs.verification_receipts.commands[0].stdoutTail,/browser journey passed/);
      assert.equal(reviewGit(command.cwd,['cat-file','-t',tree]),'tree');assert.equal(reviewGit(command.cwd,['cat-file','-t',inputs.candidate_evidence.baseline]),'tree');
      assert.match(command.input!,/Trees need no commit or HEAD/);
      if(mode==='model-edit')writeFileSync(join(command.cwd,'app.mjs'),'changed');
      const reply=command.args[command.args.indexOf('--output-last-message')+1]!;writeFileSync(reply,JSON.stringify({event:mode==='strict-forged-retry'?'invalid_output':'acceptance_passed',document:'Candidate-bound command evidence confirms value 2.',questions:[],plan:null,criteria:[{criterion:'T1:1',status:mode==='invented-waiver'?'waived':'passed',evidence:'Observed value 2; browser journey passed.',...(mode==='strict-pass'?{evidenceIds:inputs.evidence_ledger.map((receipt:{id:string})=>receipt.id)}:{})}]}));return {stdout:'',stderr:''};
    });
    if(mode==='model-edit')await assert.rejects(agent.run(run,new AbortController().signal,()=>{}),/changed source/);
    else if(mode==='invented-waiver')await assert.rejects(agent.run(run,new AbortController().signal,()=>{}),/operator waiver/);
    else if(mode==='strict-omitted-citations')await assert.rejects(agent.run(run,new AbortController().signal,()=>{}),/lacks passed command evidence/);
    else if(mode==='strict-forged-retry')await assert.rejects(agent.run(run,new AbortController().signal,()=>{}),/Event is not configured/);
    else{const reply=await agent.run(run,new AbortController().signal,()=>{});assert.equal(reply.event,['pass','strict-pass'].includes(mode)?'acceptance_passed':'changes');if(mode==='failed-check'||mode==='strict-failure')assert.deepEqual(events,['verify']);if(mode==='strict-failure'){const receipts=new EvidenceLedger(run.id).list(tree);assert.equal(receipts.length,1);assert.equal(receipts[0]!.status,'failed');assert.equal(receipts[0]!.command!.exitCode,101);}if(mode==='strict-pass')validateRunEvidence(run,tree,reply.criteria);}
    assert.deepEqual(inventory(context.workspace),before);
    assert.equal(deliveryOutput(run,project)!.projectMatches,false);
    if(mode==='pass'){
      writeFileSync(join(source,'app.mjs'),readFileSync(join(context.workspace,'app.mjs')));assert.equal(deliveryOutput(run,project)!.projectMatches,true);run.artifacts.acceptance_candidate=tree;assert.equal(deliveryOutput(run,project)!.acceptancePassed,true);
      writeFileSync(join(source,'app.mjs'),'unreviewed drift');writeFileSync(join(context.workspace,'app.mjs'),'unreviewed drift');
      assert.equal(deliveryOutput(run,project)!.projectMatches,false);assert.equal(deliveryOutput(run,project)!.sourceState,'changed');
      renameSync(join(context.root,'git'),join(context.root,'git-held'));
      try{assert.equal(deliveryOutput(run,project)!.sourceState,'unavailable');}finally{renameSync(join(context.root,'git-held'),join(context.root,'git'));}
    }
  }finally{if(previous===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=previous;}
});

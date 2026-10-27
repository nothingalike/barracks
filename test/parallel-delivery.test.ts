import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {Pmt} from '../server/pmt.ts';
import {projectSchema,prepare,candidate} from '../server/projects.ts';
import {DiscoveryAgent,type DiscoveryReply} from '../server/discovery-agent.ts';
import {deliveryCandidate} from '../server/delivery-candidate.ts';
import {configSchema,type Assignment,type Task,type WorkerResult} from '../shared/workflow.ts';
import type {WorkflowRun,PmtItem} from '../shared/factory.ts';
import {waitFor} from '../scripts/test-server.ts';
import {EvidenceLedger} from '../server/evidence-ledger.ts';

for(const mode of ['independent','conflict-repair','acceptance-repair','cancel','restart','reservation-retry','integration-replay','integration-technical','repair-replay','child-resume','all-tickets'] as const)test('parallel delivery: '+mode,async()=>{
  const conflictMode=mode==='conflict-repair'||mode==='repair-replay';
  const directory=resolve('.state/parallel-delivery-tests',randomUUID()),source=join(directory,'source');mkdirSync(source,{recursive:true});
  execFileSync('git',['init','--initial-branch=main',source],{windowsHide:true,stdio:'pipe'});writeFileSync(join(source,'base.txt'),'initial uncommitted source\n');
  const project=projectSchema.parse({id:'parallel',name:'Parallel fixture',kind:'repository',path:source,reviewChecklist:'Preserve all three ticket behaviors.',...(mode==='child-resume'?{delivery:{requireEvidenceKinds:['source']}}:{}),verify:[{executable:'node',args:['--test'],sandbox:'read-only'}]}),pmt=new Pmt(project);pmt.ensure(project);
  pmt.command(['epic','create','--title','Parallel behaviors','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
  for(const title of ['A','B','C'])pmt.command(['story','create','--title',title,'--epic',epic.id,'--yes']);
  const tickets=pmt.list().filter(item=>item.epic===epic.id).sort((a,b)=>a.title.localeCompare(b.title));
  for(const ticket of tickets)pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]','- '+ticket.title+' behavior is available.')});
  const cFile=join(source,tickets[2]!.path);writeFileSync(cFile,readFileSync(cFile,'utf8').replace('depends_on: []','depends_on: '+JSON.stringify([tickets[0]!.id,tickets[1]!.id])));pmt.command(['index','rebuild']);
  const settings=join(directory,'projects.json'),graphs=join(directory,'workflows.json');writeFileSync(settings,JSON.stringify({codexExecutable:process.execPath,projects:[project]}));
  const base=JSON.parse(readFileSync('config/workflows.json','utf8')).filter((item:{id:string})=>!['parallel-delivery','ticket-delivery'].includes(item.id));writeFileSync(graphs,JSON.stringify([...base,...JSON.parse(readFileSync('test/fixtures/parallel-workflows.json','utf8'))]));
  const oldProject=process.env.BARRACKS_PROJECTS_PATH,oldGraphs=process.env.BARRACKS_WORKFLOWS_PATH;process.env.BARRACKS_PROJECTS_PATH=settings;process.env.BARRACKS_WORKFLOWS_PATH=graphs;
  class FaultStore extends Store {
    reservations=0;integrationFault=false;repairFault=false;
    override reserveParallelTicket(run:WorkflowRun,ticket:PmtItem,replace=false,repair?:Parameters<Store['reserveParallelTicket']>[3]){
      this.reservations++;if(mode==='reservation-retry'&&this.reservations===2)throw Error('Interrupted between wave reservations.');
      const child=super.reserveParallelTicket(run,ticket,replace,repair);if(mode==='repair-replay'&&replace&&!this.repairFault){this.repairFault=true;throw Error('Interrupted after the atomic repair reservation.');}return child;
    }
    override saveRun(run:WorkflowRun){if(mode==='integration-replay'&&!this.integrationFault&&!run.parentRunId&&run.parallel&&run.phase==='dispatch_tickets'&&run.completedTickets?.length===2&&!run.parallel.plan){this.integrationFault=true;throw Error('Interrupted after materialization before run save.');}return super.saveRun(run);}
  }
  let store:Store=new FaultStore(join(directory,'state.db'));const config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8')));config.parallelism.implementing=2;config.parallelism.refining=2;config.parallelism.reviewing=2;
  let peak=0,active=0,started=0,restarted=false,integrations=0,acceptances=0,repairCount=0,resolutions=0,childBlocked=false;let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
  const worker={async run(assignment:Assignment,task:Task,signal:AbortSignal):Promise<WorkerResult>{
    if(assignment.role==='lead'){
      if(mode==='all-tickets'&&task.title==='C'){assert.ok(integrations>=1,'The Lead receives C only after its predecessors are integrated.');const context=prepare(task);assert.ok(existsSync(join(context.workspace,'A.txt')));assert.ok(existsSync(join(context.workspace,'B.txt')));}
      return {kind:'triaged',specificationReady:false};
    }
    if(assignment.role==='ba'){
      if(mode==='child-resume'&&task.title==='A'&&!childBlocked){childBlocked=true;return {kind:'blocked',blockerKind:'product',reason:'Fixture decision needed for A.'};}
      return {kind:'refined',summary:'Ready for scoped implementation.'};
    }
    if(assignment.role==='reviewer')return {kind:'reviewed',candidate:assignment.candidate!,approved:true,notes:'Independent fixture review passed.'};
    const context=prepare(task),repair=task.title.startsWith('Repair integration:');
    active++;peak=Math.max(peak,active);started++;
    try{
      if(started<=2&&!restarted)await Promise.race([barrier,new Promise<never>((_,reject)=>{if(signal.aborted)reject(Error('Stopped'));else signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true});})]);
      if(repair){repairCount++;writeFileSync(join(context.workspace,conflictMode?'base.txt':'accepted-fix.txt'),conflictMode?'A+B resolved\n':'acceptance repaired\n');}
      else if(task.title==='C'){assert.ok(integrations>=1);assert.ok(existsSync(join(context.workspace,conflictMode?'base.txt':'A.txt')));assert.ok(existsSync(join(context.workspace,conflictMode?'base.txt':'B.txt')));writeFileSync(join(context.workspace,'C.txt'),'depends on integrated A and B\n');}
      else writeFileSync(join(context.workspace,conflictMode?'base.txt':task.title+'.txt'),task.title+'\n');
      return {kind:'built',candidate:candidate(context.root),verified:true};
    }finally{active--;}
  },async reconcile(){return {};}};
  class Agent extends DiscoveryAgent {override async run(run:WorkflowRun):Promise<DiscoveryReply>{
    if(run.phase==='integrate'){integrations++;assert.ok(run.parallel?.plan);if(mode==='integration-technical'&&integrations===1)return {event:'technical_blocker',document:'One integration capability needs correction.',questions:['Correct the local tool.'],plan:null};return {event:'integrated',document:'Lead inspected the combined source and fixed checks.',questions:[],plan:null};}
    if(run.phase==='resolve_delivery'){resolutions++;assert.equal(mode,'integration-technical');return {event:'resolved',document:'The integration tool is corrected.',questions:[],plan:null};}
    if(run.phase==='retrospective')return {event:'retrospective_ready',document:'Fixture retrospective.',questions:[],plan:null};
    assert.equal(run.phase,'acceptance');acceptances++;const context=deliveryCandidate(run),needsRepair=mode==='acceptance-repair'&&acceptances===1;
    assert.ok(existsSync(join(context.workspace,'C.txt')));if(mode==='acceptance-repair'&&!needsRepair)assert.ok(existsSync(join(context.workspace,'accepted-fix.txt')));
    const sourceReceipts=new EvidenceLedger(run.id).list(context.candidate);if(mode==='child-resume')assert.equal(sourceReceipts.filter(receipt=>receipt.kind==='source').length,3);
    return {event:needsRepair?'changes':'acceptance_passed',document:needsRepair?'A combined behavior needs repair.':'All combined behavior observed.',questions:[],plan:null,criteria:(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>({criterion:item.id,status:needsRepair?'failed':'passed',evidence:needsRepair?'Controlled acceptance repair.':'Fixture source observed.',...(mode==='child-resume'?{evidenceIds:sourceReceipts.filter(receipt=>receipt.criterion===item.id).map(receipt=>receipt.id)}:{})}))};
  }override async reconcile(){}}
  let runner=new Runner(store,config,new SimulatedWorker(1)),factory=new Factory(store,runner,new Agent(),worker);factory.start();
  try{
    const run=factory.create({projectId:project.id,workflowId:'parallel-delivery',epicId:epic.id,title:'Deliver independent and dependent work',ticketConcurrency:2,...(mode==='all-tickets'?{ticketIds:tickets.map(ticket=>ticket.id).reverse()}: {})});
    if(mode==='reservation-retry'){await waitFor(()=>store.run(run.id),run=>run.recovery,10000);assert.equal(Object.keys(store.run(run.id).parallel!.ticketRuns).length,1);await factory.resume(run.id,'Retry the individually reserved wave.');}
    if(mode==='child-resume'){
      await waitFor(()=>store.run(run.id),run=>run.status==='waiting',20000);
      const child=store.run(store.run(run.id).children![tickets[0]!.id]!);assert.equal(child.status,'waiting');
      await delay(400);assert.equal(store.run(run.id).status,'waiting');assert.equal(store.run(run.id).handoffs.some(item=>item.event==='children_ready'),false);
      await assert.rejects(factory.resume(run.id,'Pretend child progress.','children_ready'),/runner-owned/);
      await factory.resume(child.id,'The fixture decision is resolved; continue A.');
      await waitFor(()=>store.run(run.id),run=>run.status!=='waiting',5000);
      assert.ok(store.run(run.id).handoffs.some(item=>item.event==='children_ready'));
    }
    await waitFor(()=>started,value=>value>=2,20000);assert.equal(peak,2);assert.equal(existsSync(join(source,'A.txt')),false);
    assert.equal(Object.keys(store.run(run.id).parallel!.ticketRuns).length,2);
    if(mode==='cancel'){await factory.cancel(run.id);assert.equal(store.run(run.id).status,'cancelled');assert.equal(store.assignments().filter(item=>item.status==='running').length,0);assert.equal(existsSync(join(source,'C.txt')),false);return;}
    if(mode==='restart'){
      const ids=store.run(run.id).parallel!.ticketRuns;factory.stop();await factory.drained();store.close();restarted=true;
      store=new Store(join(directory,'state.db'));runner=new Runner(store,config,new SimulatedWorker(1));factory=new Factory(store,runner,new Agent(),worker);factory.start();
      assert.equal(store.run(run.id).status,'waiting');assert.deepEqual(store.run(run.id).parallel!.ticketRuns,ids);await factory.resume(run.id,'Resume the retained worktrees after drain confirmation.');
    }else{
      store.pause(true);release();await waitFor(()=>active,value=>value===0,10000);await delay(500);assert.equal(store.assignments().filter(item=>item.role==='reviewer').length,0);store.pause(false);
    }
    let done=await waitFor(()=>store.run(run.id),run=>['complete','waiting'].includes(run.status),45000);
    if((mode==='integration-replay'||mode==='repair-replay')&&done.recovery){
      if(mode==='integration-replay')assert.ok(done.parallel?.plan);
      else{assert.equal(done.parallel!.repairPending,true);const child=store.run(done.parallel!.ticketRuns[done.parallel!.repairTicketId!]!);assert.ok(child.artifacts.seed_tree);assert.ok(Array.isArray(child.artifacts.repair_verification));}
      factory.stop();await factory.drained();store.close();store=new Store(join(directory,'state.db'));runner=new Runner(store,config,new SimulatedWorker(1));factory=new Factory(store,runner,new Agent(),worker);factory.start();await factory.resume(run.id,'Replay the retained integration/repair checkpoint.');done=await waitFor(()=>store.run(run.id),run=>['complete','waiting'].includes(run.status),45000);
    }
    assert.equal(done.status,'complete',done.message+' '+done.questions.join('; '));
    assert.equal(done.completedTickets?.length,3);assert.equal(done.parallel!.publication!.candidate,done.baseCandidate);assert.equal(done.artifacts.acceptance_candidate,done.baseCandidate);
    assert.equal(readFileSync(join(source,'C.txt'),'utf8'),'depends on integrated A and B\n');assert.equal(readFileSync(join(source,'.workspace','pm-toolbox.yml'),'utf8').includes('Parallel fixture'),true);
    if(conflictMode){assert.ok(repairCount>=1);assert.equal(readFileSync(join(source,'base.txt'),'utf8'),'A+B resolved\n');}
    if(mode==='acceptance-repair'){assert.equal(acceptances,2);assert.ok(repairCount>=1);}
    if(mode==='integration-technical')assert.equal(resolutions,1);
    assert.equal(pmt.list().filter(item=>item.epic===epic.id&&item.status!=='complete').length,0);
  }finally{release();factory.stop();await factory.drained();store.close();if(oldProject===undefined)delete process.env.BARRACKS_PROJECTS_PATH;else process.env.BARRACKS_PROJECTS_PATH=oldProject;if(oldGraphs===undefined)delete process.env.BARRACKS_WORKFLOWS_PATH;else process.env.BARRACKS_WORKFLOWS_PATH=oldGraphs;}
});

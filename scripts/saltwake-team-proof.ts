import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {Factory} from '../server/factory.ts';
import {Store} from '../server/store.ts';
import {Runner,SimulatedWorker} from '../server/runner.ts';
import {Pmt} from '../server/pmt.ts';
import {runtimeSettings,projectSchema} from '../server/projects.ts';
import {configSchema} from '../shared/workflow.ts';
import {EvidenceLedger} from '../server/evidence-ledger.ts';
import {waitFor} from './test-server.ts';
import {stageTransfer} from '../server/transfer-manifest.ts';
import {authorizeTransfer} from '../server/transfer-activation.ts';
import {createHash} from 'node:crypto';

const transferMode=process.argv.includes('--transfer'),epicMode=process.argv.includes('--epic'),directory=resolve(epicMode?'.state/epic-team-proof':transferMode?'.state/saltwake-team-transfer-proof':'.state/saltwake-team-proof',randomUUID()),source=join(directory,'source'),tracker=join(directory,'tracker');mkdirSync(join(source,'src'),{recursive:true});mkdirSync(tracker);
for(const folder of [source,tracker])execFileSync('git',['init','--initial-branch=main',folder],{windowsHide:true,stdio:'pipe'});
writeFileSync(join(source,'Cargo.toml'),'[package]\nname="barracks-team-proof"\nversion="0.1.0"\nedition="2024"\n[lib]\ncrate-type=["rlib","cdylib"]\n');
writeFileSync(join(source,'Cargo.lock'),'version = 4\n\n[[package]]\nname = "barracks-team-proof"\nversion = "0.1.0"\n');
writeFileSync(join(source,'.gitignore'),'.state/\ntarget/\n');
writeFileSync(join(source,'src/lib.rs'),'pub mod greeting;\npub mod arithmetic;\n');
writeFileSync(join(source,'src/greeting.rs'),'// Implement the approved greeting capability here.\n');
writeFileSync(join(source,'src/arithmetic.rs'),'// Implement the approved arithmetic capability here.\n');
const lanes:string[]=[];
if(transferMode){const g=(path:string,args:string[])=>execFileSync('git',['-c','core.hooksPath='+join(directory,'empty-hooks'),'-C',path,...args],{windowsHide:true,stdio:'pipe'});g(source,['add','.']);g(source,['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Disposable transfer base']);
  for(const [index,name] of ['builder-a','builder-b'].entries()){const lane=join(directory,name);g(source,['worktree','add','-b',name,lane]);lanes.push(lane);writeFileSync(join(lane,index===0?'src/greeting.rs':'src/arithmetic.rs'),index===0?'pub fn greet(name: &str) -> String { let name=name.trim(); if name.is_empty(){String::from("Hello, world!")}else{format!("Hello, {name}!")} }\n':'pub fn add(a:i32,b:i32)->i32 { a+b }\n');if(index===0){g(lane,['add','.']);g(lane,['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Retained reviewed capability before tests']);}}
}
const cargo='C:/Users/johns/.cargo/bin/cargo.exe';
const project=projectSchema.parse({id:'saltwake-team-proof',name:'Disposable Saltwake team rehearsal',kind:'repository',path:source,trackerPath:tracker,
  protectedPaths:['Cargo.toml','Cargo.lock','.gitignore','src/lib.rs'],reviewChecklist:'Implement only the named capability and meaningful native tests. Preserve all other files. Distinguish native unit checks from graphical/physical acceptance.',
  instructions:'Disposable readiness proof, not Saltwake game work. The runner owns assignments, Git worktrees, integration, verification, publication and external communication. Use the supplied Node path when needed. Do not spawn/delegate, commit, install dependencies or change source outside your granted module. Existing package/lib configuration is complete. cargo lives at '+cargo+'.',
  environment:{CARGO_TARGET_DIR:'{workspace}/.state/cargo'},
  verify:[{executable:cargo,args:['test','--offline','--locked','--all-targets'],sandbox:'workspace-write',timeoutMs:null,evidenceKind:'unit'},
    {executable:cargo,args:['build','--offline','--locked','--target','wasm32-unknown-unknown'],sandbox:'workspace-write',timeoutMs:null,artifacts:[{name:'Wasm library',path:'.state/cargo/wasm32-unknown-unknown/debug/barracks_team_proof.wasm',role:'build'}]}],
  delivery:{selection:epicMode?'epic':'explicit',requirePathGrants:true,reviewAxes:['spec','standards'],evidencePolicy:'explicit',requireEvidenceKinds:['unit'],completion:'accepted'},
  team:[{id:'lead',name:'Lead',roles:['lead']},{id:'ba',name:'BA',roles:['ba','reviewer'],reviewAxes:['spec']},{id:'builder-a',name:'Builder A',roles:['builder','reviewer'],reviewAxes:['standards']},{id:'builder-b',name:'Builder B',roles:['builder','reviewer'],reviewAxes:['standards']}]});
const settings=join(directory,'projects.json'),graphs=join(directory,'workflows.json');writeFileSync(settings,JSON.stringify({...runtimeSettings(),projects:[project]}));
writeFileSync(graphs,JSON.stringify(Array.from(new Map([...JSON.parse(readFileSync('config/workflows.json','utf8')),...JSON.parse(readFileSync('test/fixtures/qualified-workflows.json','utf8'))].map(item=>[item.id,item])).values())));process.env.BARRACKS_PROJECTS_PATH=settings;process.env.BARRACKS_WORKFLOWS_PATH=graphs;
const pmt=new Pmt(project);pmt.ensure(project);pmt.command(['epic','create','--title','Disposable qualified Rust team','--yes']);const epic=pmt.list().find(item=>!item.epic)!;
const plans=[{title:'Greeting capability',path:'src/greeting.rs',summary:'Export pub fn greet(name: &str) -> String. Trim surrounding whitespace; blank returns "Hello, world!", otherwise "Hello, <trimmed name>!". Add meaningful #[cfg(test)] unit tests inside this module for named, padded and blank input.',criteria:['greet("Ada") and greet(" Ada ") return "Hello, Ada!".','Empty and whitespace input return "Hello, world!".','Meaningful native unit tests cover those cases and the Wasm library builds.']},
  {title:'Arithmetic capability',path:'src/arithmetic.rs',summary:'Export pub fn add(a: i32, b: i32) -> i32 returning the sum. Inputs are small enough to avoid overflow; add no extra validation. Add meaningful #[cfg(test)] unit tests inside this module for positive, negative and zero values.',criteria:['add(2, 3) is 5, add(-2, 3) is 1 and add(0, 0) is 0.','Meaningful native unit tests cover those cases and the Wasm library builds.']}];
const ids:string[]=[];
for(const plan of plans){pmt.command(['story','create','--title',plan.title,'--epic',epic.id,'--summary',plan.summary,'--yes']);const ticket=pmt.list().find(item=>item.epic===epic.id&&item.title===plan.title)!;ids.push(ticket.id);
  const requirements=plan.criteria.map((_,index)=>({criterion:ticket.id+':'+(index+1),kinds:['command','unit']}));pmt.edit(ticket.id,{title:ticket.title,revision:ticket.revision,body:ticket.body.replace('- [Define expected outcomes and restrictions]',plan.criteria.map(text=>'- '+text).join('\n'))+'\n\n## Barracks delivery\n\n```json\n'+JSON.stringify({...(epicMode?{}:{ownedPaths:[plan.path]}),requirements})+'\n```\n'});
}
if(transferMode){const sourceHead=execFileSync('git',['-C',source,'rev-parse','HEAD'],{windowsHide:true,encoding:'utf8'}).trim(),staged=stageTransfer({project,sourceReference:{path:source,commit:sourceHead},assignments:project.team!.map(member=>({participantId:member.id,assignmentRole:member.id.startsWith('builder-')?'builder':member.id==='ba'?'ba':'lead',state:'disposable-checkpoint',nextAction:'Preserve the retained implementation, add meaningful scoped tests and complete current-candidate verification.',...(member.id.startsWith('builder-')?{ticketId:ids[member.id==='builder-a'?0:1],worktree:lanes[member.id==='builder-a'?0:1],reviewPins:[]}:{worktree:source})})),retainedDecisions:['This simulates old-team checkpoint/approval on a disposable crate. Resumed Codex assignments are real. Prior source does not replace fresh verification/reviews.'],pendingActions:[]});
  const fencePath=join(directory,'controlled-checkpoint.json');writeFileSync(fencePath,JSON.stringify({kind:'codex-team-checkpoint',coordinator:{threadId:'disposable-old-team',goalStatus:'paused',activeAssignments:0,ownedJobsDrained:true},participants:project.team!.map(member=>({id:member.id,state:'checkpointed'}))}));const manifestHash=readFileSync(join(staged.root,'manifest.sha256'),'utf8');authorizeTransfer(staged.root,{manifestHash,userApproval:'Disposable rehearsal only; no live Saltwake transfer approval.',fencePath,fenceHash:createHash('sha256').update(readFileSync(fencePath)).digest('hex')});project.transfer={root:staged.root,sha256:manifestHash,approved:true};writeFileSync(settings,JSON.stringify({...runtimeSettings(),projects:[project]}));
}
const store=new Store(join(directory,'state.db')),config=configSchema.parse(JSON.parse(readFileSync('config/workflow.json','utf8'))),runner=new Runner(store,config,new SimulatedWorker(1)),factory=new Factory(store,runner);factory.start();
let runId='',peak=0,last='';
try{const run=factory.create({projectId:project.id,workflowId:'qualified-delivery',epicId:epic.id,...(epicMode?{}:{ticketIds:ids}),title:'Qualify whole-team Rust delivery',ticketConcurrency:2});runId=run.id;console.log('Run '+runId+'; evidence '+directory);
  const done=await waitFor(()=>{const value=store.run(runId),active=store.assignments().filter(item=>item.status==='running');peak=Math.max(peak,active.length);const text=JSON.stringify({phase:value.phase,status:value.status,active:active.map(item=>({role:item.role,participant:item.worker,axis:item.reviewAxis})),integrated:value.completedTickets?.length??0});if(last!==text){console.log(text);last=text;}return value;},value=>['complete','waiting'].includes(value.status),2400000);
  writeFileSync(join(directory,'run.json'),JSON.stringify(done,null,2));assert.equal(done.status,'complete',done.message+' '+done.questions.join('; '));assert.ok(peak>=2);assert.equal(done.parallel?.trackerPublished,true);assert.equal(pmt.list().filter(ticket=>ids.includes(ticket.id)&&ticket.status==='complete').length,2);
  for(const id of Object.values(done.children!)){const task=store.task(id);assert.ok(task.reviewVerdicts?.spec?.approved);assert.ok(task.reviewVerdicts?.standards?.approved);assert.notEqual(task.reviewVerdicts?.standards?.reviewer,task.author);if(epicMode)assert.ok(task.writablePaths?.length);if(transferMode){assert.ok(task.transferContext);assert.equal(task.author,task.transferContext!.participantId);}}
  assert.ok(new EvidenceLedger(runId).list(done.baseCandidate).length>=2);for(const plan of plans)assert.ok(readFileSync(join(source,plan.path),'utf8').includes('pub fn'));
  assert.equal(existsSync(join(source,'.state/cargo')),false);assert.equal(store.leases().length,0);
  writeFileSync(join(directory,'result.json'),JSON.stringify({status:'passed',runId,candidate:done.baseCandidate,peak,transfer:project.transfer,evidence:new EvidenceLedger(runId).list(done.baseCandidate),limitations:'Disposable Rust crate with real native unit checks and Wasm build; optional prior-team handover is simulated, resumed workers are actual Codex. No Bevy renderer, browser, GPU, physical controls or live Saltwake transfer.'},null,2));console.log('PASS '+directory);
}catch(error){writeFileSync(join(directory,'result.json'),JSON.stringify({status:'failed',runId,peak,error:String(error)},null,2));throw error;}
finally{factory.stop();await factory.drained();store.close();console.log('Evidence '+directory);}

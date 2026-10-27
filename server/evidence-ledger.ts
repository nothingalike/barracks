import {mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {evidenceKindSchema,type EvidenceKind,type EvidenceReceipt,type EvidenceRequirement} from '../shared/evidence.ts';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const uuid=z.string().uuid(),tree=z.string().regex(/^[a-f0-9]{40}$/);
const role=z.enum(['build','helper','capture','log']),digest=z.string().regex(/^[a-f0-9]{64}$/);
const artifactInput=z.object({path:z.string().min(1),name:z.string().min(1).max(160).optional(),role:role.optional()}).strict();
const sourceReviewSchema=z.object({candidate:tree,integrationReview:z.string().min(1),tickets:z.array(z.object({ticketId:z.string().min(1),candidate:tree,author:z.string().min(1),reviews:z.array(z.object({candidate:tree,reviewer:z.string().min(1),assignmentId:uuid,approved:z.literal(true),notes:z.string().min(1)}).strict()).min(1)}).strict()).min(1)}).strict();
const receiptSchema=z.object({id:uuid,runId:uuid,candidate:tree,origin:z.enum(['runner','operator']),kind:z.union([evidenceKindSchema,z.enum(['waiver','adjudication'])]),status:z.enum(['passed','failed','unverified','waived']),createdAt:z.string(),note:z.string(),criterion:z.string().optional(),platform:z.string().optional(),buildHash:digest.optional(),helperHash:digest.optional(),covers:z.array(evidenceKindSchema).optional(),references:z.array(uuid).optional(),command:z.object({executable:z.string(),args:z.array(z.string()),exitCode:z.number().int(),directory:z.string(),jobName:z.string()}).optional(),artifacts:z.array(z.object({name:z.string(),path:z.string(),sha256:digest,role:role.optional()}))}).strict();
export const observationSchema=z.object({candidate:tree,criterion:z.string().min(1),kind:z.union([evidenceKindSchema,z.enum(['waiver','adjudication'])]),status:z.enum(['passed','failed','unverified','waived']),note:z.string().min(1).max(16000),platform:z.string().min(1).max(100).optional(),buildHash:digest.optional(),helperHash:digest.optional(),artifacts:z.array(artifactInput).max(50).default([]),covers:z.array(evidenceKindSchema).default([]),references:z.array(uuid).default([])}).strict();

function fileWithin(root:string,path:string){
  const file=resolve(root,path);if(!file.startsWith(resolve(root)+sep))throw Error('Evidence path escapes its approved folder.');
  for(let cursor=file;;cursor=dirname(cursor)){const info=lstatSync(cursor);if(info.isSymbolicLink())throw Error('Evidence paths cannot contain links.');if(cursor===dirname(cursor))break;}
  if(!lstatSync(file).isFile())throw Error('Evidence artifact must be a file.');return file;
}
export const approvedEvidenceFile=fileWithin;
function assertStorage(path:string){for(let cursor=resolve(path);;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Evidence storage cannot contain links.');}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}if(cursor===dirname(cursor))break;}}
export class EvidenceLedger {
  private root:string;private runId:string;
  constructor(runId:string){this.runId=uuid.parse(runId);this.root=resolve('.state/evidence',this.runId);}
  private save(receipt:EvidenceReceipt,inputs:{name:string;path:string;role?:'build'|'helper'|'capture'|'log'}[]){
    const directory=join(this.root,receipt.id);assertStorage(directory);mkdirSync(directory,{recursive:true});
    for(let cursor=directory;;cursor=dirname(cursor)){if(lstatSync(cursor).isSymbolicLink())throw Error('Evidence storage cannot contain links.');if(cursor===dirname(cursor))break;}
    receipt.artifacts=inputs.map((artifact,index)=>{
      const before=hash(readFileSync(artifact.path)),target=join(directory,'artifact-'+index+'-'+basename(artifact.path));copyFileSync(artifact.path,target);const actual=hash(readFileSync(target));if(actual!==before||hash(readFileSync(artifact.path))!==before)throw Error('Evidence artifact changed during capture: '+artifact.name);return {name:artifact.name,path:target,sha256:actual,role:artifact.role};
    });
    receipt.buildHash??=receipt.artifacts.find(artifact=>artifact.role==='build')?.sha256;receipt.helperHash??=receipt.artifacts.find(artifact=>artifact.role==='helper')?.sha256;
    const bytes=Buffer.from(JSON.stringify(receiptSchema.parse(receipt),null,2));writeFileSync(join(directory,'receipt.json'),bytes,{flag:'wx'});writeFileSync(join(directory,'receipt.sha256'),hash(bytes),{flag:'wx'});return receipt;
  }
  list(candidate?:string):EvidenceReceipt[]{
    if(!existsSync(this.root))return [];
    const result:EvidenceReceipt[]=[];
    for(const entry of readdirSync(this.root,{withFileTypes:true})){if(!entry.isDirectory()||!uuid.safeParse(entry.name).success)continue;const file=join(this.root,entry.name,'receipt.json');if(!existsSync(file))continue;
      const seal=join(this.root,entry.name,'receipt.sha256');if(!existsSync(seal))continue;fileWithin(this.root,file);fileWithin(this.root,seal);const bytes=readFileSync(file);if(hash(bytes)!==readFileSync(seal,'utf8'))throw Error('Evidence receipt metadata hash changed.');
      const receipt=receiptSchema.parse(JSON.parse(bytes.toString('utf8')));if(receipt.id!==entry.name||receipt.runId!==this.runId)throw Error('Evidence receipt identity changed.');if(candidate&&receipt.candidate!==candidate)continue;
      for(const artifact of receipt.artifacts){const location=fileWithin(join(this.root,receipt.id),artifact.path);if(hash(readFileSync(location))!==artifact.sha256)throw Error('Immutable evidence artifact hash changed: '+artifact.name);}
      result.push(receipt);
    }return result;
  }
  command(candidate:string,command:{executable:string;args:string[];platform?:string},directory:string,inputs:{name:string;path:string;role?:'build'|'helper'|'capture'|'log'}[]=[],kind:EvidenceKind='command'){
    tree.parse(candidate);fileWithin(directory,'process.json');fileWithin(directory,'command-result.json');const process=JSON.parse(readFileSync(join(directory,'process.json'),'utf8').replace(/^\uFEFF/,'')),result=JSON.parse(readFileSync(join(directory,'command-result.json'),'utf8'));
    if(!process.drained||process.status!=='exited'||!Number.isInteger(result.code)||process.exitCode!==(result.code===0&&!result.error?0:1))throw Error('A command receipt requires confirmed process exit and drain.');
    if(!/^Local\\Barracks-[a-f0-9-]{36}$/.test(process.jobName))throw Error('Command evidence must come from an owned Barracks job.');
    if(kind==='physical')throw Error('Physical acceptance requires an explicit operator observation.');
    if(['native','browser'].includes(kind)&&result.code===0&&!result.error&&(!command.platform||!inputs.some(artifact=>artifact.role==='build')))throw Error('Passed platform command evidence requires its platform and immutable build artifact.');
    return this.save({id:randomUUID(),runId:this.runId,candidate,origin:'runner',kind,status:result.code===0&&!result.error?'passed':'failed',createdAt:new Date().toISOString(),note:'Actual owned command exit '+result.code+'.',...(command.platform?{platform:command.platform}:{}),command:{executable:command.executable,args:command.args,exitCode:result.code,directory,jobName:process.jobName},artifacts:[]},[
      ...['command.json','process.json','command-result.json','stdout.log','stderr.log'].filter(name=>existsSync(join(directory,name))).map(name=>({name,path:join(directory,name)})),...inputs
    ]);
  }
  observe(input:unknown,candidate:string,approvedRoots:string[]){
    const observation=observationSchema.parse(input);if(observation.candidate!==candidate)throw Error('Observation belongs to a different source candidate.');
    if(observation.kind==='command')throw Error('Operator observations cannot fabricate runner command receipts.');
    if(observation.kind==='waiver'&&observation.status!=='waived')throw Error('A waiver retains waived status.');
    if(observation.status==='waived'&&observation.kind!=='waiver')throw Error('Waived criteria require an explicit waiver receipt.');
    const previous=this.list(candidate);for(const id of observation.references)if(!previous.some(receipt=>receipt.id===id))throw Error('Referenced evidence is missing or stale.');
    if(observation.references.some(id=>previous.some(receipt=>receipt.id===id&&receipt.criterion&&receipt.criterion!==observation.criterion)))throw Error('Referenced evidence belongs to another criterion.');
    if(observation.kind==='adjudication'&&(!observation.references.length||!observation.covers.length))throw Error('Adjudication must retain the referenced measurements and its bounded evidence scope.');
    if(observation.kind==='adjudication'&&observation.covers.some(kind=>!previous.some(receipt=>observation.references.includes(receipt.id)&&receipt.kind===kind)))throw Error('Adjudication cannot invent a measurement kind absent from its references.');
    for(const [field,kind] of [['buildHash','build'],['helperHash','helper']] as const)if(observation[field]&&!previous.some(receipt=>receipt.artifacts.some(artifact=>artifact.role===kind&&artifact.sha256===observation[field])))throw Error('Observation '+field+' is not a recorded artifact for this candidate.');
    if(['native','browser','physical'].includes(observation.kind)&&observation.status==='passed'&&(!observation.buildHash||!observation.platform))throw Error('A passed platform observation needs the recorded build hash and platform.');
    const inputs=observation.artifacts.map(artifact=>{let path:string|undefined;for(const root of approvedRoots)try{path=fileWithin(root,artifact.path);break;}catch{}if(!path)throw Error('Artifact is outside the approved project, tracker or run evidence folders: '+artifact.path);return {name:artifact.name??basename(path),path,role:artifact.role};});
    return this.save({...observation,id:randomUUID(),runId:this.runId,origin:'operator',createdAt:new Date().toISOString(),artifacts:[]},inputs);
  }
  sourceReview(candidate:string,criterion:string,input:unknown){
    tree.parse(candidate);const proof=sourceReviewSchema.parse(input);
    if(proof.candidate!==candidate)throw Error('Source review belongs to another combined candidate.');
    for(const ticket of proof.tickets){
      if(ticket.reviews.some(review=>review.candidate!==ticket.candidate))throw Error('Source review belongs to another ticket candidate.');
      if(ticket.reviews.some(review=>review.reviewer===ticket.author)||new Set(ticket.reviews.map(review=>review.reviewer)).size!==ticket.reviews.length)throw Error('Source reviews require distinct independent reviewers.');
    }
    const existing=this.list(candidate).find(receipt=>receipt.origin==='runner'&&receipt.kind==='source'&&receipt.criterion===criterion);if(existing)return existing;
    const file=join(this.root,'source-review-'+randomUUID()+'.json');assertStorage(file);mkdirSync(this.root,{recursive:true});writeFileSync(file,JSON.stringify(proof,null,2),{flag:'wx'});
    return this.save({id:randomUUID(),runId:this.runId,candidate,origin:'runner',kind:'source',status:'passed',criterion,createdAt:new Date().toISOString(),note:'Independent ticket source reviews and Lead review of the exact combined candidate passed.',artifacts:[]},[{name:'Candidate-bound source review provenance',path:file}]);
  }
  validate(candidate:string,criteria:{criterion:string;status:string;evidenceIds?:string[]}[],requirements:EvidenceRequirement[]){
    const receipts=this.list(candidate);
    for(const criterion of criteria){
      const cited=(criterion.evidenceIds??[]).map(id=>{const receipt=receipts.find(receipt=>receipt.id===id);if(!receipt)throw Error('Acceptance cites missing or stale evidence: '+id);if(receipt.criterion&&receipt.criterion!==criterion.criterion)throw Error('Acceptance cites evidence for another criterion.');return receipt;});
      if(criterion.status==='waived'&&!cited.some(receipt=>receipt.origin==='operator'&&receipt.kind==='waiver'&&receipt.status==='waived'&&receipt.criterion===criterion.criterion))throw Error('Waived acceptance needs the explicit operator waiver.');
      if(criterion.status!=='passed')continue;
      const required=requirements.find(item=>item.criterion===criterion.criterion)?.kinds;
      if(!required?.length)throw Error('Acceptance lacks an evidence requirement for '+criterion.criterion+'.');
      for(const kind of required)if(!cited.some(receipt=>receipt.status==='passed'&&(receipt.kind===kind||(kind==='command'&&!!receipt.command)||(receipt.origin==='operator'&&receipt.kind==='adjudication'&&receipt.criterion===criterion.criterion&&receipt.covers?.includes(kind)))))throw Error('Acceptance lacks passed '+kind+' evidence for '+criterion.criterion+'.');
    }
    return receipts;
  }
}

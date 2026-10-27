import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Project} from './projects.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import {reconcileTransfer,verifyTransfer} from './transfer-manifest.ts';
import {authorizeTransfer,verifyTransferActivation} from './transfer-activation.ts';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex'),oid=z.string().regex(/^[a-f0-9]{40}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
function location(root:string,name:string){const file=resolve(root,name);if(!file.startsWith(resolve(root)+sep))throw Error('Transfer execution record escapes its folder.');for(let cursor=file;;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Transfer execution records cannot contain links.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(cursor===dirname(cursor))break;}return file;}
function read(root:string,name:string){const file=location(root,name);if(!existsSync(file))return undefined;const bytes=readFileSync(file);if(existsSync(file+'.sha256')&&readFileSync(location(root,name+'.sha256'),'utf8')!==hash(bytes))throw Error('Transfer execution record seal changed.');return JSON.parse(bytes.toString('utf8'));}
function save(root:string,name:string,value:unknown){const file=location(root,name),bytes=JSON.stringify(value,null,2);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)){if(!readFileSync(location(root,name)).equals(Buffer.from(bytes)))throw Error('A different transfer execution record already exists.');}else writeFileSync(file,bytes,{flag:'wx',flush:true});const seal=file+'.sha256';if(existsSync(seal)){if(readFileSync(location(root,name+'.sha256'),'utf8')!==hash(bytes))throw Error('Transfer execution seal changed.');}else writeFileSync(seal,hash(bytes),{flag:'wx',flush:true});}
const adoptionSchema=z.object({manifestHash:digest,projectId:z.string(),firstRunId:z.string().uuid(),epoch:z.number().int().positive()}).strict();
const claimSchema=z.object({manifestHash:digest,ticketId:z.string(),parentRunId:z.string().uuid(),childRunId:z.string().uuid(),participantId:z.string()}).strict();
const deliveredSchema=claimSchema.extend({candidate:oid}).strict();
const key=(ticketId:string)=>'claims/'+hash(ticketId);

/** Called while both canonical authority locks are held, before initial dispatch. */
export function adoptProjectTransfer(project:Project,runId:string,epoch:number){
  if(!project.transfer)return;const {root,sha256}=project.transfer,existing=read(root,'adoption.json');
  if(existing&&existsSync(location(root,'adoption.json.sha256'))){const adoption=adoptionSchema.parse(existing);if(adoption.manifestHash!==sha256||adoption.projectId!==project.id)throw Error('Transfer adoption belongs to another project or approval.');return;}
  const activation=verifyTransferActivation(root,sha256);
  // Recheck source/tracker effects and old process identity at actual adoption,
  // not merely when the operator recorded the approval.
  authorizeTransfer(root,{manifestHash:sha256,userApproval:activation.userApproval,fencePath:join(root,'coordinator-fence.json'),fenceHash:activation.fenceHash});
  if(reconcileTransfer(root).effects.length)throw Error('The approved transfer changed before its first runtime adoption.');
  const adoption=adoptionSchema.parse(existing??{manifestHash:sha256,projectId:project.id,firstRunId:runId,epoch});if(adoption.manifestHash!==sha256||adoption.projectId!==project.id)throw Error('Partial transfer adoption changed identity.');save(root,'adoption.json',adoption);
}
export function claimTransferredAssignment(project:Project,ticketId:string,parentRunId:string,childRunId:string,participantId:string){
  const {root,sha256}=project.transfer!,file=key(ticketId),delivered=read(root,file+'.delivered.json');if(delivered){if(!existsSync(location(root,file+'.delivered.json.sha256')))throw Error('Transferred publication acknowledgement is incomplete; reconcile its original workflow.');const record=deliveredSchema.parse(delivered);if(record.manifestHash!==sha256||record.ticketId!==ticketId)throw Error('Transferred delivery record changed identity.');return false;}
  const existing=read(root,file+'.json'),claim=claimSchema.parse(existing??{manifestHash:sha256,ticketId,parentRunId,childRunId,participantId});
  if(claim.manifestHash!==sha256||claim.ticketId!==ticketId||claim.parentRunId!==parentRunId||claim.childRunId!==childRunId||claim.participantId!==participantId)throw Error('Transferred assignment already belongs to another saved child workflow; resume or reconcile that lineage before reassigning it.');
  save(root,file+'.json',claim);return true;
}
export function completeTransferredAssignments(run:WorkflowRun,project:Project){
  if(!project.transfer)return;const {root,sha256}=project.transfer;
  if(!run.parallel?.publication||run.parallel.publication.candidate!==run.baseCandidate)throw Error('Transferred progress is consumed only after accepted Source publication.');
  for(const ticketId of run.ticketOrder??[]){const file=key(ticketId),existing=read(root,file+'.json');if(!existing)continue;const claim=claimSchema.parse(existing);if(claim.parentRunId!==run.id)continue;if(claim.manifestHash!==sha256)throw Error('Transferred assignment approval changed before publication.');save(root,file+'.delivered.json',deliveredSchema.parse({...claim,candidate:run.baseCandidate}));}
}

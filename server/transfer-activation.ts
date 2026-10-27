import {z} from 'zod';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyTransfer,reconcileTransfer,assertTransferredOwnership} from './transfer-manifest.ts';
import {approvedEvidenceFile} from './evidence-ledger.ts';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex'),digest=z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema=z.object({manifestHash:digest,userApproval:z.string().min(1),fencePath:z.string().min(1),fenceHash:digest}).strict();
const fenceSchema=z.object({kind:z.literal('codex-team-checkpoint'),coordinator:z.object({threadId:z.string().min(1),goalStatus:z.enum(['paused','complete','none']),activeAssignments:z.literal(0),ownedJobsDrained:z.literal(true)}).strict(),participants:z.array(z.object({id:z.string(),state:z.enum(['stopped','completed','checkpointed'])}).strict())}).strict();
const activationSchema=z.object({manifestHash:digest,userApproval:z.string().min(1),approvedAt:z.string(),fenceHash:digest,participants:z.array(z.string()),processesDrained:z.literal(true)}).strict();

/** Trusted operator action after explicit user approval; no HTTP/model activation route. */
export function authorizeTransfer(root:string,input:unknown){
  const proof=proofSchema.parse(input),manifest=verifyTransfer(root),manifestBytes=readFileSync(approvedEvidenceFile(root,'manifest.json'));if(sha(manifestBytes)!==proof.manifestHash)throw Error('The final approval refers to another transfer manifest.');
  const effects=reconcileTransfer(root).effects;if(effects.length)throw Error('Refresh the paused transfer before activation; external effects changed after capture.');
  assertTransferredOwnership(manifest);
  const fenceBytes=readFileSync(proof.fencePath);if(sha(fenceBytes)!==proof.fenceHash)throw Error('Old coordinator fence evidence changed.');const fence=fenceSchema.parse(JSON.parse(fenceBytes.toString('utf8')));
  const ids=(manifest.project.team??[]).map(member=>member.id).sort(),observed=fence.participants.map(member=>member.id).sort();if(ids.join('\0')!==observed.join('\0'))throw Error('The fence must account for all four transferred participants exactly once.');
  for(const process of manifest.processes.filter(item=>item.owner==='old-team')){
    if(!Number.isFinite(Date.parse(process.startUtc)))throw Error('Old worker start identity is unknown; activation is held.');
    const actual=execFileSync('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop';try{$p=Get-Process -Id ${process.pid} -ErrorAction Stop}catch{if($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*'){return};throw};$p.StartTime.ToUniversalTime().ToString('o')`],{windowsHide:true,encoding:'utf8'}).trim();
    if(actual&&!Number.isFinite(Date.parse(actual)))throw Error('Old worker process identity could not be verified.');
    if(actual&&Date.parse(actual)===Date.parse(process.startUtc))throw Error('A recorded old-team worker process still exists: '+process.pid);
  }
  const existing=existsSync(join(root,'activation.json'))?activationSchema.parse(JSON.parse(readFileSync(approvedEvidenceFile(root,'activation.json'),'utf8'))):undefined;
  const activation=activationSchema.parse({manifestHash:proof.manifestHash,userApproval:proof.userApproval,approvedAt:existing?.approvedAt??new Date().toISOString(),fenceHash:proof.fenceHash,participants:ids,processesDrained:true});
  const writeOnce=(name:string,bytes:Buffer|string)=>{const file=join(root,name);if(existsSync(file)){if(!readFileSync(approvedEvidenceFile(root,name)).equals(Buffer.from(bytes)))throw Error('A different activation effect already exists: '+name);return;}writeFileSync(file,bytes,{flag:'wx',flush:true});};
  writeOnce('coordinator-fence.json',fenceBytes);const bytes=JSON.stringify(activation,null,2);writeOnce('activation.json',bytes);writeOnce('activation.sha256',sha(bytes));return activation;
}
export function verifyTransferActivation(root:string,manifestHash:string){
  const bytes=readFileSync(approvedEvidenceFile(root,'activation.json')),seal=readFileSync(approvedEvidenceFile(root,'activation.sha256'),'utf8');if(sha(bytes)!==seal)throw Error('Transfer activation seal changed.');const activation=activationSchema.parse(JSON.parse(bytes.toString('utf8')));if(activation.manifestHash!==manifestHash)throw Error('Transfer activation belongs to another manifest.');const fence=readFileSync(approvedEvidenceFile(root,'coordinator-fence.json'));if(sha(fence)!==activation.fenceHash)throw Error('Transferred coordinator fence changed.');return activation;
}

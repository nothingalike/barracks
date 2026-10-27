import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync,lstatSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,join,relative,dirname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

type Invoke=(root:string,args:string[],input?:unknown)=>any;
export interface TrackerMutation {args:string[];key?:string;patches?:{path:string;before:string;content:string}[]}
interface FileChange {path:string;before:string|null;after:string|null}
interface Intent {root:string;roots:string[];before:Record<string,string>;after:Record<string,string>;changes:FileChange[];result:unknown}
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const database=(root:string)=>join(root,'.workspace','barracks-operations.sqlite');
const normalized=(path:string)=>path.replaceAll('\\','/');

function local(root:string,path:string){
  const absolute=resolve(root,path);if(!absolute.startsWith(root+sep))throw Error('Tracker path escapes its root: '+path);
  if(lstatSync(root).isSymbolicLink())throw Error('Tracker root identity changed.');
  for(let cursor=absolute;cursor!==root;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Tracker path contains a link: '+path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  return absolute;
}
function snapshot(root:string,roots:string[],ignored=new Set<string>()){
  const files:Record<string,Buffer>={};
  const visit=(path:string)=>{const file=local(root,path);if(ignored.has(path)||!existsSync(file))return;const info=lstatSync(file);
    if(info.isDirectory())for(const name of readdirSync(file).sort())visit(normalized(join(path,name)));else if(info.isFile())files[path]=readFileSync(file);
  };for(const path of roots)visit(path);return files;
}
const hashes=(files:Record<string,Buffer>)=>Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,hash(bytes)]));
function rootsFor(root:string,layout:{paths:Record<string,string|null>}){
  const roots=['.workspace/pm-toolbox.yml'];
  for(const value of Object.values(layout.paths))if(value){const path=normalized(relative(root,resolve(root,value)));
    if(!path||path.split('/').some(part=>part==='..'||part.toLowerCase()==='.git')||path.toLowerCase()==='.workspace')throw Error('Tracker metadata directories must be contained source-independent folders.');local(root,path);roots.push(path);
  }return [...new Set(roots)];
}
function assertLocalPolicy(layout:{github?:{mode?:string;features?:Record<string,unknown>}}){
  const github=layout.github,writes=['create_issues','update_issues','sync_labels','sync_assignees','sync_milestones','close_on_complete','reopen_on_reopen'];
  if(github?.mode==='managed'||writes.some(name=>github?.features?.[name]))throw Error('This tracker enables external GitHub mutations. Use a local-only tracker policy until its separately authorized publication adapter is qualified.');
}
function open(root:string){
  local(root,'.workspace/barracks-operations.sqlite');mkdirSync(join(root,'.workspace'),{recursive:true});local(root,'.workspace/barracks-operations.sqlite');const db=new DatabaseSync(database(root));
  try{db.exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE;
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, request_key TEXT UNIQUE, request_hash TEXT NOT NULL,status TEXT NOT NULL,intent TEXT NOT NULL,result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(operation_id TEXT NOT NULL,path TEXT NOT NULL,before_bytes BLOB,after_bytes BLOB,PRIMARY KEY(operation_id,path));COMMIT;`);return db;}
  catch(error){db.close();throw Error('The tracker write coordinator is busy or its journal is unavailable: '+String(error));}
}
function restorePaths(value:unknown,stage:string,root:string):unknown{
  if(typeof value==='string'&&value.startsWith(stage+sep))return root+value.slice(stage.length);
  if(Array.isArray(value))return value.map(item=>restorePaths(item,stage,root));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restorePaths(item,stage,root)]));return value;
}

/** The CLI mutates a disposable copy. Only durable, preimage-checked metadata deltas reach the tracker. */
export class TrackerMutations {
  private root:string;private invoke:Invoke;
  constructor(root:string,invoke:Invoke){this.root=realpathSync(resolve(root));this.invoke=invoke;}
  static assertReadable(root:string){
    local(root,'.workspace/barracks-operations.sqlite');if(!existsSync(database(root)))return;const db=new DatabaseSync(database(root),{readOnly:true});
    try{if(db.prepare("SELECT id FROM operations WHERE status IN ('prepared','cleanup') LIMIT 1").get())throw Error('Tracker has a pending recorded write. Reconcile it before reading or assigning work.');}finally{db.close();}
  }
  reconcile(){local(this.root,'.workspace/barracks-operations.sqlite');if(!existsSync(database(this.root)))return;const db=open(this.root);try{this.replay(db);}finally{db.close();}}
  private replay(db:DatabaseSync){for(const row of db.prepare("SELECT id,intent FROM operations WHERE status IN ('prepared','cleanup') ORDER BY rowid").all())this.apply(db,row.id as string,JSON.parse(row.intent as string));}
  private apply(db:DatabaseSync,id:string,intent:Intent){
    if(intent.root!==this.root)throw Error('Tracker operation belongs to a different canonical root.');
    const tempPaths=new Set(intent.changes.filter(change=>change.after!==null).map(change=>change.path+'.barracks-'+id+'.tmp'));
    const verify=()=>{
      const actual=hashes(snapshot(this.root,intent.roots,tempPaths));
      for(const path of new Set([...Object.keys(actual),...Object.keys(intent.before),...Object.keys(intent.after)]))if(actual[path]!==intent.before[path]&&actual[path]!==intent.after[path])throw Error('Tracker changed outside its recorded operation; reconciliation held: '+path);
    };verify();
    for(const change of intent.changes){
      const file=local(this.root,change.path),current=existsSync(file)?hash(readFileSync(file)):null;if(current===change.after)continue;
      if(current!==change.before)throw Error('Tracker preimage changed: '+change.path);
      if(change.after===null){unlinkSync(file);continue;}
      const row=db.prepare('SELECT after_bytes FROM files WHERE operation_id=? AND path=?').get(id,change.path),bytes=Buffer.from(row!.after_bytes as Uint8Array);
      if(hash(bytes)!==change.after)throw Error('Recorded tracker payload hash changed.');
      const temp=local(this.root,change.path+'.barracks-'+id+'.tmp');mkdirSync(dirname(temp),{recursive:true});if(existsSync(temp)){if(hash(readFileSync(temp))!==change.after)throw Error('Recorded tracker temporary payload changed; reconciliation held: '+change.path);}else writeFileSync(temp,bytes);
      let applied=false;
      for(let attempt=0;attempt<6&&!applied;attempt++){
        const latest=existsSync(file)?hash(readFileSync(file)):null;if(latest!==change.before)throw Error('Tracker changed during publication: '+change.path);
        try{renameSync(temp,file);applied=true;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??'')||attempt===5)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1));}
      }
    }
    verify();const actual=hashes(snapshot(this.root,intent.roots,tempPaths));if(JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(intent.after).sort()))throw Error('Tracker publication has not reached its recorded final state.');
    db.prepare("UPDATE operations SET status='cleanup' WHERE id=?").run(id);
    for(const name of tempPaths){const temp=local(this.root,name);if(existsSync(temp)){const path=name.slice(0,-('.barracks-'+id+'.tmp').length);if(hash(readFileSync(temp))!==intent.after[path])throw Error('Recorded tracker temporary payload changed; cleanup held: '+name);unlinkSync(temp);}}
    db.prepare("UPDATE operations SET status='applied' WHERE id=?").run(id);
  }
  run(request:TrackerMutation){
    if(request.args[0]==='init'&&!existsSync(join(this.root,'.git')))throw Error('Tracker setup requires its own initialized Git repository.');
    const db=open(this.root);
    try{
      this.replay(db);
      const requestHash=hash(JSON.stringify([request.args,request.patches??[]])),key=request.key??randomUUID(),saved=db.prepare('SELECT request_hash,status,result FROM operations WHERE request_key=?').get(key);
      if(saved){if(saved.request_hash!==requestHash)throw Error('The recorded tracker operation key has different intent.');return JSON.parse(saved.result as string);}
      const projectArg=request.args.indexOf('--project-path');
      const initial=existsSync(join(this.root,'.workspace/pm-toolbox.yml'))?this.invoke(this.root,['barracks-layout']):{paths:{project:projectArg>=0?request.args[projectArg+1]:'project'}};
      assertLocalPolicy(initial);
      const roots=rootsFor(this.root,initial),before=snapshot(this.root,roots),beforeHashes=hashes(before),id=randomUUID(),archive=resolve('.state/tracker-operations',hash(this.root).slice(0,20),id);mkdirSync(archive,{recursive:true});
      let result:any,after:Record<string,Buffer>|undefined,stage='';
      for(let attempt=0;attempt<3;attempt++){
        stage=join(archive,'stage-'+attempt);mkdirSync(stage);execFileSync('git',['init','--initial-branch=tracker-operation',stage],{windowsHide:true,stdio:'pipe'});
        for(const [name,bytes] of Object.entries(before)){const file=local(stage,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);}
        try{
          for(const patch of request.patches??[]){if(beforeHashes[patch.path]!==patch.before)throw Error('Tracker edit revision changed: '+patch.path);const file=local(stage,patch.path);writeFileSync(file,patch.content);}
          result=this.invoke(stage,request.args);if(request.args[0]!=='index')this.invoke(stage,['index','rebuild']);const validation=this.invoke(stage,['workspace','validate']);if(validation?.valid===false||(Array.isArray(validation?.issues)&&validation.issues.length))throw Error('Staged tracker validation failed: '+JSON.stringify(validation));
          after=snapshot(stage,rootsFor(stage,this.invoke(stage,['barracks-layout'])));break;
        }catch(error){writeFileSync(join(archive,'failure-'+attempt+'.txt'),String(error));if(attempt===2||!String(error).includes('EPERM'))throw error;}
      }
      if(!after)throw Error('Tracker stage produced no validated result.');
      const current=hashes(snapshot(this.root,roots));if(JSON.stringify(Object.entries(current).sort())!==JSON.stringify(Object.entries(beforeHashes).sort()))throw Error('Tracker changed while its operation was staged. No canonical result was applied.');
      const afterHashes=hashes(after),changes=[...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(name=>beforeHashes[name]!==afterHashes[name]).map(path=>({path,before:beforeHashes[path]??null,after:afterHashes[path]??null}));
      const intent:Intent={root:this.root,roots:[...new Set([...roots,...rootsFor(stage,this.invoke(stage,['barracks-layout']))])],before:beforeHashes,after:afterHashes,changes,result:restorePaths(result,stage,this.root)};
      for(const change of changes)if(existsSync(local(this.root,change.path+'.barracks-'+id+'.tmp')))throw Error('Tracker temporary path existed before this operation was reserved.');
      db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?)').run(id,key,requestHash,'prepared',JSON.stringify(intent),JSON.stringify(intent.result));for(const change of changes)db.prepare('INSERT INTO files VALUES (?,?,?,?)').run(id,change.path,before[change.path]??null,after[change.path]??null);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      writeFileSync(join(archive,'intent.json'),JSON.stringify(intent,null,2));this.apply(db,id,intent);return intent.result;
    }finally{db.close();}
  }
}

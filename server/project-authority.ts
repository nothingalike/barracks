import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import type {Project} from './projects.ts';

/** Process-lifetime SQLite lock: a second coordinator cannot dispatch this project. */
export class ProjectAuthority {
  private held=new Map<string,{dbs:DatabaseSync[];epoch:number;runId:string}>();
  private key(project:Project){return [project.path,project.trackerPath??project.path].map(path=>realpathSync(path).toLowerCase()).join('\0');}
  acquire(project:Project,runId:string){
    const key=this.key(project),existing=this.held.get(key);if(existing){if(existing.runId!==runId)throw Error('This coordinator already owns another project delivery.');return existing.epoch;}
    const source=realpathSync(project.path),tracker=realpathSync(project.trackerPath??project.path),roots=[join(source,'.state'),join(tracker,'.workspace')];
    const dbs:DatabaseSync[]=[];let epoch=0;
    try{for(const folder of roots.sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()))){const file=join(folder,'barracks-authority.sqlite');
    for(let path=file;;path=dirname(path)){try{if(lstatSync(path).isSymbolicLink())throw Error('Project authority storage cannot contain links.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(path===dirname(path))break;}
    mkdirSync(folder,{recursive:true});const db=new DatabaseSync(file);dbs.push(db);
    db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS authority(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,run_id TEXT NOT NULL);');
    const old=db.prepare('SELECT epoch FROM authority WHERE id=1').get() as {epoch:number}|undefined,next=(old?.epoch??0)+1;epoch=Math.max(epoch,next);
    db.prepare('INSERT INTO authority(id,epoch,run_id) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,run_id=excluded.run_id').run(next,runId);db.exec('COMMIT');
    }this.held.set(key,{dbs,epoch,runId});return epoch;
    }catch(error){for(const db of dbs)db.close();throw Error('Another coordinator owns this project, or its authority journal requires recovery: '+String(error));}
  }
  assert(project:Project,runId:string,epoch:number){const held=this.held.get(this.key(project));if(!held||held.runId!==runId||held.epoch!==epoch)throw Error('Project dispatch epoch is not owned by this coordinator.');}
  owns(project:Project,runId:string){return this.held.get(this.key(project))?.runId===runId;}
  release(project:Project,runId:string){const key=this.key(project),held=this.held.get(key);if(held?.runId===runId){for(const db of held.dbs)db.close();this.held.delete(key);}}
  close(){for(const held of this.held.values())for(const db of held.dbs)db.close();this.held.clear();}
}

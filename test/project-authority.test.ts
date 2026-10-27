import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectSchema} from '../server/projects.ts';
import {ProjectAuthority} from '../server/project-authority.ts';

test('project ownership spans independent databases, retains its lock after commit, and advances epoch only after drain/release',()=>{
  const path=resolve('.state/authority-tests',randomUUID());mkdirSync(path,{recursive:true});const project=projectSchema.parse({id:'authority',name:'Authority',kind:'fixture',path,reviewChecklist:'One owner.'});
  const first=new ProjectAuthority(),second=new ProjectAuthority();try{const epoch=first.acquire(project,'first-run');first.assert(project,'first-run',epoch);assert.throws(()=>second.acquire(project,'second-run'),/Another coordinator/);assert.throws(()=>second.acquire(project,'first-run'),/Another coordinator/);first.release(project,'first-run');const next=second.acquire(project,'second-run');assert.equal(next,epoch+1);assert.throws(()=>first.assert(project,'first-run',epoch),/not owned/);second.assert(project,'second-run',next);}finally{first.close();second.close();}
  const tracker=resolve('.state/authority-tests',randomUUID());mkdirSync(tracker);const alternate={...project,trackerPath:tracker};try{first.acquire(project,'source-owner');assert.throws(()=>second.acquire(alternate,'other-tracker'),/Another coordinator/);first.close();second.acquire(alternate,'other-tracker');assert.throws(()=>first.acquire(project,'source-owner'),/Another coordinator/);}finally{first.close();second.close();}
});

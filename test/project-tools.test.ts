import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {projectSchema} from '../server/projects.ts';
import {projectEnvironment} from '../server/project-command.ts';

test('pinned tools use independent private copies and reject changed installers, private binaries and linked runtime folders',()=>{
  const root=resolve('.state/project-tools-tests',randomUUID()),installed=join(root,'trusted.exe'),a=join(root,'author'),b=join(root,'reviewer'),outside=join(root,'outside');for(const path of [a,b,outside])mkdirSync(path,{recursive:true});writeFileSync(installed,'controlled fixture executable bytes');const bytes=readFileSync(installed),sha256=createHash('sha256').update(bytes).digest('hex');
  const project=projectSchema.parse({id:'tools',name:'Tools',kind:'fixture',path:a,reviewChecklist:'Private trusted tools.',tools:[{name:'wasm-bindgen.exe',path:installed,sha256}]});
  for(const workspace of [a,b]){const environment=projectEnvironment(project,workspace,'node');assert.ok(environment.PATH!.startsWith(join(workspace,'.state/tools')+';'));assert.ok(readFileSync(join(workspace,'.state/tools/wasm-bindgen.exe')).equals(bytes));}
  writeFileSync(join(a,'.state/tools/wasm-bindgen.exe'),'author changed tool');assert.throws(()=>projectEnvironment(project,a,'node'),/Private tool changed/);assert.ok(readFileSync(join(b,'.state/tools/wasm-bindgen.exe')).equals(bytes));
  const linked=join(root,'linked');mkdirSync(join(linked,'.state'),{recursive:true});symlinkSync(outside,join(linked,'.state/tools'),'junction');assert.throws(()=>projectEnvironment(project,linked,'node'),/cannot contain links/);assert.deepEqual(readdirSync(outside),[]);
  writeFileSync(installed,'installed version changed');assert.throws(()=>projectEnvironment(project,b,'node'),/approved hash/);assert.throws(()=>projectSchema.parse({...project,tools:[{...project.tools![0],name:'../escape.exe'}]}));
});

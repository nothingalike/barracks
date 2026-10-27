import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {listPersonas,savePersona,deletePersona,personaContents} from '../server/personas.ts';
test('persona files support stable IDs, name/instruction edits, optimistic conflicts and reference-safe deletion',()=>{
  const root=resolve('.state/persona-tests',randomUUID()),personas=join(root,'personas'),graph=join(root,'workflows.json');mkdirSync(personas,{recursive:true});writeFileSync(graph,readFileSync('config/workflows.json'));writeFileSync(join(personas,'architect.md'),'# Architect\n\nOriginal architecture rules.\n');
  const oldPersonas=process.env.BARRACKS_PERSONAS_PATH,oldGraph=process.env.BARRACKS_WORKFLOWS_PATH;process.env.BARRACKS_PERSONAS_PATH=personas;process.env.BARRACKS_WORKFLOWS_PATH=graph;
  try{
    const architect=listPersonas().find(persona=>persona.id==='architect')!;assert.equal(architect.usedBy[0]!.workflowId,'grilling');assert.deepEqual(architect.usedBy[0]!.states,['challenge','specify']);assert.throws(()=>deletePersona('architect',{revision:architect.revision}),/used by/);
    const created=savePersona({id:'researcher',name:'Researcher',instructions:'Inspect the supplied sources.'});assert.equal(created.usedBy.length,0);assert.match(personaContents('researcher'),/^# Researcher/);
    const edited=savePersona({name:'Research specialist',instructions:'Keep claims tied to direct sources.',revision:created.revision},created.id);assert.equal(edited.id,created.id);assert.notEqual(edited.revision,created.revision);assert.equal(edited.name,'Research specialist');assert.throws(()=>savePersona({name:'Stale',instructions:'Stale instructions.',revision:created.revision},created.id),/changed since/);assert.throws(()=>deletePersona(created.id,{revision:created.revision}),/changed since/);
    assert.throws(()=>savePersona({id:'researcher',name:'Duplicate',instructions:'Different.'}),/already exists/);assert.throws(()=>savePersona({id:'../escape',name:'Invalid',instructions:'Invalid.'}));assert.throws(()=>savePersona({id:'empty',name:'Empty',instructions:' '}));
    assert.match(readFileSync(join(personas,'researcher.md'),'utf8'),/Keep claims tied/);deletePersona(edited.id,{revision:edited.revision});assert.equal(listPersonas().some(persona=>persona.id===edited.id),false);assert.equal(personaContents('architect'),'# Architect\n\nOriginal architecture rules.\n');
  }finally{if(oldPersonas===undefined)delete process.env.BARRACKS_PERSONAS_PATH;else process.env.BARRACKS_PERSONAS_PATH=oldPersonas;if(oldGraph===undefined)delete process.env.BARRACKS_WORKFLOWS_PATH;else process.env.BARRACKS_WORKFLOWS_PATH=oldGraph;}
});

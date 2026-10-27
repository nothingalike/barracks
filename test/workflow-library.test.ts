import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,copyFileSync,cpSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {listWorkflowDefinitions,saveWorkflowDefinition,deleteWorkflowDefinition} from '../server/workflow-library.ts';
import {listPersonas,deletePersona} from '../server/personas.ts';
test('workflow Library validates graphs and personas before atomic saves, detects stale revisions and releases references',()=>{
  const root=resolve('.state/workflow-library-tests',randomUUID());mkdirSync(root,{recursive:true});copyFileSync('config/workflows.json',join(root,'workflows.json'));cpSync('config/personas',join(root,'personas'),{recursive:true});const oldGraph=process.env.BARRACKS_WORKFLOWS_PATH,oldPersonas=process.env.BARRACKS_PERSONAS_PATH;process.env.BARRACKS_WORKFLOWS_PATH=join(root,'workflows.json');process.env.BARRACKS_PERSONAS_PATH=join(root,'personas');
  try{
    const initial=listWorkflowDefinitions(),copy=structuredClone(initial.definitions[0]!);copy.id='copied';copy.name='A copied workflow';
    const saved=saveWorkflowDefinition({definition:copy,revision:initial.revision});assert.equal(saved.definitions.length,initial.definitions.length+1);assert.notEqual(saved.revision,initial.revision);
    assert.throws(()=>saveWorkflowDefinition({definition:copy,revision:initial.revision},copy.id),/changed/);
    const before=readFileSync(join(root,'workflows.json'),'utf8'),invalid=structuredClone(copy);invalid.states[invalid.initial]!.on.broken={target:'missing',outputs:{},clear:[],remember:false};assert.throws(()=>saveWorkflowDefinition({definition:invalid,revision:saved.revision},copy.id),/target does not exist/);assert.equal(readFileSync(join(root,'workflows.json'),'utf8'),before);
    const missing=structuredClone(copy);missing.participants=[];missing.states[missing.initial]!.persona='missing-persona';assert.throws(()=>saveWorkflowDefinition({definition:missing,revision:saved.revision},copy.id),/Persona not found/);assert.equal(readFileSync(join(root,'workflows.json'),'utf8'),before);
    assert.throws(()=>saveWorkflowDefinition({definition:{...copy,id:'renamed'},revision:saved.revision},copy.id),/remain stable/);
    assert.equal(listPersonas().find(item=>item.id==='architect')!.usedBy.length,2);
    assert.throws(()=>deleteWorkflowDefinition(copy.id,{revision:initial.revision}),/changed/);
    let current=deleteWorkflowDefinition(copy.id,{revision:saved.revision});assert.equal(listPersonas().find(item=>item.id==='architect')!.usedBy.length,1);
    current=deleteWorkflowDefinition('grilling',{revision:current.revision});const architect=listPersonas().find(item=>item.id==='architect')!;assert.equal(architect.usedBy.length,0);deletePersona(architect.id,{revision:architect.revision});assert.equal(current.definitions.length,initial.definitions.length-1);
  }finally{if(oldGraph===undefined)delete process.env.BARRACKS_WORKFLOWS_PATH;else process.env.BARRACKS_WORKFLOWS_PATH=oldGraph;if(oldPersonas===undefined)delete process.env.BARRACKS_PERSONAS_PATH;else process.env.BARRACKS_PERSONAS_PATH=oldPersonas;}
});

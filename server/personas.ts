import {readFileSync,readdirSync,mkdirSync,existsSync,realpathSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {z} from 'zod';
import {libraryId,personaFields,type Persona} from '../shared/library.ts';
import type {WorkflowDefinition} from '../shared/state-machine.ts';
import {workflows} from './workflow-definitions.ts';
import {LibraryError,validated,revision,regularFile,atomicWrite} from './library-files.ts';
export const personaDirectory=()=>resolve(process.env.BARRACKS_PERSONAS_PATH??'config/personas');
function fileFor(id:string){validated(libraryId,id);return join(realpathSync(personaDirectory()),id+'.md');}
export function personaContents(id:string){const file=fileFor(id);regularFile(file);if(!existsSync(file))throw new LibraryError('Persona not found: '+id,404);return readFileSync(file,'utf8');}
function record(id:string,definitions:WorkflowDefinition[]):Persona{
  const text=personaContents(id),heading=/^#\s+([^\r\n]+)\r?\n(?:\r?\n)?/.exec(text);
  return {id,name:heading?.[1]?.trim()??id,instructions:heading?text.slice(heading[0].length).trimEnd():text.trimEnd(),revision:revision(text),usedBy:definitions.flatMap(workflow=>{const states=Object.entries(workflow.states).filter(([,state])=>state.persona===id).map(([id])=>id);return states.length?[{workflowId:workflow.id,workflowName:workflow.name,states}]:[];})};
}
export function listPersonas(){const definitions=workflows();if(!existsSync(personaDirectory()))return [];return readdirSync(personaDirectory(),{withFileTypes:true}).filter(entry=>entry.isFile()&&!entry.isSymbolicLink()&&entry.name.endsWith('.md')&&libraryId.safeParse(entry.name.slice(0,-3)).success).map(entry=>record(entry.name.slice(0,-3),definitions)).sort((a,b)=>a.name.localeCompare(b.name));}
export function savePersona(input:unknown,id?:string){
  const fields=id?validated(personaFields.extend({revision:z.string().min(1)}),input):validated(personaFields.extend({id:libraryId}),input),key=id??('id' in fields?fields.id:'');validated(libraryId,key);const definitions=workflows();
  mkdirSync(personaDirectory(),{recursive:true});const file=fileFor(key);if(id&&!existsSync(file))throw new LibraryError('Persona no longer exists. Reload the Library.',404);
  const text='# '+fields.name+'\n\n'+fields.instructions.replaceAll('\r\n','\n').trimEnd()+'\n';atomicWrite(file,text,'revision' in fields?String(fields.revision):undefined);return record(key,definitions);
}
export function deletePersona(id:string,input:unknown){
  const fields=validated(z.object({revision:z.string().min(1)}).strict(),input),persona=record(id,workflows());
  if(persona.revision!==fields.revision)throw new LibraryError('This persona changed since you opened it. Reload it before deleting.',409);
  if(persona.usedBy.length)throw new LibraryError('This persona is used by '+persona.usedBy.map(use=>use.workflowName).join(', ')+'. Reassign those states before deleting it.',409);
  unlinkSync(fileFor(id));return {ok:true};
}

import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {workflowDefinitionSchema} from '../shared/state-machine.ts';
import {libraryId} from '../shared/library.ts';
import {workflows,workflowFile,validateTicketWorkflows} from './workflow-definitions.ts';
import {personaContents} from './personas.ts';
import {atomicWrite,LibraryError,regularFile,revision,validated} from './library-files.ts';

export function listWorkflowDefinitions(){regularFile(workflowFile());return {definitions:workflows(),revision:revision(readFileSync(workflowFile(),'utf8'))};}
export function saveWorkflowDefinition(input:unknown,id?:string){
  const fields=validated(z.object({definition:z.unknown(),revision:z.string().min(1)}).strict(),input);
  const definition=validated(workflowDefinitionSchema,fields.definition);validated(libraryId,definition.id);
  if(id&&definition.id!==id)throw new LibraryError('Workflow IDs remain stable. Duplicate the workflow to use another ID.');
  const current=listWorkflowDefinitions();
  if(current.revision!==fields.revision)throw new LibraryError('The workflow Library changed. Reload saved definitions before saving.',409);
  if(id&&!current.definitions.some(item=>item.id===id))throw new LibraryError('Workflow no longer exists.',404);
  if(!id&&current.definitions.some(item=>item.id===definition.id))throw new LibraryError('That workflow ID already exists.',409);
  for(const persona of definition.participants)personaContents(persona);
  const next=id?current.definitions.map(item=>item.id===id?definition:item):[...current.definitions,definition];
  validateTicketWorkflows(next);
  atomicWrite(workflowFile(),JSON.stringify(next,null,2)+'\n',fields.revision);return listWorkflowDefinitions();
}
export function deleteWorkflowDefinition(id:string,input:unknown){
  const fields=validated(z.object({revision:z.string().min(1)}).strict(),input),current=listWorkflowDefinitions();
  if(!current.definitions.some(item=>item.id===id))throw new LibraryError('Workflow no longer exists.',404);
  const owners=current.definitions.filter(item=>item.ticketWorkflowId===id);if(owners.length)throw new LibraryError('This ticket workflow is used by '+owners.map(item=>item.name).join(', ')+'. Reassign it before deletion.');
  atomicWrite(workflowFile(),JSON.stringify(current.definitions.filter(item=>item.id!==id),null,2)+'\n',fields.revision);return listWorkflowDefinitions();
}

import {z} from 'zod';
import type {WorkflowDefinition} from './state-machine.ts';
export interface WorkflowLibrary {definitions:WorkflowDefinition[];revision:string}
export const libraryId=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/,'Use lowercase letters, numbers, hyphens or underscores, starting with a letter.').refine(value=>!['constructor','prototype','__proto__'].includes(value),'Choose another ID.');
export const personaFields=z.object({name:z.string().trim().min(1).max(120).refine(value=>!/[\r\n]/.test(value),'Name must fit on one line.'),instructions:z.string().min(1).max(30000).refine(value=>!!value.trim(),'Instructions are required.')}).strict();
export interface PersonaUse {workflowId:string;workflowName:string;states:string[]}
export interface Persona {id:string;name:string;instructions:string;revision:string;usedBy:PersonaUse[]}

import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync,linkSync,lstatSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import type {ZodType} from 'zod';
export class LibraryError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export const revision=(text:string)=>createHash('sha256').update(text).digest('hex');
export function validated<T>(schema:ZodType<T>,input:unknown):T{const parsed=schema.safeParse(input);if(!parsed.success)throw new LibraryError(parsed.error.issues.map(issue=>(issue.path.join('.')||'Definition')+': '+issue.message).join('; '));return parsed.data;}
export function regularFile(file:string){if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))throw new LibraryError('Library definitions must be regular files.');}
export function atomicWrite(file:string,text:string,expected?:string){
  regularFile(file);
  if(expected!==undefined){if(!existsSync(file)||revision(readFileSync(file,'utf8'))!==expected)throw new LibraryError('This definition changed since you opened it. Reload it before saving.',409);}else if(existsSync(file))throw new LibraryError('That ID already exists. Choose another ID.',409);
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,text,{flag:'wx'});if(expected===undefined){try{linkSync(temporary,file);}catch(error){if((error as {code?:string}).code==='EEXIST')throw new LibraryError('That ID already exists. Choose another ID.',409);throw error;}}else{if(revision(readFileSync(file,'utf8'))!==expected)throw new LibraryError('This definition changed since you opened it. Reload it before saving.',409);renameSync(temporary,file);}}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}

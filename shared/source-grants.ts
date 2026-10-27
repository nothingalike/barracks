import {z} from 'zod';
export const sourceGrantSchema=z.string().min(1).max(500).refine(path=>!path.includes('\\')&&!path.includes(':')&&!path.startsWith('/')&&!path.includes('\0')&&!path.endsWith('//')&&path.replace(/\/$/,'').split('/').every(part=>!!part&&!['.','..','.git','.state','node_modules'].includes(part.toLowerCase())),'Use a relative source file or directory inside the task.');
export const resourceNameSchema=z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,149}$/);
const normalized=(path:string)=>path.replace(/\/$/,'').toLowerCase();
export function grantIncludes(grant:string,path:string){const base=normalized(grant),file=normalized(path);return base===file||file.startsWith(base+'/');}
export function grantsOverlap(a:string,b:string){return grantIncludes(a,b)||grantIncludes(b,a);}
export interface SourceDelegation {delivery?:{leadDelegation?:'listed'|'project';sharedPaths?:string[]};protectedPaths?:string[]}
export function leadMayGrant(project:SourceDelegation|undefined,path:string){
  return sourceGrantSchema.safeParse(path).success&&!(project?.protectedPaths??[]).some(protectedPath=>grantsOverlap(path,protectedPath))&&(project?.delivery?.leadDelegation==='project'||(project?.delivery?.sharedPaths??[]).some(grant=>grantIncludes(grant,path)));
}
export function sourceDelegationInstructions(project:SourceDelegation){
  return project.delivery?.leadDelegation==='project'?'The Lead may approve the smallest requested relative project paths necessary for this approved ticket. Resolve routine interface contracts, file ownership and implementation choices without operator approval. Preserve requirements, protected files, source ownership locks, independent reviews and saved branch/publication authority. Escalate actual product/scope changes, protected-file needs or external/publication authority.':'The Lead may grant only requested paths within this list: '+JSON.stringify(project.delivery?.sharedPaths??[]);
}
export function assertSourceGrants(before:Record<string,string>,after:Record<string,string>,grants:string[]|undefined){
  if(grants===undefined)return;
  for(const path of new Set([...Object.keys(before),...Object.keys(after)]))if(before[path]!==after[path]&&!grants.some(grant=>grantIncludes(grant,path)))throw Error('Source change requires its owner grant: '+path+'. Request a project Lead interface decision before changing shared files.');
}
export const interfaceRequestSchema=z.object({question:z.string().min(1).max(8000),paths:z.array(sourceGrantSchema).min(1).max(30)}).strict();

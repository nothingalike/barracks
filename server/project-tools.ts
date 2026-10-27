import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project} from './projects.ts';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function check(path:string){for(let cursor=resolve(path);;cursor=dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw Error('Pinned tool paths cannot contain links.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(cursor===dirname(cursor))break;}}
/** Trusted runner copies pinned installed tools into each private candidate's runtime folder. */
export function materializeProjectTools(project:Project,workspace:string){
  if(!project.tools?.length)return undefined;
  const directory=join(workspace,'.state','tools');check(directory);mkdirSync(directory,{recursive:true});
  for(const tool of project.tools){check(tool.path);const bytes=readFileSync(tool.path);if(hash(bytes)!==tool.sha256)throw Error('Installed tool no longer matches its approved hash: '+tool.name);
    const target=join(directory,tool.name);check(target);if(existsSync(target)){if(hash(readFileSync(target))!==tool.sha256)throw Error('Private tool changed: '+tool.name);}else writeFileSync(target,bytes,{flag:'wx'});
    if(hash(readFileSync(target))!==tool.sha256||hash(readFileSync(tool.path))!==tool.sha256)throw Error('Tool changed during private materialization: '+tool.name);
  }return directory;
}

import {readFileSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {git,gitDirectory,taskRoot,projectSchema,type Project} from './projects.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import type {DeliveryOutput} from '../shared/delivery-output.ts';
import {sourceContentMatches} from './reviewed-handoff.ts';

export function deliveryOutput(run:WorkflowRun,project:Project):DeliveryOutput|undefined{
  if(run.parentRunId||run.definition.kind!=='delivery'||!run.baseTaskId||!run.baseCandidate)return;
  const root=taskRoot({id:run.baseTaskId}),workspace=join(root,'workspace');
  if(run.artifacts.project_snapshot)project=projectSchema.parse(run.artifacts.project_snapshot);
  const projectPath=resolve(project.path);
  let projectIdentityChanged=false;try{projectIdentityChanged=realpathSync(projectPath).toLowerCase()!==projectPath.toLowerCase();}catch{projectIdentityChanged=true;}
  let files:string[]=[],sourceState:DeliveryOutput['sourceState']='unavailable';
  if(existsSync(gitDirectory(root))&&existsSync(workspace))try{
    files=git(root,['ls-tree','-r','--name-only','-z',run.baseCandidate]).split('\0').filter(Boolean);
    git(root,['diff','--quiet','--no-ext-diff','--no-textconv',run.baseCandidate,'--']);sourceState='available';
  }catch(error){sourceState=typeof error==='object'&&error!==null&&'status' in error&&error.status===1?'changed':'unavailable';}
  let projectMatches=!projectIdentityChanged&&sourceState==='available'&&files.length>0&&files.every(name=>{
    const target=resolve(projectPath,name);if(!target.startsWith(projectPath+sep))return false;
    try{let cursor=projectPath;for(const part of name.split('/')){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())return false;}if(!lstatSync(target).isFile())return false;const actual=readFileSync(target),expected=readFileSync(join(workspace,name));return actual.equals(expected)||project.delivery?.publication==='reviewed-branch'&&sourceContentMatches(project,name,actual,expected);}catch{return false;}
  });
  if(projectMatches)try{git(root,['diff','--quiet','--no-ext-diff','--no-textconv',run.baseCandidate,'--']);}catch{sourceState='changed';projectMatches=false;}
  return {workspace,projectPath,projectIdentityChanged,candidate:run.baseCandidate,files,projectMatches,sourceState,acceptancePassed:run.artifacts.acceptance_candidate===run.baseCandidate};
}

import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {verificationCommandSchema,type Project} from './projects.ts';
export const verificationPlanSchema=z.array(verificationCommandSchema).min(1).max(10);
export function verificationPlan(project:Project,root:string){
  if(project.verify.length)return project.verify;
  const file=join(root,'verification.json');
  return existsSync(file)?verificationPlanSchema.parse(JSON.parse(readFileSync(file,'utf8'))):[];
}
export function establishVerification(root:string,commands:unknown){
  const plan=verificationPlanSchema.parse(commands);
  writeFileSync(join(root,'verification.json'),JSON.stringify(plan,null,2),{flag:'wx'});
  return plan;
}

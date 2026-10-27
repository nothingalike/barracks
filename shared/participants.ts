import {z} from 'zod';
export const reviewAxisSchema=z.enum(['spec','standards']);
export type ReviewAxis=z.infer<typeof reviewAxisSchema>;
export const participantSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9_-]*$/),name:z.string().min(1),roles:z.array(z.enum(['lead','ba','builder','reviewer'])).min(1),reviewAxes:z.array(reviewAxisSchema).min(1).optional()}).strict();
export const teamSchema=z.array(participantSchema).min(1).max(32).superRefine((team,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  if(new Set(team.map(person=>person.id)).size!==team.length)issue('Participant IDs must be unique.');
  if(team.filter(person=>person.roles.includes('lead')).length!==1)issue('A configured project team has exactly one Lead authority.');
  for(const role of ['ba','builder','reviewer'] as const)if(!team.some(person=>person.roles.includes(role)))issue('The project team needs '+role+' capability.');
  const builders=team.filter(person=>person.roles.includes('builder'));if(builders.some(author=>!team.some(reviewer=>reviewer.id!==author.id&&reviewer.roles.includes('reviewer'))))issue('Every Builder needs an independent review participant.');
});
export type Participant=z.infer<typeof participantSchema>;
export function planReviewers({team,axes,author,fixed={},available}:{team:Participant[];axes:ReviewAxis[];author:string;fixed?:Partial<Record<ReviewAxis,string>>;available?:{axis:ReviewAxis;ids:Set<string>}}):Partial<Record<ReviewAxis,string>>|null{
  const required=[...new Set(axes)];
  const match=(index:number,used:Set<string>,plan:Partial<Record<ReviewAxis,string>>):Partial<Record<ReviewAxis,string>>|null=>{
    if(index===required.length)return plan;const axis=required[index]!;
    for(const person of team){if(person.id===author||used.has(person.id)||!person.roles.includes('reviewer')||(person.reviewAxes&&!person.reviewAxes.includes(axis))||(fixed[axis]&&fixed[axis]!==person.id)||(available?.axis===axis&&!available.ids.has(person.id)))continue;
      const found=match(index+1,new Set([...used,person.id]),{...plan,[axis]:person.id});if(found)return found;
    }return null;
  };return match(0,new Set(),{});
}

import {z} from 'zod';
export const evidenceKindSchema=z.enum(['command','source','unit','native','browser','physical']);
export type EvidenceKind=z.infer<typeof evidenceKindSchema>;
export const evidenceRequirementSchema=z.object({criterion:z.string().min(1),kinds:z.array(evidenceKindSchema).min(1)}).strict();
export type EvidenceRequirement=z.infer<typeof evidenceRequirementSchema>;
export interface EvidenceReceipt {
  id:string;runId:string;candidate:string;origin:'runner'|'operator';kind:EvidenceKind|'waiver'|'adjudication';
  status:'passed'|'failed'|'unverified'|'waived';createdAt:string;note:string;criterion?:string;platform?:string;
  covers?:EvidenceKind[];references?:string[];
  buildHash?:string;helperHash?:string;
  command?:{executable:string;args:string[];exitCode:number;directory:string;jobName:string};
  artifacts:{name:string;path:string;sha256:string;role?:'build'|'helper'|'capture'|'log'}[];
}
export function validateRequirements(criteria:{id:string}[],requirements:EvidenceRequirement[]|undefined,minimum:EvidenceKind[]=[]){
  return criteria.length>0&&!!requirements&&requirements.length===criteria.length&&new Set(requirements.map(item=>item.criterion)).size===criteria.length&&criteria.every(criterion=>requirements.some(item=>item.criterion===criterion.id&&item.kinds.length>0&&minimum.every(kind=>item.kinds.includes(kind))));
}

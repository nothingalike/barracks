import type {WorkflowRun} from '../shared/factory.ts';
import {evidenceRequirementSchema} from '../shared/evidence.ts';
import {EvidenceLedger} from './evidence-ledger.ts';
import {runProject} from './projects.ts';

/** Rechecked at acceptance and again immediately before canonical publication. */
export function validateRunEvidence(run:WorkflowRun,candidate:string,criteria:unknown=run.artifacts.acceptance_evidence){
  if(!run.artifacts.acceptance_requirements){
    const policy=runProject(run).delivery;if(policy?.evidencePolicy==='explicit'||policy?.requireEvidenceKinds.length)throw Error('This delivery requires a complete acceptance-evidence plan.');
    if(Array.isArray(criteria)){const waived=criteria.filter(item=>item.status==='waived');if(waived.length)new EvidenceLedger(run.id).validate(candidate,waived,[]);}
    return;
  }
  const requirements=evidenceRequirementSchema.array().min(1).parse(run.artifacts.acceptance_requirements);
  if(!Array.isArray(criteria))throw Error('Delivery has no recorded acceptance evidence.');
  const expected=(run.artifacts.acceptance_criteria as {id:string}[]).map(item=>item.id);
  if(expected.some(id=>!criteria.some(item=>item.criterion===id)))throw Error('Acceptance evidence omits a delivered criterion.');
  new EvidenceLedger(run.id).validate(candidate,criteria,requirements);
}

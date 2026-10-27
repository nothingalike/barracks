import type {WorkflowRun} from '../shared/factory.ts';
import {prepare,candidate} from './projects.ts';

export function deliveryCandidate(run:WorkflowRun){
  if(!run.baseTaskId||!run.baseCandidate)throw Error('Delivery has no accepted source candidate.');
  const context=prepare({id:run.baseTaskId,projectId:run.projectId});
  if(candidate(context.root)!==run.baseCandidate)throw Error('Delivered source changed; acceptance must inspect a newly verified and reviewed candidate.');
  return {...context,candidate:run.baseCandidate};
}

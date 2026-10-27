import type {PmtItem,WorkflowRun} from './factory.ts';
import type {Task} from './workflow.ts';
import type {AgentActivity} from './supervision.ts';
import type {TicketBoardData,TicketProgress} from './tickets.ts';
const pretty=(value:string)=>value.split(/[-_]/).map(word=>word[0]?.toUpperCase()+word.slice(1)).join(' ');

export function ticketBoard(items:PmtItem[],statuses:string[],runs:WorkflowRun[],tasks:Task[],activityFor:(id:string)=>AgentActivity|null=()=>null):TicketBoardData{
  const deliveries=runs.filter(run=>run.definition.kind==='delivery'&&!run.parentRunId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return {statuses:[...new Set([...statuses,...items.filter(item=>item.epic).map(item=>item.status)])],items:items.map(item=>{
    const run=deliveries.find(run=>run.epicId===(item.epic??item.id));
    let progress:TicketProgress|undefined;
    if(run){
      progress={runId:run.id,runStatus:run.status};
      const child=run.parallel?.ticketRuns[item.id]?runs.find(child=>child.id===run.parallel!.ticketRuns[item.id]):undefined;
      const context=child&&!run.completedTickets?.includes(item.id)?child:run;
      const state=context.definition.states?.[context.phase],task=tasks.find(task=>task.id===run.children?.[item.id]);
      const selected=run.artifacts?.ticket as {id?:string}|undefined;
      const activeTicket=!!item.epic&&(!!child||selected?.id===item.id)&&!run.completedTickets?.includes(item.id);
      const epicPhase=!!run.ticketOrder?.length&&run.ticketOrder.every(id=>run.completedTickets?.includes(id));
      const relevant=!item.epic||activeTicket||epicPhase;
      if(relevant&&!['complete','cancelled'].includes(run.status)){
        const persona=state?.persona,heading=persona?/^#\s+([^\r\n]+)/.exec(context.personaInstructions[persona]??'')?.[1]:undefined;
        const stage=child?.status==='complete'&&!run.completedTickets?.includes(item.id)?'Awaiting Lead integration':state?.label??heading??pretty(state?.role??context.phase);
        progress.stage=item.epic&&epicPhase?'Epic · '+stage:stage;
        if(context.status==='waiting'){progress.attention=context.recovery?'inspect':'waiting';progress.message=context.questions.join(' ')||context.message;}
        else if(task?.state==='blocked'){progress.attention='blocked';progress.message=task.blocker??undefined;}
        else if(task){const activity=activityFor(task.id);if(activity?.attention&&!activity.ended&&activity.lifecycle!=='recovery'){progress.attention='inspect';progress.message='No recent agent activity was observed. The assignment is still running.';}}
      }else if(run.status==='cancelled'&&task&&item.status!=='complete'){
        progress.stage='Cancelled attempt';progress.attention='inspect';progress.message='The latest delivery attempt was cancelled. The ticket status remains unchanged.';
      }
    }
    if(item.epic&&item.status!=='complete'&&!progress?.attention){
      const blockers=item.dependsOn.filter(id=>run?.parallel&&run.ticketOrder?.includes(id)?!run.completedTickets?.includes(id):items.find(other=>other.id===id)?.status!=='complete');
      if(blockers.length)progress={...progress,runId:progress?.runId??'',runStatus:progress?.runStatus??'',attention:'blocked',message:'Blocked by '+blockers.join(', ')};
    }
    return {...item,...(progress?{progress}:{})};
  })};
}

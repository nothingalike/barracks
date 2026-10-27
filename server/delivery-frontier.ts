import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import type {PmtItem} from '../shared/factory.ts';
import type {Project} from './projects.ts';
import {Pmt} from './pmt.ts';
import {sourceGrantSchema} from '../shared/source-grants.ts';
import {ticketCriteria} from '../shared/ticket-criteria.ts';

export interface DeliveryFrontier {
  projectId:string;sourcePath:string;trackerPath:string;epicId:string;
  tickets:PmtItem[];omitted:string[];blockers:string[];scope:Record<string,string>;planning?:string[];deferred?:{id:string;reason:string}[];selection?:'epic'|'explicit';
}
export function ticketScope(ticket:PmtItem){const body=ticket.body.replace(/\r\n/g,'\n').replace(/^## Work History\s*\n[\s\S]*?(?=^##\s|$(?![\s\S]))/im,'').trim();return createHash('sha256').update(JSON.stringify([ticket.id,ticket.title,ticket.epic,body,ticket.dependsOn,ticket.labels??[],ticket.priority??'normal',ticket.itemType??'story',ticket.ownedPaths,ticket.evidenceRequirements])).digest('hex');}

/** Read-only intake: selected delivery scope is independent of its containing outcome/epic. */
export function inspectDelivery(project:Project,epicId:string,ticketIds?:string[]):DeliveryFrontier{
  const blockers:string[]=[];
  const pmt=new Pmt(project);try{const validation=pmt.command(['workspace','validate']);if(validation?.valid===false)blockers.push('Tracker validation failed: '+JSON.stringify(validation.issues));}catch(error){blockers.push('Tracker validation failed: '+String(error));}
  const items=pmt.list(),catalog=items.filter(item=>item.epic===epicId);
  if(!items.some(item=>item.id===epicId&&!item.epic))blockers.push('Select an existing epic.');
  if(project.delivery?.selection==='explicit'&&!ticketIds?.length)blockers.push('Select the delivery tickets explicitly; the whole epic is not an assignment.');
  if(ticketIds&&new Set(ticketIds).size!==ticketIds.length)blockers.push('Choose each ticket once.');
  for(const id of ticketIds??[])if(!catalog.some(item=>item.id===id))blockers.push('Ticket '+id+' is not in this epic.');
  const excluded=(project.delivery?.excludeLabels??[]).map(label=>label.toLowerCase());
  const eligible=(ticket:PmtItem)=>!(ticket.labels??[]).some(label=>excluded.includes(label.toLowerCase())||(project.delivery?.excludeRollups&&/^(rollup|outcome)$/.test(label.toLowerCase())));
  const allSelected=!!ticketIds&&ticketIds.length===catalog.length&&catalog.every(ticket=>ticketIds.includes(ticket.id));
  const automatic=project.delivery?.selection!=='explicit'&&(ticketIds===undefined||allSelected),deferred:{id:string;reason:string}[]=[];
  let tickets=catalog.filter(ticket=>(!ticketIds||ticketIds.includes(ticket.id))&&eligible(ticket)&&(!automatic||ticket.status!=='complete'));
  if(automatic){
    let changed=true;while(changed){changed=false;const ids=new Set(tickets.map(ticket=>ticket.id));tickets=tickets.filter(ticket=>{const dependency=ticket.dependsOn.find(id=>!ids.has(id)&&items.find(item=>item.id===id)?.status!=='complete');if(!dependency)return true;deferred.push({id:ticket.id,reason:'Waiting for '+dependency+' outside this delivery.'});changed=true;return false;});}
  }
  for(const ticket of catalog)if(!automatic&&ticketIds?.includes(ticket.id)&&!eligible(ticket))blockers.push('Ticket '+ticket.id+' is excluded by the project delivery policy.');
  if(!tickets.length)blockers.push(automatic?(deferred.length?'Unfinished eligible tickets are waiting on dependencies outside this delivery.':'No unfinished eligible work remains in this epic.'):'No eligible delivery tickets are selected.');
  for(const ticket of tickets){if(project.delivery?.requirePathGrants&&project.delivery.selection==='explicit'&&!ticket.ownedPaths?.length)blockers.push(ticket.id+' needs explicit source ownership before assignment.');for(const path of ticket.ownedPaths??[])if(!sourceGrantSchema.safeParse(path).success)blockers.push(ticket.id+' has an invalid source ownership path.');}
  for(const ticket of tickets)if(!ticketCriteria(ticket).length)blockers.push(ticket.id+' needs explicit acceptance criteria before assignment.');
  const selected=new Set(tickets.map(ticket=>ticket.id)),visiting=new Set<string>(),visited=new Set<string>();
  const visit=(ticket:PmtItem)=>{
    if(visiting.has(ticket.id)){blockers.push('Selected dependency cycle includes '+ticket.id+'.');return;}if(visited.has(ticket.id))return;
    visiting.add(ticket.id);
    for(const id of ticket.dependsOn){const dependency=items.find(item=>item.id===id);if(selected.has(id))visit(dependency!);else if(dependency?.status!=='complete')blockers.push(ticket.id+' requires '+id+' to be complete or included in this delivery.');}
    visiting.delete(ticket.id);visited.add(ticket.id);
  };for(const ticket of tickets)visit(ticket);
  return {projectId:project.id,sourcePath:realpathSync(resolve(project.path)),trackerPath:pmt.root,epicId,tickets,omitted:catalog.filter(ticket=>!selected.has(ticket.id)).map(ticket=>ticket.id),blockers:[...new Set(blockers)],scope:Object.fromEntries(tickets.map(ticket=>[ticket.id,ticketScope(ticket)])),planning:project.delivery?.requirePathGrants?tickets.filter(ticket=>!ticket.ownedPaths?.length).map(ticket=>ticket.id):[],deferred,selection:project.delivery?.selection??'epic'};
}

export function assertFrontierCurrent(frontier:DeliveryFrontier,items:PmtItem[],ticketIds:string[]){
  for(const id of ticketIds){const current=items.find(item=>item.id===id);if(!current||ticketScope(current)!==frontier.scope[id])throw Error('Ticket '+id+' changed after delivery scope was approved. Reconcile its readiness before assigning it.');}
}

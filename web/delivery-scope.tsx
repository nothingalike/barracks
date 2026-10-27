import {useEffect,useState} from 'react';
import type {PmtItem} from '../shared/factory.ts';
import type {DeliveryFrontier} from '../server/delivery-frontier.ts';

export function DeliveryScope({projectId,epicId,items,value,onChange}:{projectId:string;epicId:string;items:PmtItem[];value:string[]|undefined;onChange:(value:string[]|undefined)=>void}){
  const [preview,setPreview]=useState<DeliveryFrontier|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(preview?.selection==='epic'&&value!==undefined)onChange(undefined);},[preview?.selection,value,onChange]);
  useEffect(()=>{setPreview(null);setError('');if(!epicId)return;const controller=new AbortController(),query=new URLSearchParams({project:projectId,epic:epicId});if(value!==undefined)query.set('scope','selected');for(const id of value??[])query.append('ticket',id);
    void fetch('/api/delivery-preview?'+query,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error??'Readiness preview unavailable.');if(!controller.signal.aborted)setPreview(body);}).catch(error=>{if(!controller.signal.aborted)setError(String(error));});return()=>controller.abort();
  },[projectId,epicId,value]);
  if(!epicId)return null;
  return <fieldset><legend>Epic delivery</legend><p className="field-help">Barracks selects eligible unfinished tickets, prepares them and follows their dependencies.</p>{preview?.selection==='explicit'&&<details open><summary>This project requires selected tickets</summary><label className="checkbox"><input type="checkbox" checked={value!==undefined} onChange={event=>onChange(event.target.checked?[]:undefined)}/>Choose specific tickets</label>
    {value!==undefined&&<div role="group" aria-label="Tickets to deliver">{items.filter(item=>item.epic===epicId).map(ticket=><label className="checkbox" key={ticket.id}><input type="checkbox" checked={value.includes(ticket.id)} onChange={event=>onChange(event.target.checked?[...value,ticket.id]:value.filter(id=>id!==ticket.id))}/>{ticket.id} · {ticket.title}</label>)}{!value.length&&<p className="field-help">Choose at least one ticket.</p>}</div>}
    </details>}{preview&&<div role="status"><p className="field-help">{preview.tickets.length} {preview.tickets.length===1?'ticket':'tickets'} to deliver · {preview.omitted.length} completed or outside this run</p>{!!preview.planning?.length&&<p className="field-help">The Lead will prepare {preview.planning.length} {preview.planning.length===1?'ticket':'tickets'} before building.</p>}{!!preview.deferred?.length&&<details><summary>{preview.deferred.length} tickets waiting on outside dependencies</summary><ul>{preview.deferred.map(ticket=><li key={ticket.id}>{ticket.id}: {ticket.reason}</li>)}</ul></details>}{preview.blockers.length>0&&<ul>{preview.blockers.map(message=><li key={message}>{message}</li>)}</ul>}</div>}
    {error&&<p className="field-help">{error}</p>}
  </fieldset>;
}

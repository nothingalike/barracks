import {useCallback,useEffect,useRef,useState} from 'react';
import type {TicketBoardData,TicketBoardItem} from '../shared/tickets.ts';
import type {WorkflowRun} from '../shared/factory.ts';
import type {HistoryEntry,Task} from '../shared/workflow.ts';
import type {AgentActivity} from '../shared/supervision.ts';
import {ticketBoard} from '../shared/ticket-progress.ts';
import './ticket-board.css';

const label=(value:string)=>value==='todo'?'To do':value.split(/[-_]/).map(word=>word[0]?.toUpperCase()+word.slice(1)).join(' ');
const attentionLabel={blocked:'Blocked',waiting:'Waiting for you',inspect:'Needs inspection'};
async function request<T>(path:string,input?:unknown):Promise<T>{const response=await fetch('/api'+path,input===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error??'Ticket request failed.');return value;}
// Existing runners can serve the rebuilt UI while their current assignments finish.
async function loadBoard(projectId:string):Promise<TicketBoardData>{
  const query='?project='+encodeURIComponent(projectId),response=await fetch('/api/ticket-board'+query);
  if(response.status!==404){const value=await response.json();if(!response.ok)throw Error(value.error??'Ticket request failed.');return value;}
  const [items,factory,snapshot]=await Promise.all([request<TicketBoardItem[]>('/tickets'+query),request<{runs:WorkflowRun[]}>('/factory'+query),request<{tasks:Task[]}>('/snapshot')]);
  const active=factory.runs.filter(run=>['queued','running','waiting'].includes(run.status));
  const details=await Promise.all(active.map(run=>request<RunDetails>('/runs/'+run.id)));
  const activities=new Map<string,AgentActivity>();
  for(const run of details)for(const child of run.childrenDetails){const activity=child.details.attempts.map(attempt=>attempt.activity).find(activity=>activity&&!activity.ended&&activity.lifecycle==='running');if(activity)activities.set(child.task.id,activity);}
  return ticketBoard(items,['backlog','todo','in-progress','complete'],factory.runs,snapshot.tasks.filter(task=>task.projectId===projectId),id=>activities.get(id)??null);
}
interface Props {projectId:string;onDiscover:()=>void;onDeliver:(epic:string)=>void;onOpenRun:(id:string)=>void;onDirtyChange:(dirty:boolean)=>void}
interface RunDetails extends WorkflowRun {childrenDetails:{ticketId:string;task:Task;history:HistoryEntry[];details:{attempts:{id:string;summary?:string;activity?:AgentActivity}[]}}[]}

function TicketDocument({body}:{body:string}){
  return <div className="ticket-document">{body.split(/\r?\n/).map((line,index)=>{
    if(!line.trim()||/^\s*<!-- barracks-run:/.test(line))return null;
    const heading=/^#{1,6}\s+(.+)$/.exec(line);if(heading)return <h3 key={index}>{heading[1]}</h3>;
    const bullet=/^\s*[-*]\s+(.*)$/.exec(line);return <p key={index} className={bullet?'document-bullet':undefined}>{bullet?'• '+bullet[1]:line}</p>;
  })}</div>;
}

function TicketDrawer({item,items,removed,projectId,onClose,onSaved,onDeliver,onOpenRun,onDirtyChange}:{item:TicketBoardItem;items:TicketBoardItem[];removed:boolean;projectId:string;onClose:()=>void;onSaved:(item:TicketBoardItem)=>void;onDeliver:(epic:string)=>void;onOpenRun:(id:string)=>void;onDirtyChange:(dirty:boolean)=>void}){
  const [base,setBase]=useState(item),[title,setTitle]=useState(item.title),[body,setBody]=useState(item.body),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[run,setRun]=useState<RunDetails|null>(null);
  const closeButton=useRef<HTMLButtonElement>(null),dirty=title!==base.title||body!==base.body,stale=item.revision!==base.revision;
  const active=!!item.progress&&['queued','running','waiting'].includes(item.progress.runStatus);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{if(stale&&!dirty){setBase(item);setTitle(item.title);setBody(item.body);}},[item,stale,dirty]);
  const close=useCallback(()=>{if(!dirty||window.confirm('Discard unsaved ticket changes?'))onClose();},[dirty,onClose]);
  useEffect(()=>{closeButton.current?.focus({preventScroll:true});},[]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!saving){event.preventDefault();close();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[close,saving]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{
    const id=item.progress?.runId;setRun(null);if(!id)return;let live=true,loading=false;
    const refresh=async()=>{if(loading)return;loading=true;try{const value=await request<RunDetails>('/runs/'+id);if(live&&value.projectId===projectId)setRun(value);}catch(failure){if(live)setError(String(failure));}finally{loading=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{live=false;clearInterval(timer);};
  },[item.progress?.runId,projectId]);
  const child=run?.childrenDetails.find(child=>child.ticketId===item.id);
  const reset=()=>{setBase(item);setTitle(item.title);setBody(item.body);setError('');};
  return <section className="ticket-drawer" role="dialog" aria-modal="false" aria-labelledby="ticket-drawer-title">
    <div className="ticket-drawer-heading"><div><p className="eyebrow">{item.epic?'TICKET':'EPIC'} / {item.id}</p><h2 id="ticket-drawer-title">{item.title}</h2></div><button ref={closeButton} type="button" aria-label="Close ticket details" disabled={saving} onClick={close}>×</button></div>
    <div className="ticket-drawer-content"><div className="ticket-facts"><span className={'ticket-status status-'+item.status}>{label(item.status)}</span>{item.progress?.stage&&<span>{item.progress.stage}</span>}{item.progress?.attention&&<span className="ticket-attention">{attentionLabel[item.progress.attention]}</span>}</div>
      {item.progress?.message&&<p className="ticket-context">{item.progress.message}</p>}
      {removed&&<p role="alert" className="error">This item is no longer available. Any unsaved draft is retained here.</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="ticket-drawer-actions"><button disabled={saving||dirty||active||removed} onClick={()=>onDeliver(item.epic??item.id)}>Deliver epic</button>{item.progress?.runId&&<button onClick={()=>onOpenRun(item.progress!.runId)}>Open workflow</button>}{!editing&&<button disabled={active||removed} onClick={()=>setEditing(true)}>Edit details</button>}</div>
      {active&&<p className="field-help">Delivery is active. Ticket edits are locked until it finishes or is cancelled.</p>}
      <dl className="ticket-dependencies"><dt>Dependencies</dt><dd>{item.dependsOn.length?item.dependsOn.map(id=>{const dependency=items.find(other=>other.id===id);return <div key={id}>{id} · {dependency?.title??'Unavailable dependency'}{dependency?' · '+label(dependency.status):''}</div>}):'None'}</dd></dl>
      {editing?<form onSubmit={event=>{event.preventDefault();setSaving(true);setError('');void request<TicketBoardItem>('/tickets',{projectId,id:item.id,title,body,revision:base.revision}).then(saved=>{setBase(saved);setTitle(saved.title);setBody(saved.body);onSaved(saved);setEditing(false);}).catch(failure=>setError(String(failure))).finally(()=>setSaving(false));}}>
        {stale&&dirty&&<p className="pause-notice">Saved content changed while you were editing. Your draft is preserved. <button type="button" onClick={()=>{if(window.confirm('Discard your draft and reload saved content?'))reset();}}>Reload saved content</button></p>}
        <label htmlFor="ticket-title">Title</label><input id="ticket-title" value={title} onChange={event=>setTitle(event.target.value)} required maxLength={160} disabled={saving||active||removed}/>
        <label htmlFor="ticket-body">Ticket / epic content</label><textarea id="ticket-body" className="ticket-body" value={body} onChange={event=>setBody(event.target.value)} required maxLength={100000} disabled={saving||active||removed}/>
        <div className="ticket-drawer-actions"><button type="submit" className="primary" disabled={saving||!dirty||stale||active||removed}>Save item</button><button type="button" disabled={saving} onClick={()=>{reset();setEditing(false);}}>Cancel editing</button></div>
      </form>:<TicketDocument body={item.body}/>}
      <details className="ticket-execution" open><summary>Execution history</summary>{child?<><p className="field-help">{label(child.task.state)} · {child.task.reviewCycles} review rounds</p><ol className="timeline">{child.history.map(entry=><li key={entry.id}><time>{new Date(entry.at).toLocaleTimeString()}</time><p>{entry.message}</p></li>)}</ol>{child.details.attempts.filter(attempt=>attempt.summary).map(attempt=><p key={attempt.id}>{attempt.summary}</p>)}</>:!item.epic&&run?<ol className="timeline">{run.handoffs.map((handoff,index)=><li key={index}><time>{new Date(handoff.at).toLocaleTimeString()}</time><p>{label(handoff.from)} → {label(handoff.to)} · {label(handoff.event)}</p></li>)}</ol>:<p>No execution has started for this item.</p>}</details>
    </div>
  </section>;
}

export function TicketBoard({projectId,onDiscover,onDeliver,onOpenRun,onDirtyChange}:Props){
  const [data,setData]=useState<TicketBoardData>({items:[],statuses:[]}),[selected,setSelected]=useState<TicketBoardItem|null>(null),[epicFilter,setEpicFilter]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const dirty=useRef(false),board=useRef<HTMLDivElement>(null),refreshing=useRef(false),mounted=useRef(false);
  const dirtyChanged=useCallback((value:boolean)=>{dirty.current=value;onDirtyChange(value);},[onDirtyChange]);
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
  const refresh=useCallback(async()=>{if(refreshing.current)return;refreshing.current=true;try{const value=await loadBoard(projectId);if(mounted.current){setData(value);setError('');}}catch(failure){if(mounted.current)setError(String(failure));}finally{refreshing.current=false;if(mounted.current)setLoading(false);}},[projectId]);
  useEffect(()=>{mounted.current=true;let live=true;const load=async()=>{if(!live)return;await refresh();};void load();const timer=setInterval(()=>void load(),3000);return()=>{mounted.current=false;live=false;clearInterval(timer);};},[refresh]);
  const close=useCallback(()=>{const id=selected?.id;setSelected(null);requestAnimationFrame(()=>{const card=Array.from(board.current?.querySelectorAll<HTMLButtonElement>('[data-ticket-id]')??[]).find(button=>button.dataset.ticketId===id);card?.focus({preventScroll:true});});},[selected?.id]);
  const select=(item:TicketBoardItem)=>{if(selected?.id===item.id)return;if(dirty.current&&!window.confirm('Discard unsaved ticket changes?'))return;setSelected(item);};
  const epics=data.items.filter(item=>!item.epic),tickets=data.items.filter(item=>!!item.epic&&(!epicFilter||item.epic===epicFilter));
  const current=selected?(data.items.find(item=>item.id===selected.id)??selected):null;
  return <section className="ticket-board" aria-label="Ticket progress board" ref={board}>
    <div className="board-toolbar"><div><h2>Tickets</h2><p>{tickets.length} tickets · Status updates automatically</p></div><div className="board-controls"><label>Epic<select value={epicFilter} onChange={event=>setEpicFilter(event.target.value)}><option value="">All epics</option>{epics.map(epic=><option key={epic.id} value={epic.id}>{epic.id} · {epic.title}</option>)}</select></label><button disabled={loading||!epicFilter} onClick={()=>onDeliver(epicFilter)}>Deliver selected epic</button><button disabled={loading} onClick={()=>void refresh()}>Refresh</button></div></div>
    {tickets.some(ticket=>ticket.status==='complete')&&<p className="field-help">Complete marks ticket reviews. Final acceptance and copying code into the project folder are tracked on the workflow. {tickets.find(ticket=>ticket.progress?.runId)?.progress?.runId&&<button onClick={()=>onOpenRun(tickets.find(ticket=>ticket.progress?.runId)!.progress!.runId)}>View delivery and source</button>}</p>}
    {error&&<p role="alert" className="error">{error} · The last loaded board is retained.</p>}
    {!!epics.length&&<div className="board-epics" aria-label="Project epics">{epics.filter(epic=>!epicFilter||epic.id===epicFilter).map(epic=><button key={epic.id} data-ticket-id={epic.id} onClick={()=>select(epic)}><span>{epic.id}</span>{epic.title}</button>)}</div>}
    {loading?<p>Loading tickets…</p>:!data.items.length?<div className="board-empty"><h3>No tickets yet.</h3><p>Complete product discovery to produce a specification, epic and tickets.</p><button onClick={onDiscover}>Start product discovery</button></div>:<div className="kanban-scroll" tabIndex={0} aria-label="Ticket status columns"><div className="kanban-columns">{data.statuses.map(status=>{const cards=tickets.filter(ticket=>ticket.status===status);return <section className={'kanban-column lane-'+status} key={status} aria-label={label(status)}><div className="kanban-heading"><h3>{label(status)}</h3><span aria-label={cards.length+' tickets'}>{cards.length}</span></div><div className="kanban-cards">{cards.map(item=><button className={'kanban-card '+(selected?.id===item.id?'selected':'')} key={item.id} data-ticket-id={item.id} aria-label={item.id+' '+item.title} onClick={()=>select(item)}><span className="card-id">{item.id}</span><strong>{item.title}</strong><span className={'ticket-status status-'+status}>{label(status)}</span>{item.progress?.stage&&<span className="card-stage">{item.progress.stage}</span>}{item.progress?.attention&&<span className="ticket-attention" title={item.progress.message}>{attentionLabel[item.progress.attention]}</span>}</button>)}{!cards.length&&<p className="lane-empty">No tickets</p>}</div></section>})}</div></div>}
    {current&&<TicketDrawer key={current.id} item={current} items={data.items} removed={!data.items.some(item=>item.id===current.id)} projectId={projectId} onClose={close} onDirtyChange={dirtyChanged} onSaved={saved=>setData(previous=>({...previous,items:previous.items.map(item=>item.id===saved.id?{...item,...saved}:item)}))} onDeliver={id=>{close();onDeliver(id);}} onOpenRun={onOpenRun}/>}
  </section>;
}

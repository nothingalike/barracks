import {useEffect,useRef,useState} from 'react';
import './project-switcher.css';

export const ALL_PROJECTS='*';
export interface ProjectOption {id:string;name:string;kind:string;taskCount:number}
export function ProjectSwitcher({projects,value,onChange,onAdd,onSettings,includeOverview=true}:{projects:ProjectOption[];value:string;onChange:(id:string)=>void;onAdd:()=>void;onSettings:()=>void;includeOverview?:boolean}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const selected=projects.find(project=>project.id===value);
  const name=selected?.name??(includeOverview?'All projects':'Select project');
  const query=search.trim().toLowerCase();
  const filtered=projects.filter(project=>`${project.name} ${project.id}`.toLowerCase().includes(query));
  const showAll=includeOverview&&(!query||'all projects'.includes(query));
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  function choose(id:string){onChange(id);setOpen(false);setSearch('');trigger.current?.focus();}
  return <div className="project-picker" ref={root} onKeyDown={event=>{
    if(event.key==='Escape'){setOpen(false);trigger.current?.focus();event.stopPropagation();}
    if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      const options=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[data-project-option]'));
      if(!options.length)return;
      event.preventDefault();
      const current=options.indexOf(document.activeElement as HTMLButtonElement);
      const index=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(current+1)%options.length:(current<=0?options.length:current)-1;
      options[index]?.focus();
    }
  }}>
    <button className="project-trigger" ref={trigger} aria-label={`Switch project: ${name}`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setSearch('');setOpen(!open);}}>
      <span className={`project-avatar ${selected?'':'overview-avatar'}`} aria-hidden="true">{selected?selected.name.slice(0,1).toUpperCase():'▦'}</span>
      <span className="project-trigger-name">{name}</span><span className="project-chevron" aria-hidden="true">⌄</span>
    </button>
    {open&&<div className="project-popover" role="dialog" aria-label="Switch project">
      <div className="project-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Find a project" autoFocus placeholder="Find a project…" value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className="project-options">
        {showAll&&<button data-project-option className="project-option overview-option" aria-pressed={value===ALL_PROJECTS} onClick={()=>choose(ALL_PROJECTS)}><span className="project-avatar overview-avatar" aria-hidden="true">▦</span><span className="project-option-text"><strong>All projects</strong><small>Workspace overview</small></span><span className="project-check" aria-hidden="true">{value===ALL_PROJECTS?'✓':''}</span></button>}
        {filtered.length>0&&<p className="project-options-label">Projects</p>}
        {filtered.map(project=><button key={project.id} data-project-option className="project-option" aria-pressed={value===project.id} onClick={()=>choose(project.id)}><span className="project-avatar" aria-hidden="true">{project.name.slice(0,1).toUpperCase()}</span><span className="project-option-text"><strong>{project.name}</strong><small>{project.kind==='fixture'?'Test project':'Local repository'} · {project.taskCount} {project.taskCount===1?'task':'tasks'}</small></span><span className="project-check" aria-hidden="true">{value===project.id?'✓':''}</span></button>)}
        {!showAll&&!filtered.length&&<p className="project-no-results">No projects match “{search}”.</p>}
      </div>
      <div className="project-menu-actions"><button onClick={()=>{setOpen(false);onAdd();}}>＋ Add Project</button>{selected&&<button onClick={()=>{setOpen(false);onSettings();}}>Project Settings</button>}</div>
      <div className="project-popover-footer">{projects.length} {projects.length===1?'project':'projects'} in this workspace</div>
    </div>}
  </div>;
}

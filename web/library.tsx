import {PersonaLibrary} from './persona-library.tsx';
import {WorkflowLibrary} from './workflow-library.tsx';
import {useCallback,useRef,useState} from 'react';
import './library.css';
export function Library({onClose,onDirtyChange}:{onClose:()=>void;onDirtyChange:(dirty:boolean)=>void}){
  const [section,setSection]=useState('Personas'),dirty=useRef(false);const changed=useCallback((value:boolean)=>{dirty.current=value;onDirtyChange(value);},[onDirtyChange]);
  return <section><div className="library-header"><div><p className="eyebrow">WORKSPACE / LIBRARY</p><h1>Library</h1><p className="muted">Shared definitions for your teams. Changes apply to new tasks; running tasks keep their saved definitions.</p></div><button onClick={onClose}>Back to project</button></div><nav className="library-tabs" aria-label="Library sections">{['Personas','Workflows'].map(name=><button key={name} aria-pressed={section===name} onClick={()=>{if(name!==section&&(!dirty.current||window.confirm('Discard unsaved Library changes?')))setSection(name);}}>{name}</button>)}</nav>{section==='Personas'?<PersonaLibrary onDirtyChange={changed}/>:<WorkflowLibrary onDirtyChange={changed}/>}</section>;
}

import {useState} from 'react';
import type {EvidenceReceipt,EvidenceRequirement} from '../shared/evidence.ts';
import type {WorkflowRun} from '../shared/factory.ts';

export function AcceptanceEvidence({run,receipts,save}:{run:WorkflowRun;receipts:EvidenceReceipt[];save:(input:unknown)=>Promise<void>}){
  const requirements=run.artifacts?.acceptance_requirements as EvidenceRequirement[]|undefined;
  const [criterion,setCriterion]=useState(''),[kind,setKind]=useState('physical'),[status,setStatus]=useState('passed'),[note,setNote]=useState(''),[platform,setPlatform]=useState(''),[build,setBuild]=useState(''),[reference,setReference]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!requirements)return null;
  const current=receipts.filter(receipt=>receipt.candidate===run.baseCandidate),builds=current.flatMap(receipt=>receipt.artifacts.filter(artifact=>artifact.role==='build'));
  return <section className="discussion-turn"><h3>Acceptance evidence</h3><p>Receipts belong to the exact source candidate. Waivers remain labeled waived; adjudication preserves the original measurement.</p>
    <ul>{requirements.map(item=><li key={item.criterion}>{item.criterion}: {item.kinds.join(', ')}</li>)}</ul>
    {current.map(receipt=><details key={receipt.id}><summary>{receipt.status} · {receipt.kind} · {receipt.criterion??'Candidate check'}</summary><p>{receipt.note}</p><code>{receipt.id}</code>{receipt.command&&<p>{receipt.command.executable} {receipt.command.args.join(' ')} · exit {receipt.command.exitCode}</p>}{receipt.artifacts.map(artifact=><p key={artifact.path}>{artifact.name} · {artifact.role??'artifact'}<br/><code>{artifact.sha256}</code></p>)}</details>)}
    {run.status==='waiting'&&run.artifacts.acceptance_criteria!==undefined&&<details><summary>Record an observation or waiver</summary><form onSubmit={event=>{event.preventDefault();setBusy(true);setError('');void save({candidate:run.baseCandidate,criterion:criterion||requirements[0]?.criterion,kind,status:kind==='waiver'?'waived':status,note,...(platform?{platform}:{}),...(build?{buildHash:build}:{}),...(kind==='adjudication'?{references:[reference],covers:current.find(receipt=>receipt.id===reference)?.kind?[current.find(receipt=>receipt.id===reference)!.kind]:[]}:{})}).then(()=>setNote('')).catch(error=>setError(String(error))).finally(()=>setBusy(false));}}>
      <label>Criterion<select required value={criterion||requirements[0]?.criterion} onChange={event=>setCriterion(event.target.value)}>{requirements.map(item=><option key={item.criterion}>{item.criterion}</option>)}</select></label>
      <label>Observation type<select value={kind} onChange={event=>setKind(event.target.value)}>{['physical','browser','native','source','unit','waiver','adjudication'].map(value=><option key={value}>{value}</option>)}</select></label>
      {kind!=='waiver'&&<label>Result<select value={status} onChange={event=>setStatus(event.target.value)}>{['passed','failed','unverified'].map(value=><option key={value}>{value}</option>)}</select></label>}
      {['physical','browser','native'].includes(kind)&&<><label>Recorded build<select required={status==='passed'} value={build} onChange={event=>setBuild(event.target.value)}><option value="">Choose a recorded build</option>{builds.map((artifact,index)=><option key={index} value={artifact.sha256}>{artifact.name} · {artifact.sha256.slice(0,12)}</option>)}</select></label><label>Platform or device<input required={status==='passed'} value={platform} onChange={event=>setPlatform(event.target.value)}/></label></>}
      {kind==='adjudication'&&<label>Original measurement<select required value={reference} onChange={event=>setReference(event.target.value)}><option value="">Choose a measurement</option>{current.filter(receipt=>!['waiver','adjudication'].includes(receipt.kind)).map(receipt=><option key={receipt.id} value={receipt.id}>{receipt.kind} · {receipt.status} · {receipt.id.slice(0,8)}</option>)}</select></label>}
      <label>Steps, observations and bounded rationale<textarea required value={note} onChange={event=>setNote(event.target.value)} maxLength={16000}/></label><button disabled={busy||!note.trim()}>Record evidence</button>{error&&<p role="alert" className="error">{error}</p>}
    </form></details>}
  </section>;
}

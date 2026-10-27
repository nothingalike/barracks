import {readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {Project} from './projects.ts';
import type {PmtItem,WorkflowRun,TicketPlan} from '../shared/factory.ts';
import {TrackerMutations} from './tracker-mutations.ts';
import {evidenceRequirementSchema} from '../shared/evidence.ts';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class Pmt {
  readonly root:string;
  constructor(project:Project){this.root=realpathSync(resolve(project.trackerPath??project.path));}
  command(args:string[],input?:unknown):any{
    if(args[0]==='init'||(['epic','story'].includes(args[0]??'')&&['create','move'].includes(args[1]??''))||(args[0]==='index'&&args[1]==='rebuild'))return this.mutate(args);
    TrackerMutations.assertReadable(this.root);return this.raw(this.root,args,input);
  }
  private raw(root:string,args:string[],input?:unknown):any{
    const cli=process.env.BARRACKS_PMT_CLI??join(process.env.ProgramFiles??'C:/Program Files','nodejs/node_modules/@basetwo/pm-toolbox/dist/tools/cli/index.js');
    if(!existsSync(cli))throw Error('PMT CLI was not found. Set BARRACKS_PMT_CLI to its installed tools/cli/index.js.');
    try{return JSON.parse(execFileSync(process.execPath,[resolve('server/pmt-host.mjs'),cli,...args,'--json'],{cwd:root,input:input===undefined?undefined:JSON.stringify(input),windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}));}
    catch(error){const detail=error as {stdout?:unknown;stderr?:unknown};throw Error('PMT '+args.slice(0,2).join(' ')+' failed: '+(String(detail.stdout??'')+String(detail.stderr??'')).slice(-32000)+' '+String(error));}
  }
  private mutations(){return new TrackerMutations(this.root,(root,args,input)=>this.raw(root,args,input));}
  private mutate(args:string[],key?:string,patches?:{path:string;before:string;content:string}[]){return this.mutations().run({args,key,patches});}
  reconcile(){this.mutations().reconcile();}
  ensure(project:Project){if(!existsSync(join(this.root,'.workspace/pm-toolbox.yml')))this.command(['init','--name',project.name,'--key','P'+project.id.replace(/[^a-z0-9]/g,'').slice(0,7).toUpperCase(),'--project-path','project','--yes']);if(!existsSync(join(this.root,'.workspace/pm-toolbox.yml')))throw Error('PMT did not initialize inside the selected project.');}
  list():PmtItem[]{
    if(!existsSync(join(this.root,'.workspace/pm-toolbox.yml')))return [];
    const items=[...this.command(['epic','list']),...this.command(['story','list'])];
    if(!items.length)return [];
    const documents=this.command(['barracks-documents'],{paths:items.map(item=>item.path)}) as {path:string;text:string;metadata:Record<string,unknown>}[];
    return items.map(item=>{const document=documents.find(document=>document.path===item.path);if(!document)throw Error('PMT document changed during catalog inspection: '+item.id);return this.read(item,document.text,document.metadata);});
  }
  statuses():string[]{
    const file=join(this.root,'.workspace/pm-toolbox.yml');if(!existsSync(file))return [];
    const lines=readFileSync(file,'utf8').split(/\r?\n/),start=lines.findIndex(line=>/^workflow:\s*(?:#.*)?$/.test(line));
    if(start<0)return [];
    for(let index=start+1;index<lines.length;index++){
      const line=lines[index]!;if(/^\S/.test(line)&&!line.startsWith('#'))break;
      const match=/^\s+states:\s*(.*)$/.exec(line);if(!match)continue;
      const inline=match[1]!.trim();
      if(inline.startsWith('[')){
        const array=inline.slice(0,inline.lastIndexOf(']')+1);
        try{const values:unknown=JSON.parse(array);return Array.isArray(values)?values.filter((value):value is string=>typeof value==='string'&&!!value):[];}catch{return array.slice(1,-1).split(',').map(value=>value.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);}
      }
      const values:string[]=[];for(let next=index+1;next<lines.length;next++){const value=/^\s+-\s+([^#]+?)\s*(?:#.*)?$/.exec(lines[next]!);if(value)values.push(value[1]!.trim().replace(/^['"]|['"]$/g,''));else if(lines[next]!.trim()&&!lines[next]!.trim().startsWith('#'))break;}return values;
    }return [];
  }
  private file(path:string){const file=realpathSync(resolve(this.root,path));if(!file.startsWith(this.root+sep))throw Error('PMT item must stay inside the project folder.');return file;}
  private read(item:{id:string;title:string;status:string;path:string},text:string,metadata:Record<string,unknown>):PmtItem{
    const body=text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''),scalar=(name:string)=>metadata[name];
    const strings=(name:string)=>{const value=scalar(name);if(value===undefined||value===null)return [];if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))throw Error('PMT '+name+' must be an array of strings: '+item.id);return value as string[];};
    const dependsOn=strings('depends_on');
    const ownership=/^## Barracks delivery\s*\r?\n+```json\s*\r?\n([\s\S]*?)\r?\n```/im.exec(body)?.[1];
    let delivery: {ownedPaths?:unknown;requirements?:unknown}={};if(ownership)try{const value=JSON.parse(ownership);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected an object.');delivery=value;}catch{throw Error('Ticket '+item.id+' has invalid Barracks delivery JSON.');}
    const owned=delivery.ownedPaths??scalar('owned_paths');if(owned!==undefined&&(!Array.isArray(owned)||owned.some(path=>typeof path!=='string')))throw Error('Ticket '+item.id+' ownedPaths must be an array of strings.');
    const evidenceRequirements=delivery.requirements===undefined?undefined:evidenceRequirementSchema.array().parse(delivery.requirements);
    return {...item,title:typeof scalar('title')==='string'?scalar('title') as string:item.title,status:typeof scalar('status')==='string'?scalar('status') as string:item.status,epic:typeof scalar('epic')==='string'?scalar('epic') as string:undefined,dependsOn,body,revision:digest(text),labels:strings('labels'),priority:typeof scalar('priority')==='string'?scalar('priority') as string:'normal',itemType:typeof scalar('type')==='string'?scalar('type') as string:'story',ownedPaths:owned as string[]|undefined,evidenceRequirements};
  }
  edit(id:string,input:{title:string;body:string;revision:string}){
    this.reconcile();
    if(!input.title.trim()||input.title.length>160||input.body.length>100000)throw Error('Provide a title and body within the item limits.');
    const item=this.list().find(item=>item.id===id);if(!item)throw Error('PMT item not found.');
    if(item.revision!==input.revision)throw Error('This item changed since you opened it. Reload it before saving.');
    const file=this.file(item.path),previous=readFileSync(file,'utf8'),header=/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(previous)?.[0];if(!header)throw Error('Invalid PMT item header.');
    this.mutate(['index','rebuild'],'edit:'+id+':'+input.revision,[{path:item.path.replaceAll('\\','/'),before:input.revision,content:header.replace(/^title:.*$/m,'title: '+JSON.stringify(input.title))+'\n'+input.body}]);
    return this.list().find(item=>item.id===id)!;
  }
  move(id:string,status:string){this.reconcile();let current=this.list().find(item=>item.id===id);if(!current)throw Error('PMT ticket no longer exists.');if(current.status===status)return;if(status==='in-progress'&&current.status==='backlog'){this.mutate(['story','move',id,'--status','todo','--notes','Epic delivery authorized by the operator','--yes'],'move:'+id+':todo:'+current.revision);current=this.list().find(item=>item.id===id)!;}this.mutate(['story','move',id,'--status',status,'--notes','Barracks epic delivery','--yes'],'move:'+id+':'+status+':'+current.revision);}
  publish(project:Project,run:WorkflowRun,plan:TicketPlan,checkpoint:()=>void){
    this.ensure(project);
    this.reconcile();
    const marker='<!-- barracks-run:'+run.id+' -->';
    let items=this.list(),epic=items.find(item=>!item.epic&&(item.id===run.outputEpicId||item.body.includes(marker)));
    if(!epic){this.mutate(['epic','create','--title',plan.epic.title,'--summary',plan.epic.description+'\n\n'+marker,'--yes'],'publish:'+run.id+':epic');epic=this.list().find(item=>!item.epic&&item.body.includes(marker));}
    if(!epic)throw Error('PMT did not return the generated epic.');
    run.outputEpicId=epic.id;checkpoint();
    const specification=run.specification??'';
    if(!epic.body.includes('## Architect specification'))this.edit(epic.id,{title:epic.title,revision:epic.revision,body:epic.body+'\n\n## Architect specification\n\n'+specification+'\n'});
    run.outputTickets??=[];
    for(const [index,ticket] of plan.tickets.entries()){
      if(ticket.dependsOn.some(dependency=>dependency>=index))throw Error('Ticket dependencies must reference earlier tickets in the proposed delivery order.');
      const ticketMarker='<!-- barracks-run:'+run.id+':ticket-'+index+' -->';
      items=this.list();let item=items.find(item=>item.epic===epic!.id&&(item.id===run.outputTickets![index]||item.body.includes(ticketMarker)));
      if(!item){this.mutate(['story','create','--title',ticket.title,'--epic',epic.id,'--summary',ticket.description+'\n\n'+ticketMarker,'--yes'],'publish:'+run.id+':ticket:'+index);item=this.list().find(item=>item.epic===epic!.id&&item.body.includes(ticketMarker));}
      if(!item)throw Error('PMT did not return the generated ticket.');
      const file=this.file(item.path),text=readFileSync(file,'utf8');
      const content=text.replace(/^depends_on:.*$/m,'depends_on: '+JSON.stringify(ticket.dependsOn.map(dependency=>run.outputTickets![dependency]))).replace('- [Define expected outcomes and restrictions]',ticket.acceptanceCriteria.map(value=>'- '+value).join('\n'));
      if(content!==text)this.mutate(['index','rebuild'],'publish:'+run.id+':ticket-details:'+index,[{path:item.path.replaceAll('\\','/'),before:digest(text),content}]);
      run.outputTickets[index]=item.id;checkpoint();
    }
    this.command(['index','rebuild']);this.command(['workspace','validate']);
  }
}

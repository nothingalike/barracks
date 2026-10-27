import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const cli=process.argv[2],args=process.argv.slice(3),root=realpathSync(process.cwd());
const config=join(root,'.workspace/pm-toolbox.yml');
let parseDocument,value;
if(args[0]==='init'){
  if(!existsSync(join(root,'.git')))throw Error('The selected project must have its own initialized Git repository before PMT setup.');
  for(const directory of ['.workspace','project']){const target=join(root,directory);if(existsSync(target)&&!realpathSync(target).startsWith(root+sep))throw Error('PMT setup directories must remain inside the selected project.');}
}else{
  if(!existsSync(config)||!realpathSync(config).startsWith(root+sep))throw Error('A project-local PMT configuration is required. Parent workspaces are never used.');
  const {parseYaml}=await import(pathToFileURL(resolve(dirname(cli),'../core/yaml.js')).href);
  parseDocument=parseYaml;value=parseYaml(readFileSync(config,'utf8'));
  for(const name of ['project','templates','adrs'])if(value.paths[name]){
    const target=resolve(root,value.paths[name]);
    if(!target.startsWith(root+sep)||(existsSync(target)&&!realpathSync(target).startsWith(root+sep)))throw Error('PMT paths must remain inside the selected project.');
  }
}
if(args[0]==='barracks-layout'){console.log(JSON.stringify({paths:value.paths,github:value.github}));process.exit(0);}
if(args[0]==='barracks-documents'){
  const request=JSON.parse(readFileSync(0,'utf8'));
  const items=request.paths.map(path=>{const file=realpathSync(resolve(root,path));if(!file.startsWith(root+sep))throw Error('PMT documents must remain inside the tracker.');const text=readFileSync(file,'utf8'),header=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);if(!header)throw Error('PMT document has no frontmatter: '+path);return {path,text,metadata:parseDocument(header[1])};});
  console.log(JSON.stringify(items));process.exit(0);
}
process.argv=[process.argv[0],cli,...args];
await import(pathToFileURL(cli).href);

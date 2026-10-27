import {spawn} from 'node:child_process';
import {appendFileSync,writeFileSync} from 'node:fs';
const [mode,file]=process.argv.slice(2);
if(mode==='root')spawn(process.execPath,[import.meta.filename,'leaf',file],{stdio:'ignore'});
writeFileSync(file+'.'+process.pid+'.pid',String(process.pid));
setInterval(()=>appendFileSync(file,`${process.pid}\n`),50);

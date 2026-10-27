import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
const script=fileURLToPath(new URL('./windows/pick-folder.ps1',import.meta.url));
let choosing=false;
export async function chooseFolder(initial:unknown){
  if(process.platform!=='win32')throw Error('The folder picker requires Windows. Paste a local folder path instead.');
  if(initial!==undefined&&(typeof initial!=='string'||initial.length>32000))throw Error('Initial folder must be a local path.');
  if(choosing)throw Error('The folder picker is already open. Select a folder or cancel that dialog.');
  choosing=true;
  try{
    const {stdout}=await execute(join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,timeout:600000,maxBuffer:128*1024,encoding:'utf8',env:{...process.env,BARRACKS_PICKER_INITIAL_FOLDER:typeof initial==='string'&&initial.trim()?resolve(initial):dirname(process.cwd())}});
    const result=JSON.parse(stdout.replace(/^\uFEFF/,''));
    if(result.path!==null&&typeof result.path!=='string')throw Error('Invalid folder selection.');
    return {path:result.path as string|null};
  }catch{throw Error('Windows could not complete the folder selection. Try Choose folder again or paste the local folder path.');}
  finally{choosing=false;}
}

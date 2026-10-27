import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
test('native folder helper compiles and configures the Explorer dialog without showing UI',{skip:process.platform!=='win32'},async()=>{
  const {stdout}=await promisify(execFile)(join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',resolve('server/windows/pick-folder.ps1'),'-ValidateOnly'],{windowsHide:true,timeout:15000,encoding:'utf8',env:{...process.env,BARRACKS_PICKER_INITIAL_FOLDER:process.cwd()}});
  assert.equal(JSON.parse(stdout.replace(/^\uFEFF/,'')).path,'configured');
});

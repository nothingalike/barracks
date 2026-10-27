import test from 'node:test';
import assert from 'node:assert/strict';
import {projectsSchema} from '../server/projects.ts';

test('assignments default to no deadline while explicit bounded deadlines remain valid',()=>{
  assert.equal(projectsSchema.parse({codexExecutable:'codex.exe',projects:[]}).attemptTimeoutMs,null);
  assert.equal(projectsSchema.parse({codexExecutable:'codex.exe',projects:[],attemptTimeoutMs:null}).attemptTimeoutMs,null);
  assert.equal(projectsSchema.parse({codexExecutable:'codex.exe',projects:[],attemptTimeoutMs:36_000_000}).attemptTimeoutMs,36_000_000);
});

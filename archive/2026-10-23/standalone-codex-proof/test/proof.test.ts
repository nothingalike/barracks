import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedChanges, CodexProofWorker } from '../server/proof-worker.ts';
test('proof refuses surrounding repositories and protected fixture edits',()=>{
  assert.throws(()=>new CodexProofWorker('.', 'unused'),/beneath/);
  assert.doesNotThrow(()=>assertAllowedChanges({'slug.mjs':'old','slug.test.mjs':'fixed'},{'slug.mjs':'new','slug.test.mjs':'fixed'},['slug.mjs']));
  assert.throws(()=>assertAllowedChanges({'slug.test.mjs':'old'},{'slug.test.mjs':'new'},['slug.mjs']),/protected/);
  assert.throws(()=>assertAllowedChanges({'README.md':'old'},{},['slug.mjs']),/protected/);
  assert.throws(()=>assertAllowedChanges({}, {'surprise.txt':'new'},['slug.mjs']),/protected/);
});

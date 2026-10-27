import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProtocolContinuation, readProtocolResult } from '../src/qualification/protocol.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';
const payload = { marker: 'fixture-123', phase: 'initial' };
const codex = [
  { type: 'thread.started', thread_id: sessionId },
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(payload) } },
  { type: 'turn.completed', usage: { input_tokens: 1 } },
];
const lines = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');

test('Codex qualification needs a completed turn, valid payload and explicit session', () => {
  assert.deepEqual(readProtocolResult('codex', lines(codex)), { sessionId, payload });
  assert.throws(() => readProtocolResult('codex', lines(codex.slice(0, 2))));
  assert.throws(() => readProtocolResult('codex', lines(codex.slice(1))));
  assert.throws(() => readProtocolResult('codex', lines([...codex, { type: 'turn.failed' }])));
  assert.throws(() => readProtocolResult('codex', 'not json'));
});

test('Claude qualification rejects errors, refusals and missing structured output', () => {
  const envelope = { type: 'result', subtype: 'success', is_error: false,
    session_id: sessionId, structured_output: payload };
  assert.deepEqual(readProtocolResult('claude', JSON.stringify(envelope)), { sessionId, payload });
  assert.throws(() => readProtocolResult('claude', JSON.stringify({ ...envelope, is_error: true })));
  assert.throws(() => readProtocolResult('claude', JSON.stringify({ ...envelope, structured_output: null })));
  assert.throws(() => readProtocolResult('claude', JSON.stringify({ ...envelope, subtype: 'error_max_budget_usd' })));
});

test('continuation must recall the marker in the original session', () => {
  const initial = { sessionId, payload: { marker: 'fixture-123', phase: 'initial' as const } };
  const resumed = { sessionId, payload: { marker: 'fixture-123', phase: 'resumed' as const } };
  assert.doesNotThrow(() => assertProtocolContinuation(initial, resumed, 'fixture-123'));
  assert.throws(() => assertProtocolContinuation(initial, { ...resumed, sessionId: 'other' }, 'fixture-123'));
  assert.throws(() => assertProtocolContinuation(initial, { ...resumed,
    payload: { marker: 'wrong', phase: 'resumed' } }, 'fixture-123'));
});

import { z } from 'zod';

const payload = z.object({
  marker: z.string().min(1),
  phase: z.enum(['initial', 'resumed']),
}).strict();

// Both installed CLIs accept this schema subset without a dialect declaration.
const { $schema: dialect, ...schema } = z.toJSONSchema(payload);
export const protocolSchema = schema;

/** Validates a deliberately tiny qualification response, not a production handoff. */
export function readProtocolResult(provider: 'codex' | 'claude', stdout: string) {
  if (provider === 'claude') {
    const envelope = z.object({
      type: z.literal('result'),
      subtype: z.literal('success'),
      is_error: z.literal(false),
      session_id: z.uuid(),
      structured_output: payload,
    }).parse(JSON.parse(stdout));
    return { sessionId: envelope.session_id, payload: envelope.structured_output };
  }
  const events: unknown[] = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const started = z.object({ type: z.literal('thread.started'), thread_id: z.uuid() });
  const completed = z.object({ type: z.literal('turn.completed') });
  const message = z.object({ type: z.literal('item.completed'), item: z.object({
    type: z.literal('agent_message'), text: z.string(),
  }) });
  let sessionId: string | undefined;
  let final: z.infer<typeof payload> | undefined;
  let finished = false;
  for (const event of events) {
    if (z.object({ type: z.enum(['error', 'turn.failed']) }).safeParse(event).success) {
      throw new Error('Codex returned an error event.');
    }
    const start = started.safeParse(event);
    if (start.success) sessionId = start.data.thread_id;
    const item = message.safeParse(event);
    if (item.success) final = payload.parse(JSON.parse(item.data.item.text));
    if (completed.safeParse(event).success) finished = true;
  }
  if (!sessionId || !final || !finished) throw new Error('Codex result lacks session, payload or completed turn.');
  return { sessionId, payload: final };
}

export function assertProtocolContinuation(
  initial: ReturnType<typeof readProtocolResult>,
  resumed: ReturnType<typeof readProtocolResult>,
  marker: string,
) {
  if (initial.sessionId !== resumed.sessionId || initial.payload.marker !== marker ||
      resumed.payload.marker !== marker || initial.payload.phase !== 'initial' ||
      resumed.payload.phase !== 'resumed') {
    throw new Error('Worker continuation did not preserve the exact session and marker.');
  }
}

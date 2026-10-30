using Stateless;

namespace Barracks;

public sealed class WorkflowEngine(RunStore store)
{
    public Run Apply(Run run, Reply reply, string actor)
    {
        var workflow = run.Definition.Workflow;
        var state = workflow.States[run.State];
        Definition.Require(!string.IsNullOrWhiteSpace(reply.Trigger) && reply.Payload is not null, "Reply requires a trigger and a payload object.");
        Definition.Require(state.Type == actor && actor is "agent" or "human", $"A {actor} reply cannot complete a {state.Type} state.");
        Definition.Require(actor == "agent" ? run.Status == "running" : run.Status == "waiting", $"State is {run.Status}; it cannot accept this reply.");
        Definition.Require(state.On.TryGetValue(reply.Trigger, out var edge), $"Trigger '{reply.Trigger}' is not allowed in {run.State}.");
        Definition.Require(reply.Payload!.Select(p => p.Key).Order().SequenceEqual(edge!.Outputs.Order()), $"Trigger '{reply.Trigger}' requires exactly these payload fields: {string.Join(", ", edge.Outputs)}.");
        foreach (var key in edge.Outputs)
            Definition.Require(Json.HasValue(reply.Payload[key]), $"Payload '{key}' must have a nonempty value.");

        var nextContext = run.Context.DeepClone().AsObject();
        foreach (var key in edge.Clear) nextContext.Remove(key);
        foreach (var (key, value) in reply.Payload) nextContext[key] = value!.DeepClone();
        Definition.SelectInputs(workflow.States[edge.Target], nextContext);

        // The JSON configures Stateless; no agent-supplied destination is accepted.
        var machine = new StateMachine<string, string>(run.State);
        foreach (var (id, configured) in workflow.States)
        {
            var config = machine.Configure(id);
            foreach (var (trigger, transition) in configured.On)
                if (transition.Target == id) config.PermitReentry(trigger);
                else config.Permit(trigger, transition.Target);
        }
        machine.Fire(reply.Trigger);
        var target = workflow.States[machine.State];
        var status = target.Type switch { "human" => "waiting", "final" => "complete", _ => "ready" };
        return store.Save(run, run with { State = machine.State, Context = nextContext, Status = status }, "transition",
            $"{run.State} --{reply.Trigger}--> {machine.State}", Json.Write(reply));
    }

    // Caller holds RunStore.Own for the entire drive, including human interaction.
    public async Task<Run> AdvanceAsync(string id, IAgent agent, CancellationToken cancellation)
    {
        var run = store.Load(id);
        Definition.Require(run.Status is "ready" or "waiting" or "complete", $"Run is {run.Status}. Explicitly resume it to retry the current state.");
        while (true)
        {
            var state = run.Definition.Workflow.States[run.State];
            if (state.Type != "agent")
            {
                var status = state.Type == "human" ? "waiting" : "complete";
                if (run.Status != status) run = store.Save(run, run with { Status = status }, status, state.Message ?? "Waiting for user input.");
                return run;
            }
            try
            {
                cancellation.ThrowIfCancellationRequested();
                var inputs = Definition.SelectInputs(state, run.Context);
                run = store.Save(run, run with { Status = "running" }, "started", $"{state.Persona} started in {run.State}.");
                var assignment = new Assignment(run.Id, run.State, state.Persona!, state.Instructions!, run.Definition.Personas[state.Persona!], run.Project, inputs, state.On, store.Decisions(run.Id));
                var reply = await agent.ExecuteAsync(assignment, text => store.Record(run, text), cancellation);
                cancellation.ThrowIfCancellationRequested();
                run = Apply(run, reply, "agent");
            }
            catch (OperationCanceledException)
            {
                store.Save(run, run with { Status = "interrupted" }, "interrupted", "Execution stopped. Explicit resume retries this read-only state.");
                throw;
            }
            catch (Exception ex)
            {
                store.Save(run, run with { Status = "failed" }, "failed", ex.Message);
                throw;
            }
        }
    }

    public Run Resume(Run run)
    {
        if (run.Status is "failed" or "interrupted" or "running")
            return store.Save(run, run with { Status = "ready" }, "resumed", "Explicit resume requested; current read-only state will be retried.");
        return run;
    }
}
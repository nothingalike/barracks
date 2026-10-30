using Spectre.Console;
using Spectre.Console.Rendering;
using System.Text.Json.Nodes;

namespace Barracks;

public sealed class Terminal(RunStore store, IAnsiConsole console)
{
    public static string PersonaColor(string? persona) => persona switch
    {
        "product-owner" => "yellow",
        "architect" => "cyan",
        "project-manager" => "green",
        "lead" => "blue",
        "ba" => "teal",
        "builder" => "orange1",
        "reviewer" => "magenta",
        "acceptance-tester" => "lime",
        "retrospective-analyst" => "purple",
        _ => "grey"
    };

    public IRenderable Dashboard(Run run)
    {
        var events = store.Events(run.Id, 30);
        var (visited, started) = store.Telemetry(run);
        var states = new Table().Border(TableBorder.Simple).AddColumn("State").AddColumn("Persona").AddColumn("Status");
        foreach (var (id, s) in run.Definition.Workflow.States)
        {
            var current = id == run.State;
            states.AddRow(new Text((current ? "> " : "  ") + id, current ? new Style(Color.White, decoration: Decoration.Bold) : Style.Plain),
                new Markup($"[{PersonaColor(s.Persona)}]{Markup.Escape(s.Persona ?? s.Type)}[/]"),
                new Text(current ? run.Status.ToUpperInvariant() : visited.Contains(id) ? "visited" : "pending",
                    current ? Style.Parse(run.Status switch { "running" => "cyan", "waiting" => "yellow", "failed" => "red", "complete" => "green", _ => "grey" }) : Style.Plain));
        }
        var state = run.Definition.Workflow.States[run.State];
        var age = started is null || run.Status != "running" ? "" : $"\nAssignment elapsed: {(DateTimeOffset.UtcNow - DateTimeOffset.Parse(started)).TotalSeconds:F0}s";
        var last = events.LastOrDefault();
        var lastAge = last is null ? "" : $"\nLast activity: {(DateTimeOffset.UtcNow - DateTimeOffset.Parse(last.At)).TotalSeconds:F0}s ago";
        if (console.Profile.Width < 110 || console.Profile.Height < 35)
        {
            var flow = string.Join(" -> ", run.Definition.Workflow.States
                .Where(p => !p.Key.StartsWith("await_", StringComparison.Ordinal))
                .Select(p => $"[{PersonaColor(p.Value.Persona)}]{(p.Key == run.State ? "[bold]> " : "")}{Markup.Escape(p.Key)}{(p.Key == run.State ? "[/]" : "")}[/]"));
            var status = run.Status switch { "running" => "cyan", "waiting" => "yellow", "failed" => "red", "complete" => "green", _ => "grey" };
            var lines = events.TakeLast(4).Select(e =>
            {
                var text = $"{DateTimeOffset.Parse(e.At).ToLocalTime():HH:mm:ss} {e.Message}";
                var width = Math.Max(20, console.Profile.Width - 2);
                return text.Length > width ? text[..(width - 1)] + "…" : text;
            });
            return new Rows(new Rule("Barracks · " + Markup.Escape(run.Definition.Workflow.Name)),
                new Text("Run " + run.Id), new Panel(new Markup(flow)).Header("Workflow"),
                new Markup($"[{PersonaColor(state.Persona)}]{Markup.Escape(state.Persona ?? state.Type)}[/] · {Markup.Escape(run.State)} · [{status}]{run.Status.ToUpperInvariant()}[/]"),
                new Text((age + lastAge).Trim()),
                new Text("Allowed: " + string.Join(" | ", state.On.Select(p => p.Key + " -> " + p.Value.Target))),
                new Rule("Recent activity"), new Text(string.Join('\n', lines)),
                new Text("Ctrl+C stops current work and saves the run."));
        }
        var currentPanel = new Panel(new Text($"State: {run.State}\nPersona: {state.Persona ?? state.Type}\nStatus: {run.Status}{age}{lastAge}"))
            .Header("Current assignment").BorderStyle(Style.Parse(PersonaColor(state.Persona)));
        var routes = new Panel(new Text(string.Join('\n', state.On.Select(p => $"{p.Key} -> {p.Value.Target}")))).Header("Allowed transitions");
        var activity = new Panel(new Text(string.Join('\n', events.TakeLast(5).Select(e => $"{DateTimeOffset.Parse(e.At).ToLocalTime():HH:mm:ss} {e.Message}")))).Header("Recent activity");
        return new Rows(new Rule(Markup.Escape($"Barracks · {run.Definition.Workflow.Name}")), new Text($"Run {run.Id} · {run.Project}"),
            new Columns(new Panel(states).Header("Workflow"), new Rows(currentPanel, routes, activity)));
    }

    public async Task DriveAsync(string id, IAgent agent, bool interactive, CancellationToken cancellation)
    {
        try { await DriveCoreAsync(id, agent, interactive, cancellation); }
        catch
        {
            console.Write(Dashboard(store.Load(id)));
            throw;
        }
    }

    private async Task DriveCoreAsync(string id, IAgent agent, bool interactive, CancellationToken cancellation)
    {
        var engine = new WorkflowEngine(store);
        while (true)
        {
            Run run;
            if (console.Profile.Capabilities.Interactive)
            {
                Run? result = null;
                await console.Live(Dashboard(store.Load(id))).AutoClear(true).StartAsync(async live =>
                {
                    var work = engine.AdvanceAsync(id, agent, cancellation);
                    while (!work.IsCompleted)
                    {
                        live.UpdateTarget(Dashboard(store.Load(id)));
                        await Task.WhenAny(work, Task.Delay(400, CancellationToken.None));
                    }
                    result = await work;
                });
                run = result!;
            }
            else
            {
                console.WriteLine($"Advancing run {id}; activity is persisted in SQLite.");
                run = await engine.AdvanceAsync(id, agent, cancellation);
            }
            console.Write(Dashboard(run));
            var state = run.Definition.Workflow.States[run.State];
            if (state.Type == "final") { console.WriteLine(state.Message!); return; }
            console.Write(new Panel(new Text(state.Instructions!)).Header("Your input"));
            foreach (var (key, value) in Definition.SelectInputs(state, run.Context))
                console.Write(new Panel(new Text(DisplayInput(value!))).Header(Markup.Escape(key)));
            if (!interactive || !console.Profile.Capabilities.Interactive)
            {
                console.WriteLine($"Waiting. Use 'resume {id}' interactively, or 'signal {id} --trigger <trigger> --payload <json-file>' then resume.");
                return;
            }
            var trigger = console.Prompt(new SelectionPrompt<string>().Title("Choose an outcome").AddChoices(state.On.Keys.Append("Leave waiting")));
            if (trigger == "Leave waiting") return;
            var payload = new JsonObject();
            foreach (var key in state.On[trigger].Outputs)
            {
                var value = console.Prompt(new TextPrompt<string>($"{Markup.Escape(key)} (text, or @path to a UTF-8 text/JSON file):").Validate(t => string.IsNullOrWhiteSpace(t) ? ValidationResult.Error("A value is required.") : ValidationResult.Success()));
                if (value.StartsWith('@'))
                {
                    var contents = File.ReadAllText(value[1..]);
                    try { payload[key] = JsonNode.Parse(contents); }
                    catch (System.Text.Json.JsonException) { payload[key] = contents; }
                }
                else payload[key] = value;
            }
            engine.Apply(run, new Reply(trigger, payload), "human");
        }
    }

    public static string DisplayInput(JsonNode value) => value switch
    {
        JsonValue v when v.TryGetValue<string>(out var text) => text,
        JsonArray a when a.All(n => n is JsonValue v && v.TryGetValue<string>(out _)) => string.Join('\n', a.Select(n => "- " + n!.GetValue<string>())),
        _ => value.ToJsonString(Json.Options)
    };
}
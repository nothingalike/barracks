using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Barracks;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true
    };

    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Read<T>(string text) => JsonSerializer.Deserialize<T>(text, Options)
        ?? throw new InvalidOperationException($"Expected {typeof(T).Name} JSON.");
    public static bool HasValue(JsonNode? value) => value switch
    {
        null => false,
        JsonArray a => a.Count > 0,
        JsonObject o => o.Count > 0,
        JsonValue v when v.TryGetValue<string>(out var text) => !string.IsNullOrWhiteSpace(text),
        _ => true
    };
}

public sealed record Workflow
{
    public int SchemaVersion { get; init; }
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Description { get; init; } = "";
    public string[] Inputs { get; init; } = [];
    public string Initial { get; init; } = "";
    public Dictionary<string, WorkflowState> States { get; init; } = [];
}

public sealed record WorkflowState
{
    public string Type { get; init; } = "";
    public string? Persona { get; init; }
    public string? Instructions { get; init; }
    public string[] Inputs { get; init; } = [];
    public string[] OptionalInputs { get; init; } = [];
    public Dictionary<string, Transition> On { get; init; } = [];
    public string? Message { get; init; }
}

public sealed record Transition
{
    public string Target { get; init; } = "";
    public string[] Outputs { get; init; } = [];
    public string[] Clear { get; init; } = [];
}

public sealed record Definition(Workflow Workflow, Dictionary<string, string> Personas)
{
    public static Definition Load(string root, string id)
    {
        if (!Regex.IsMatch(id, "^[a-z][a-z0-9-]*$"))
            throw new InvalidOperationException("Workflow must be a configured ID, such as grilling.");
        var workflow = Json.Read<Workflow>(File.ReadAllText(Path.Combine(root, "config", "workflows", id + ".json")));
        var personas = new Dictionary<string, string>();
        foreach (var persona in workflow.States.Values.Select(s => s.Persona).OfType<string>().Distinct())
        {
            if (!Regex.IsMatch(persona, "^[a-z][a-z0-9-]*$"))
                throw new InvalidOperationException($"Invalid persona ID: {persona}.");
            personas[persona] = File.ReadAllText(Path.Combine(root, "config", "personas", persona + ".md"));
        }
        var definition = new Definition(workflow, personas);
        definition.Validate();
        return definition;
    }

    public void Validate()
    {
        var w = Workflow;
        Require(w.SchemaVersion == 3, "Workflow schemaVersion must be 3.");
        Require(w.States.ContainsKey(w.Initial), "Workflow initial state does not exist.");
        foreach (var (id, state) in w.States)
        {
            Require(state.Type is "agent" or "human" or "final", $"{id}: unsupported type {state.Type}.");
            Require(state.Inputs.Distinct().Count() == state.Inputs.Length, $"{id}: repeated inputs.");
            Require(!state.Inputs.Intersect(state.OptionalInputs).Any(), $"{id}: input is both required and optional.");
            if (state.Type == "agent")
                Require(state.Persona is not null && Personas.TryGetValue(state.Persona, out var p) && !string.IsNullOrWhiteSpace(p), $"{id}: persona is missing.");
            if (state.Type == "final")
                Require(state.On.Count == 0 && !string.IsNullOrWhiteSpace(state.Message), $"{id}: final state needs a message and no transitions.");
            else
                Require(state.On.Count > 0 && !string.IsNullOrWhiteSpace(state.Instructions), $"{id}: instructions and transitions are required.");
            foreach (var (trigger, edge) in state.On)
            {
                Require(!string.IsNullOrWhiteSpace(trigger) && w.States.ContainsKey(edge.Target), $"{id}/{trigger}: target does not exist.");
                Require(edge.Outputs.Distinct().Count() == edge.Outputs.Length, $"{id}/{trigger}: repeated outputs.");
                Require(!edge.Clear.Intersect(edge.Outputs).Any(), $"{id}/{trigger}: clears its own outputs.");
                Require(!edge.Clear.Concat(edge.Outputs).Intersect(w.Inputs).Any(), $"{id}/{trigger}: changes launch inputs.");
            }
        }
        var visited = new HashSet<string>();
        void Visit(string id) { if (visited.Add(id)) foreach (var e in w.States[id].On.Values) Visit(e.Target); }
        Visit(w.Initial);
        Require(visited.Count == w.States.Count, "Workflow has unreachable states.");
        var finish = w.States.Where(p => p.Value.Type == "final").Select(p => p.Key).ToHashSet();
        while (true)
        {
            var count = finish.Count;
            foreach (var (id, state) in w.States)
                if (state.On.Values.Any(e => finish.Contains(e.Target))) finish.Add(id);
            if (count == finish.Count) break;
        }
        Require(finish.Count == w.States.Count, "Some states cannot reach a final state.");
    }

    public static void Require([DoesNotReturnIf(false)] bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    public static JsonObject SelectInputs(WorkflowState state, JsonObject context)
    {
        foreach (var key in state.Inputs)
            Require(context.ContainsKey(key) && Json.HasValue(context[key]), $"Required input '{key}' is missing or empty.");
        var inputs = new JsonObject();
        foreach (var key in state.Inputs.Concat(state.OptionalInputs).Distinct())
            if (context.ContainsKey(key)) inputs[key] = context[key]?.DeepClone();
        return inputs;
    }
}

public sealed record Reply([property: JsonRequired] string Trigger, [property: JsonRequired] JsonObject Payload);
public sealed record Run(string Id, Definition Definition, string Project, string State, string Status, JsonObject Context, long Version);
public sealed record Activity(long Sequence, string At, string Kind, string State, string Message);
public sealed record Assignment(string RunId, string State, string Persona, string Instructions, string PersonaInstructions,
    string Project, JsonObject Inputs, Dictionary<string, Transition> Allowed, JsonArray Decisions);

public interface IAgent
{
    Task<Reply> ExecuteAsync(Assignment assignment, Action<string> activity, CancellationToken cancellation);
}
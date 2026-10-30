using Spectre.Console;
using Spectre.Console.Cli;
using System.ComponentModel;
using System.Text.Json.Nodes;

namespace Barracks;

public class CommonSettings : CommandSettings
{
    [CommandOption("--root <PATH>"), Description("Barracks folder containing config/workflows and config/personas.")]
    public string? Root { get; init; }
    [CommandOption("--database <PATH>"), Description("SQLite path; defaults to <root>/.state/barracks.db.")]
    public string? Database { get; init; }
    public string FindRoot()
    {
        if (Root is not null) return Path.GetFullPath(Root);
        var directory = new DirectoryInfo(Environment.CurrentDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "config", "workflows"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new InvalidOperationException("Barracks config was not found. Pass --root with the Barracks repository path.");
    }
    public RunStore Store() => new(Database ?? Path.Combine(FindRoot(), ".state", "barracks.db"));
}

public class ExecutionSettings : CommonSettings
{
    [CommandOption("--codex <PATH>"), Description("Native Codex executable. Defaults to BARRACKS_CODEX or local discovery.")]
    public string? Codex { get; init; }
    [CommandOption("--non-interactive"), Description("Stop at human states; accept answers later through signal or resume.")]
    public bool NonInteractive { get; init; }
    public IAgent Agent() => new CodexAgent(CodexAgent.FindExecutable(Codex), Path.Combine(FindRoot(), ".state", "attempts"));
}

public sealed class RunSettings : ExecutionSettings
{
    [CommandOption("--workflow <ID>"), Description("Workflow ID. The first runner supports grilling.")]
    public string Workflow { get; init; } = "grilling";
    [CommandOption("--project <PATH>"), Description("Project folder to inspect read-only.")]
    public string Project { get; init; } = "";
    [CommandOption("--task <TEXT>"), Description("The idea or problem to explore.")]
    public string Task { get; init; } = "";
    public override ValidationResult Validate() => string.IsNullOrWhiteSpace(Task) || !Directory.Exists(Project)
        ? ValidationResult.Error("Supply --task and --project with an existing project directory.")
        : Workflow != "grilling" ? ValidationResult.Error("The first read-only runner supports --workflow grilling. Delivery execution is deferred.") : ValidationResult.Success();
}

public sealed class RunCommand : AsyncCommand<RunSettings>
{
    public override async Task<int> ExecuteAsync(CommandContext context, RunSettings settings, CancellationToken cancellation)
    {
        var definition = Definition.Load(settings.FindRoot(), settings.Workflow);
        var agent = settings.Agent();
        var store = settings.Store();
        var project = Path.GetFullPath(settings.Project);
        var run = store.Create(definition, project, new JsonObject { ["task"] = settings.Task, ["project"] = project });
        AnsiConsole.WriteLine("Run: " + run.Id);
        using var owner = store.Own(run.Id);
        await new Terminal(store, AnsiConsole.Console).DriveAsync(run.Id, agent, !settings.NonInteractive, cancellation);
        return 0;
    }
}

public sealed class ResumeSettings : ExecutionSettings
{
    [CommandArgument(0, "<RUN-ID>")]
    public string RunId { get; init; } = "";
}

public sealed class ResumeCommand : AsyncCommand<ResumeSettings>
{
    public override async Task<int> ExecuteAsync(CommandContext context, ResumeSettings settings, CancellationToken cancellation)
    {
        var store = settings.Store();
        using var owner = store.Own(settings.RunId);
        var run = store.Load(settings.RunId);
        Definition.Require(run.Definition.Workflow.Id == "grilling", "This runner resumes grilling runs only.");
        var agent = settings.Agent();
        new WorkflowEngine(store).Resume(run);
        await new Terminal(store, AnsiConsole.Console).DriveAsync(run.Id, agent, !settings.NonInteractive, cancellation);
        return 0;
    }
}

public sealed class SignalSettings : CommonSettings
{
    [CommandArgument(0, "<RUN-ID>")]
    public string RunId { get; init; } = "";
    [CommandOption("--trigger <TRIGGER>")]
    public string Trigger { get; init; } = "";
    [CommandOption("--payload <FILE>"), Description("UTF-8 JSON object with exactly the transition's output keys.")]
    public string Payload { get; init; } = "";
    public override ValidationResult Validate() => string.IsNullOrWhiteSpace(Trigger) || !File.Exists(Payload)
        ? ValidationResult.Error("Supply --trigger and --payload with an existing JSON file.") : ValidationResult.Success();
}

public sealed class SignalCommand : Command<SignalSettings>
{
    public override int Execute(CommandContext context, SignalSettings settings, CancellationToken cancellation)
    {
        var store = settings.Store();
        using var owner = store.Own(settings.RunId);
        var run = store.Load(settings.RunId);
        var payload = JsonNode.Parse(File.ReadAllText(settings.Payload))?.AsObject() ?? throw new InvalidOperationException("Payload must be a JSON object.");
        var next = new WorkflowEngine(store).Apply(run, new Reply(settings.Trigger, payload), "human");
        AnsiConsole.WriteLine($"{run.State} --{settings.Trigger}--> {next.State}. Saved. Use resume {run.Id} to continue.");
        return 0;
    }
}

public sealed class ShowSettings : CommonSettings
{
    [CommandArgument(0, "<RUN-ID>")]
    public string RunId { get; init; } = "";
    [CommandOption("--json")]
    public bool AsJson { get; init; }
}

public sealed class ShowCommand : Command<ShowSettings>
{
    public override int Execute(CommandContext context, ShowSettings settings, CancellationToken cancellation)
    {
        var store = settings.Store();
        var run = store.Load(settings.RunId);
        if (settings.AsJson) System.Console.WriteLine(Json.Write(new { run.Id, run.State, run.Status, run.Version, run.Context, events = store.Events(run.Id) }));
        else
        {
            AnsiConsole.Write(new Terminal(store, AnsiConsole.Console).Dashboard(run));
            foreach (var (key, value) in Definition.SelectInputs(run.Definition.Workflow.States[run.State], run.Context))
                AnsiConsole.Write(new Panel(new Text(Terminal.DisplayInput(value!))).Header(Markup.Escape(key)));
        }
        return 0;
    }
}

public sealed class ValidateCommand : Command<CommonSettings>
{
    public override int Execute(CommandContext context, CommonSettings settings, CancellationToken cancellation)
    {
        foreach (var file in Directory.GetFiles(Path.Combine(settings.FindRoot(), "config", "workflows"), "*.json"))
        {
            var definition = Definition.Load(settings.FindRoot(), Path.GetFileNameWithoutExtension(file));
            AnsiConsole.WriteLine($"Valid: {definition.Workflow.Id} ({definition.Workflow.States.Count} states)");
        }
        return 0;
    }
}
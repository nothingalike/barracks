using Barracks;
using Spectre.Console;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Barracks.Tests;

public sealed class WorkflowTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "Barracks-tests-" + Guid.NewGuid().ToString("N"));
    private readonly string root = FindRoot();
    private RunStore Store => new(Path.Combine(directory, "runs.db"));
    private Run Create()
    {
        var definition = Definition.Load(root, "grilling");
        return Store.Create(definition, directory, new JsonObject { ["task"] = "A reading list", ["project"] = directory });
    }
    private static Reply Reply(string trigger, string payload) => new(trigger, JsonNode.Parse(payload)!.AsObject());

    [Fact]
    public void AllConfiguredGraphsLoadAndPersonaFilesAreSnapshotted()
    {
        foreach (var path in Directory.GetFiles(Path.Combine(root, "config", "workflows"), "*.json"))
            Definition.Load(root, Path.GetFileNameWithoutExtension(path)).Validate();
        var run = Create();
        var original = run.Definition.Personas["product-owner"];
        run.Definition.Personas["product-owner"] = "changed only in memory";
        Assert.Equal(original, Store.Load(run.Id).Definition.Personas["product-owner"]);
    }

    [Fact]
    public async Task QuestionSurvivesReopenAnswerReturnsToSameAgentAndHandoffStopsAtSpecReview()
    {
        var run = Create();
        using var owner = Store.Own(run.Id);
        var first = await new WorkflowEngine(Store).AdvanceAsync(run.Id, new Fake(a =>
        {
            Assert.Equal("develop_brief", a.State);
            return Reply("needs_user", "{\"questions\":[\"SQLite or JSON?\"]}");
        }), default);
        Assert.Equal("waiting", first.Status);
        var reopened = Store.Load(run.Id);
        Assert.Equal("await_develop_brief", reopened.State);
        var engine = new WorkflowEngine(Store);
        engine.Apply(reopened, Reply("answered", "{\"answers\":\"SQLite\"}"), "human");
        var result = await engine.AdvanceAsync(run.Id, new Fake(a => a.State switch
        {
            "develop_brief" => Brief(a),
            "challenge" => Reply("brief_agreed", "{\"technical_decisions\":\"SQLite storage\"}"),
            "specify" => Reply("specification_ready", "{\"specification\":\"Title and read flag, persisted in SQLite.\"}"),
            _ => throw new InvalidOperationException("Unexpected assignment")
        }), default);
        Assert.Equal("review_specification", result.State);
        Assert.Equal("waiting", result.Status);
        Assert.False(result.Context.ContainsKey("specification_approval"));
        Assert.False(result.Context.ContainsKey("questions"));
        Assert.Contains(Store.Events(run.Id), e => e.Message.Contains("brief_ready--> challenge"));
    }

    private static Reply Brief(Assignment a)
    {
        Assert.Equal("SQLite", a.Inputs["answers"]!.GetValue<string>());
        Assert.Contains("# Product Owner", a.PersonaInstructions);
        return Reply("brief_ready", "{\"brief\":\"A SQLite reading list\"}");
    }

    [Theory]
    [InlineData("invented", "{}")]
    [InlineData("brief_ready", "{\"brief\":\"ok\",\"specification_approval\":true}")]
    [InlineData("brief_ready", "{\"brief\":\" \"}")]
    [InlineData("needs_user", "{\"questions\":[]}")]
    public async Task InvalidAgentReplyPreservesStateAndContextAndStopsWithoutRetry(string trigger, string payload)
    {
        var run = Create();
        using var owner = Store.Own(run.Id);
        var calls = 0;
        await Assert.ThrowsAsync<InvalidOperationException>(() => new WorkflowEngine(Store).AdvanceAsync(run.Id, new Fake(_ =>
        {
            calls++;
            return Reply(trigger, payload);
        }), default));
        var saved = Store.Load(run.Id);
        Assert.Equal(1, calls);
        Assert.Equal("failed", saved.Status);
        Assert.Equal(run.State, saved.State);
        Assert.True(JsonNode.DeepEquals(run.Context, saved.Context));
        Assert.DoesNotContain(Store.Events(run.Id), e => e.Kind == "transition");
    }

    [Fact]
    public async Task HumanCannotEmitAnAgentOutcomeAndDuplicateRepliesDoNotAdvance()
    {
        var run = Create();
        var engine = new WorkflowEngine(Store);
        Assert.Throws<InvalidOperationException>(() => engine.Apply(run, Reply("brief_ready", "{\"brief\":\"injected\"}"), "human"));
        var waiting = await engine.AdvanceAsync(run.Id, new Fake(_ => Reply("needs_user", "{\"questions\":[\"Scope?\"]}")), default);
        engine.Apply(waiting, Reply("answered", "{\"answers\":\"Small\"}"), "human");
        Assert.Throws<InvalidOperationException>(() => engine.Apply(waiting, Reply("answered", "{\"answers\":\"duplicate\"}"), "human"));
        Assert.Equal("Small", Store.Load(run.Id).Context["answers"]!.GetValue<string>());
    }

    [Fact]
    public void OnlyOneLocalOwnerCanDriveARunAndOwnershipIsReleased()
    {
        var run = Create();
        using (Store.Own(run.Id)) Assert.Throws<InvalidOperationException>(() => Store.Own(run.Id));
        using var nextOwner = Store.Own(run.Id);
        Assert.NotNull(nextOwner);
    }

    [Fact]
    public async Task CancellationIsPersistedAndExplicitResumeRetriesOnlyCurrentState()
    {
        var run = Create();
        var engine = new WorkflowEngine(Store);
        using var cancellation = new CancellationTokenSource();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var work = engine.AdvanceAsync(run.Id, new Blocking(started), cancellation.Token);
        await started.Task;
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => work);
        var interrupted = Store.Load(run.Id);
        Assert.Equal("interrupted", interrupted.Status);
        Assert.Equal("develop_brief", interrupted.State);
        await Assert.ThrowsAsync<InvalidOperationException>(() => engine.AdvanceAsync(run.Id, new Fake(_ => throw new Exception()), default));
        engine.Resume(interrupted);
        var resumed = await engine.AdvanceAsync(run.Id, new Fake(_ => Reply("needs_user", "{\"questions\":[\"Continue?\"]}")), default);
        Assert.Equal("waiting", resumed.Status);
    }

    [Fact]
    public void RevisionClearsDownstreamApprovalsButPreservesExecutionHistory()
    {
        var run = Create();
        var context = run.Context.DeepClone().AsObject();
        foreach (var key in new[] { "specification", "specification_approval", "ticket_plan", "ticket_approval", "epic", "tickets" }) context[key] = "stale";
        run = Store.Save(run, run with { Context = context, Status = "running" }, "started", "Fixture assignment");
        var next = new WorkflowEngine(Store).Apply(run, Reply("brief_ready", "{\"brief\":\"A revised brief\"}"), "agent");
        Assert.Equal("challenge", next.State);
        Assert.False(next.Context.ContainsKey("ticket_approval"));
        Assert.False(next.Context.ContainsKey("specification"));
        Assert.Contains(Store.Events(run.Id), e => e.Message == "Fixture assignment");
    }

    [Fact]
    public async Task FullGrillingRequiresEveryHumanGateAndPublicationReferences()
    {
        var run = Create();
        var engine = new WorkflowEngine(Store);
        var fake = new Fake(a => a.State switch
        {
            "develop_brief" => Reply("brief_ready", "{\"brief\":\"A reading list\"}"),
            "challenge" => Reply("brief_agreed", "{\"technical_decisions\":\"Local SQLite\"}"),
            "specify" => Reply("specification_ready", "{\"specification\":\"Read and write titles\"}"),
            "create_tickets" => Reply("tickets_ready", "{\"ticket_plan\":{\"epic\":{\"title\":\"Reading list\"},\"tickets\":[{\"title\":\"Add titles\"}]},\"ticket_breakdown\":\"One vertical slice\"}"),
            _ => throw new InvalidOperationException("Unexpected assignment")
        });
        run = await engine.AdvanceAsync(run.Id, fake, default);
        Assert.Equal("review_specification", run.State);
        engine.Apply(run, Reply("approved", "{\"specification_approval\":\"Approved in test\"}"), "human");
        run = await engine.AdvanceAsync(run.Id, fake, default);
        Assert.Equal("review_tickets", run.State);
        run = engine.Apply(run, Reply("approved", "{\"ticket_approval\":\"Approved in test\"}"), "human");
        Assert.Equal("publish_tickets", run.State);
        Assert.Equal("waiting", run.Status);
        Assert.Throws<InvalidOperationException>(() => engine.Apply(run, Reply("published", "{}"), "human"));
        run = engine.Apply(run, Reply("published", "{\"epic\":\"TEST-EPIC\",\"tickets\":[\"TEST-001\"]}"), "human");
        Assert.Equal("complete", run.Status);
        Assert.Equal("complete", Store.Load(run.Id).State);
    }

    [Fact]
    public void ReplyEnvelopeRejectsMissingFieldsAndAgentChosenDestinations()
    {
        Assert.Throws<JsonException>(() => Barracks.Json.Read<Reply>("{\"trigger\":\"brief_ready\"}"));
        Assert.Throws<JsonException>(() => Barracks.Json.Read<Reply>("{\"trigger\":\"brief_ready\",\"payload\":{},\"target\":\"complete\"}"));
    }

    [Fact]
    public async Task MultipleQuestionRoundsPreserveEarlierUserDecisions()
    {
        var run = Create();
        var engine = new WorkflowEngine(Store);
        run = await engine.AdvanceAsync(run.Id, new Fake(_ => Reply("needs_user", "{\"questions\":[\"Storage?\"]}")), default);
        engine.Apply(run, Reply("answered", "{\"answers\":\"SQLite\"}"), "human");
        run = await engine.AdvanceAsync(run.Id, new Fake(_ => Reply("needs_user", "{\"questions\":[\"Interface?\"]}")), default);
        engine.Apply(run, Reply("answered", "{\"answers\":\"CLI\"}"), "human");
        await engine.AdvanceAsync(run.Id, new Fake(a =>
        {
            Assert.Contains("SQLite", a.Decisions.ToJsonString());
            Assert.Contains("CLI", a.Decisions.ToJsonString());
            Assert.Contains("Storage?", a.Decisions.ToJsonString());
            return Reply("needs_user", "{\"questions\":[\"One final decision?\"]}");
        }), default);
    }

    [Fact]
    public void DashboardEscapesAgentMarkupAndShowsCurrentStateAndAllowedRoutes()
    {
        var run = Create();
        Store.Record(run, "[red]literal project text[/]");
        using var writer = new StringWriter();
        var console = AnsiConsole.Create(new AnsiConsoleSettings { Out = new AnsiConsoleOutput(writer), Ansi = AnsiSupport.No, ColorSystem = ColorSystemSupport.NoColors, Interactive = InteractionSupport.No });
        console.Profile.Width = 120;
        console.Write(new Terminal(Store, console).Dashboard(run));
        var rendered = writer.ToString();
        Assert.Contains("develop_brief", rendered);
        Assert.Contains("brief_ready -> challenge", rendered);
        Assert.Contains("[red]literal project text[/]", rendered);
    }

    private sealed class Fake(Func<Assignment, Reply> reply) : IAgent
    {
        public Task<Reply> ExecuteAsync(Assignment a, Action<string> activity, CancellationToken cancellation)
        {
            activity("Observed activity from test agent");
            return Task.FromResult(reply(a));
        }
    }
    private sealed class Blocking(TaskCompletionSource started) : IAgent
    {
        public async Task<Reply> ExecuteAsync(Assignment a, Action<string> activity, CancellationToken cancellation)
        {
            started.SetResult();
            await Task.Delay(Timeout.Infinite, cancellation);
            throw new InvalidOperationException();
        }
    }
    private static string FindRoot()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !Directory.Exists(Path.Combine(d.FullName, "config", "workflows"))) d = d.Parent;
        return d?.FullName ?? throw new InvalidOperationException("Tests must run from this checkout.");
    }
    public void Dispose()
    {
        if (!Directory.Exists(directory)) return;
        var resolved = Path.GetFullPath(directory);
        Assert.Equal(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar), Path.GetDirectoryName(resolved));
        Assert.StartsWith("Barracks-tests-", Path.GetFileName(resolved));
        Directory.Delete(resolved, recursive: true);
    }
}
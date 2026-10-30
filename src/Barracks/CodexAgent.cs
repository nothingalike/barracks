using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Barracks;

public sealed class CodexAgent(string executable, string attemptsDirectory) : IAgent
{
    public static string FindExecutable(string? configured)
    {
        var path = configured ?? Environment.GetEnvironmentVariable("BARRACKS_CODEX");
        if (!string.IsNullOrWhiteSpace(path))
        {
            Definition.Require(File.Exists(path) && (!OperatingSystem.IsWindows() || path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)), "--codex must name an existing native Codex executable.");
            return Path.GetFullPath(path);
        }
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var candidate = Path.Combine(directory, OperatingSystem.IsWindows() ? "codex.exe" : "codex");
            if (File.Exists(candidate)) return candidate;
        }
        var releases = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex", "packages", "app-server-daemon", "releases");
        if (Directory.Exists(releases))
        {
            var candidates = Directory.GetDirectories(releases)
                .OrderByDescending(p => Version.TryParse(Path.GetFileName(p).Split('-')[0], out var v) ? v : new Version())
                .Select(p => Path.Combine(p, "bin", OperatingSystem.IsWindows() ? "codex.exe" : "codex"));
            foreach (var candidate in candidates) if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("Codex was not found. Pass --codex with the full path to its native executable, or set BARRACKS_CODEX.");
    }

    public async Task<Reply> ExecuteAsync(Assignment assignment, Action<string> activity, CancellationToken cancellation)
    {
        var directory = Path.Combine(attemptsDirectory, assignment.RunId, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var schema = Path.Combine(directory, "schema.json");
        var replyPath = Path.Combine(directory, "reply.json");
        await File.WriteAllTextAsync(schema, Json.Write(ResponseSchema(assignment)), cancellation);
        var prompt = $"""
            Execute one Barracks state, read-only in the supplied project.
            Apply the persona and state instructions to the supplied inputs.
            Barracks owns scheduling and transitions. Return one allowed trigger and its declared payload.
            Route user decisions through needs_user with concrete questions and recommended answers.
            Resolve factual questions from local evidence. Preserve settled decisions and user answers.
            Authorized scope is read-only discovery. Keep other agents, external services and project files unchanged.
            Return questions as an array of strings and ticket_plan as the specified JSON object.

            Persona: {assignment.Persona}
            {assignment.PersonaInstructions}
            State: {assignment.State}
            {assignment.Instructions}
            Inputs:
            {Json.Write(assignment.Inputs)}
            Recorded questions, answers and review decisions, in chronological order:
            {Json.Write(assignment.Decisions)}
            Allowed outcomes (trigger: required payload keys):
            {string.Join('\n', assignment.Allowed.Select(p => p.Key + ": " + string.Join(", ", p.Value.Outputs)))}
            """;
        await File.WriteAllTextAsync(Path.Combine(directory, "prompt.txt"), prompt, cancellation);
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = assignment.Project,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        string[] arguments = ["--no-daemon", "exec", "--ignore-user-config", "--disable", "multi_agent", "--disable", "multi_agent_v2",
            "--sandbox", "read-only", "-c", "approval_policy=\"never\"", "--skip-git-repo-check", "--json", "--output-schema", schema,
            "--output-last-message", replyPath, "-C", assignment.Project, "-"];
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        if (OperatingSystem.IsWindows())
        {
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add("windows.sandbox=\"elevated\"");
        }
        using var process = new Process { StartInfo = start };
        Definition.Require(process.Start(), "Codex could not be started.");
        using var stop = cancellation.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        });
        await using var output = new StreamWriter(Path.Combine(directory, "events.jsonl"));
        await using var errors = new StreamWriter(Path.Combine(directory, "stderr.log"));
        var stdout = PumpAsync(process.StandardOutput, output, line => { var summary = Summarize(line); if (summary is not null) activity(summary); });
        var stderr = PumpAsync(process.StandardError, errors, _ => { });
        try
        {
            await process.StandardInput.WriteAsync(prompt.AsMemory(), cancellation);
            process.StandardInput.Close();
            var streams = Task.WhenAll(stdout, stderr);
            var exited = process.WaitForExitAsync(cancellation);
            if (await Task.WhenAny(exited, streams) == streams) await streams;
            await exited;
            await streams;
            cancellation.ThrowIfCancellationRequested();
            Definition.Require(process.ExitCode == 0, $"Codex exited with code {process.ExitCode}. Inspect {Path.Combine(directory, "stderr.log")} and explicitly resume after resolving it.");
            Definition.Require(File.Exists(replyPath), $"Codex produced no final reply. Inspect {directory}.");
            return Json.Read<Reply>(await File.ReadAllTextAsync(replyPath, cancellation));
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(stdout, stderr);
        }
    }

    private static async Task PumpAsync(StreamReader reader, StreamWriter writer, Action<string> receive)
    {
        while (await reader.ReadLineAsync() is { } line)
        {
            await writer.WriteLineAsync(line);
            await writer.FlushAsync();
            receive(line);
        }
    }

    public static string? Summarize(string line)
    {
        JsonObject? e;
        try { e = JsonNode.Parse(line)?.AsObject(); }
        catch (System.Text.Json.JsonException) { return null; }
        if (e is null) return null;
        var type = e["type"]?.GetValue<string>();
        if (type == "thread.started") return "Codex session " + e["thread_id"];
        if (type is "turn.started" or "turn.completed" or "turn.failed" or "error") return type + (e["message"] is null ? "" : ": " + e["message"]);
        if (e["item"] is not JsonObject item) return null;
        var itemType = item["type"]?.GetValue<string>();
        if (itemType == "reasoning") return null;
        var detail = itemType switch
        {
            "command_execution" => $"{item["command"]} [{item["status"]}; exit {item["exit_code"]}]",
            "agent_message" => item["text"]?.ToString(),
            "mcp_tool_call" => item["tool"]?.ToString(),
            _ => itemType
        };
        var text = $"{type}: {detail}".ReplaceLineEndings(" ");
        return text.Length > 350 ? text[..350] + "…" : text;
    }

    private static object ResponseSchema(Assignment assignment)
    {
        object Shape(string key) => key switch
        {
            "questions" => new { type = "array", items = new { type = "string" } },
            "ticket_plan" => new
            {
                type = "object",
                additionalProperties = false,
                required = new[] { "epic", "tickets" },
                properties = new
                {
                    epic = new { type = "object", additionalProperties = false, required = new[] { "title", "description" }, properties = new { title = new { type = "string" }, description = new { type = "string" } } },
                    tickets = new { type = "array", items = new { type = "object", additionalProperties = false, required = new[] { "title", "description", "acceptanceCriteria", "dependsOn" }, properties = new { title = new { type = "string" }, description = new { type = "string" }, acceptanceCriteria = new { type = "array", items = new { type = "string" } }, dependsOn = new { type = "array", items = new { type = "integer" } } } } }
                }
            },
            _ => new { type = "string" }
        };
        var variants = assignment.Allowed.Values.Select(t => new
        {
            type = "object",
            additionalProperties = false,
            required = t.Outputs,
            properties = t.Outputs.ToDictionary(k => k, Shape)
        }).ToArray();
        return new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "trigger", "payload" },
            properties = new { trigger = new { type = "string", @enum = assignment.Allowed.Keys.ToArray() }, payload = new { anyOf = variants } }
        };
    }
}
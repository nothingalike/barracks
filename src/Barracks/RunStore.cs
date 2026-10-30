using Microsoft.Data.Sqlite;
using System.Text.Json.Nodes;

namespace Barracks;

public sealed class RunStore
{
    private readonly string database;
    private readonly object gate = new();

    public RunStore(string database)
    {
        this.database = Path.GetFullPath(database);
        Directory.CreateDirectory(Path.GetDirectoryName(this.database)!);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, definition TEXT NOT NULL, project TEXT NOT NULL,
                state TEXT NOT NULL, status TEXT NOT NULL, context TEXT NOT NULL, version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                at TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
                data TEXT);
            CREATE INDEX IF NOT EXISTS events_run ON events(run_id, sequence);
            """;
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = database, DefaultTimeout = 5, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    // One local owner per run, automatically released by the OS on exit or crash.
    public FileStream Own(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidOperationException("Run ID must be the 32-character ID printed by Barracks.");
        try { return new FileStream(database + "." + id + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException ex) { throw new InvalidOperationException($"Run {id} is already owned by another Barracks process.", ex); }
    }

    public Run Create(Definition definition, string project, JsonObject context)
    {
        definition.Validate();
        foreach (var input in definition.Workflow.Inputs)
            Definition.Require(Json.HasValue(context[input]), $"Launch input '{input}' is required.");
        Definition.SelectInputs(definition.Workflow.States[definition.Workflow.Initial], context);
        var run = new Run(Guid.NewGuid().ToString("N"), definition, project, definition.Workflow.Initial, "ready", context.DeepClone().AsObject(), 0);
        lock (gate)
        {
            using var c = Open();
            using var tx = c.BeginTransaction();
            using var command = c.CreateCommand();
            command.Transaction = tx;
            command.CommandText = "INSERT INTO runs VALUES ($id,$definition,$project,$state,$status,$context,$version)";
            Bind(command, run);
            command.ExecuteNonQuery();
            InsertEvent(c, tx, run, "created", "Run created; workflow and persona instructions snapshotted.", null);
            tx.Commit();
        }
        return run;
    }

    public Run Load(string id)
    {
        lock (gate)
        {
            using var c = Open();
            using var command = c.CreateCommand();
            command.CommandText = "SELECT definition,project,state,status,context,version FROM runs WHERE id=$id";
            command.Parameters.AddWithValue("$id", id);
            using var reader = command.ExecuteReader();
            if (!reader.Read()) throw new InvalidOperationException($"Run {id} was not found in {database}.");
            return new Run(id, Json.Read<Definition>(reader.GetString(0)), reader.GetString(1), reader.GetString(2), reader.GetString(3), JsonNode.Parse(reader.GetString(4))!.AsObject(), reader.GetInt64(5));
        }
    }

    public Run Save(Run before, Run after, string kind, string message, string? data = null)
    {
        lock (gate)
        {
            var next = after with { Version = before.Version + 1 };
            using var c = Open();
            using var tx = c.BeginTransaction();
            using var command = c.CreateCommand();
            command.Transaction = tx;
            command.CommandText = "UPDATE runs SET state=$state,status=$status,context=$context,version=$version WHERE id=$id AND version=$previous";
            command.Parameters.AddWithValue("$id", before.Id);
            command.Parameters.AddWithValue("$state", next.State);
            command.Parameters.AddWithValue("$status", next.Status);
            command.Parameters.AddWithValue("$context", Json.Write(next.Context));
            command.Parameters.AddWithValue("$version", next.Version);
            command.Parameters.AddWithValue("$previous", before.Version);
            if (command.ExecuteNonQuery() != 1) throw new InvalidOperationException("Run changed since this assignment started; reply was not applied.");
            InsertEvent(c, tx, next, kind, message, data);
            tx.Commit();
            return next;
        }
    }

    public void Record(Run run, string message)
    {
        lock (gate)
        {
            using var c = Open();
            InsertEvent(c, null, run, "activity", message, null);
        }
    }

    public IReadOnlyList<Activity> Events(string id, int count = 100)
    {
        lock (gate)
        {
            using var c = Open();
            using var command = c.CreateCommand();
            command.CommandText = "SELECT sequence,at,kind,state,message FROM events WHERE run_id=$id ORDER BY sequence DESC LIMIT $count";
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$count", count);
            using var reader = command.ExecuteReader();
            var result = new List<Activity>();
            while (reader.Read()) result.Add(new Activity(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)));
            result.Reverse();
            return result;
        }
    }

    public (HashSet<string> Visited, string? Started) Telemetry(Run run)
    {
        lock (gate)
        {
            using var c = Open();
            using var command = c.CreateCommand();
            command.CommandText = "SELECT DISTINCT state FROM events WHERE run_id=$id";
            command.Parameters.AddWithValue("$id", run.Id);
            var visited = new HashSet<string>();
            using (var reader = command.ExecuteReader()) while (reader.Read()) visited.Add(reader.GetString(0));
            command.CommandText = "SELECT at FROM events WHERE run_id=$id AND state=$state AND kind='started' ORDER BY sequence DESC LIMIT 1";
            command.Parameters.AddWithValue("$state", run.State);
            return (visited, command.ExecuteScalar() as string);
        }
    }

    public JsonArray Decisions(string id)
    {
        lock (gate)
        {
            using var c = Open();
            using var command = c.CreateCommand();
            command.CommandText = "SELECT state,data FROM events WHERE run_id=$id AND kind='transition' ORDER BY sequence";
            command.Parameters.AddWithValue("$id", id);
            using var reader = command.ExecuteReader();
            var decisions = new JsonArray();
            while (reader.Read())
            {
                var reply = Json.Read<Reply>(reader.GetString(1));
                if (reply.Trigger is "needs_user" or "answered" or "approved" or "changes")
                    decisions.Add(new JsonObject { ["state"] = reader.GetString(0), ["trigger"] = reply.Trigger, ["payload"] = reply.Payload.DeepClone() });
            }
            return decisions;
        }
    }

    private static void Bind(SqliteCommand c, Run r)
    {
        c.Parameters.AddWithValue("$id", r.Id);
        c.Parameters.AddWithValue("$definition", Json.Write(r.Definition));
        c.Parameters.AddWithValue("$project", r.Project);
        c.Parameters.AddWithValue("$state", r.State);
        c.Parameters.AddWithValue("$status", r.Status);
        c.Parameters.AddWithValue("$context", Json.Write(r.Context));
        c.Parameters.AddWithValue("$version", r.Version);
    }

    private static void InsertEvent(SqliteConnection c, SqliteTransaction? tx, Run run, string kind, string message, string? data)
    {
        using var command = c.CreateCommand();
        command.Transaction = tx;
        command.CommandText = "INSERT INTO events(run_id,at,kind,state,message,data) VALUES($id,$at,$kind,$state,$message,$data)";
        command.Parameters.AddWithValue("$id", run.Id);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$kind", kind);
        command.Parameters.AddWithValue("$state", run.State);
        command.Parameters.AddWithValue("$message", message);
        command.Parameters.AddWithValue("$data", (object?)data ?? DBNull.Value);
        command.ExecuteNonQuery();
    }
}
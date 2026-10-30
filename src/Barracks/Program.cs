using Barracks;
using Spectre.Console;
using Spectre.Console.Cli;

var app = new CommandApp();
using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; shutdown.Cancel(); };
app.Configure(config =>
{
    config.SetApplicationName("barracks");
    config.PropagateExceptions();
    config.AddCommand<RunCommand>("run").WithDescription("Start grilling with a live terminal display.");
    config.AddCommand<ResumeCommand>("resume").WithDescription("Continue a saved run or explicitly retry interrupted read-only work.");
    config.AddCommand<SignalCommand>("signal").WithDescription("Submit an allowed human trigger and payload.");
    config.AddCommand<ShowCommand>("show").WithDescription("Show a saved run and its activity.");
    config.AddCommand<ValidateCommand>("validate").WithDescription("Validate workflows without starting agents.");
});
try { return await app.RunAsync(args, shutdown.Token); }
catch (OperationCanceledException) { AnsiConsole.MarkupLine("[yellow]Stopped. The run is saved; use resume to continue.[/]"); return 130; }
catch (Exception ex) { AnsiConsole.Write(new Text("Error: " + ex.Message, new Style(Color.Red))); AnsiConsole.WriteLine(); return 1; }
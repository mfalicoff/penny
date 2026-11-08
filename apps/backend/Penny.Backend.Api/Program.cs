using Penny.Backend.Api;
using Penny.Backend.Persistence;
using Scalar.AspNetCore;

var migrating = args.FirstOrDefault() == "migrate";
var builder = WebApplication.CreateBuilder(migrating ? args.Skip(1).ToArray() : args);
if (migrating)
{
    var settings = DatabaseSettings.Create(
        builder.Configuration.GetConnectionString("Migration"),
        maxPoolSize: 1
    );
    await using var source = settings.CreateDataSource();
    using var stopping = new CancellationTokenSource();
    Console.CancelKeyPress += (_, signal) =>
    {
        signal.Cancel = true;
        stopping.Cancel();
    };
    try
    {
        await DatabaseMigrator.ApplyAsync(source, stopping.Token);
        Console.WriteLine("Database foundation migration complete (schema 1).");
        return 0;
    }
    catch (Exception error)
        when (error
                is Npgsql.NpgsqlException
                    or TimeoutException
                    or OperationCanceledException
                    or InvalidOperationException
        )
    {
        Console.Error.WriteLine(
            "Database migration failed. Check connectivity, PostgreSQL 18/pg_trgm, schema compatibility, migration-role privileges and the migration lock. No credentials are logged."
        );
        return 1;
    }
}

builder.Services.AddControllers();
builder.AddBackendServices();
var app = builder.Build();
app.UseMiddleware<ApiBoundaryMiddleware>();
app.UseRouting();
app.UseRequestTimeouts();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}
app.MapControllers();
await app.RunAsync();
return 0;

public partial class Program;

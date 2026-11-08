using Penny.Backend.Api.Commands;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Middleware;
using Scalar.AspNetCore;

var maintenance = args.FirstOrDefault() is "migrate" or "snapshot-sqlite" or "import-sqlite";
var builder = WebApplication.CreateBuilder(maintenance ? [] : args);
if (maintenance)
    return await MaintenanceCommand.RunAsync(args, builder.Configuration);

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

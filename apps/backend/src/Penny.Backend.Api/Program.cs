using Penny.Backend.Api.Commands;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Middleware;
using Scalar.AspNetCore;

var maintenance =
    args.FirstOrDefault()
    is "migrate"
        or "snapshot-sqlite"
        or "import-sqlite"
        or PasswordResetCommand.Name;
var builder = WebApplication.CreateBuilder(maintenance ? [] : args);
if (args.FirstOrDefault() == PasswordResetCommand.Name)
    return await PasswordResetCommand.RunAsync(args, builder.Configuration);
if (maintenance)
    return await MaintenanceCommand.RunAsync(args, builder.Configuration);

builder.Services.AddControllers();
builder.AddBackendServices();
var app = builder.Build();
app.UseForwardedHeaders();
app.UseMiddleware<ApiBoundaryMiddleware>();
app.UseRouting();
app.UseRequestTimeouts();

// Origin check first: CORS would answer a disallowed preflight itself, while the
// legacy server refused it with 403.
app.UseMiddleware<OriginPolicyMiddleware>();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}
app.MapControllers();
await app.RunAsync();
return 0;

public partial class Program;

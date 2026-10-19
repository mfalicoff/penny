using Penny.Backend.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.AddBackendServices();

var app = builder.Build();
app.UseBackendMiddleware();
app.MapControllers();
app.Run();

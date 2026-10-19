using Penny.Backend.Application;

namespace Penny.Backend.Api;

public sealed class ApiPolicyMiddleware(RequestDelegate next, BackendOptions options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        if (context.Request.ContentLength > options.MaxRequestBodyBytes)
        {
            await ApiErrors.WriteAsync(context, 413, "The upload is too large.");
            return;
        }

        await next(context);
        if (!context.Response.HasStarted && context.Response.StatusCode >= 400)
        {
            await ApiErrors.WriteAsync(
                context,
                context.Response.StatusCode,
                context.Response.StatusCode == 404
                    ? "API route not found."
                    : "The server could not complete this request."
            );
        }
    }
}

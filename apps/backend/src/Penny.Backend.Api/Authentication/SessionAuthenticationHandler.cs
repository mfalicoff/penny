using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Penny.Backend.Api.Errors;
using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.Authentication;

public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AuthService auth
) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // Public routes (health, info, login...) never touch session storage, so
        // liveness and sign-in do not depend on a presented token.
        if (Context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            return AuthenticateResult.NoResult();
        var session = await auth.AuthenticateAsync(
            SessionCredentials.Read(Request),
            Context.RequestAborted
        );
        return session is null
            ? AuthenticateResult.NoResult()
            : AuthenticateResult.Success(
                new AuthenticationTicket(SessionAuthentication.ToPrincipal(session), Scheme.Name)
            );
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties) =>
        ApiErrors.WriteAsync(Context, 401, AuthService.SignInRequired);
}

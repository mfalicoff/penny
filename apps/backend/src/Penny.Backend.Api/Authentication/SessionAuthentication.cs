using System.Security.Claims;
using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.Authentication;

public static class SessionAuthentication
{
    public const string Scheme = "PennySession";
    public const string UserIdClaim = "penny:user";
    public const string TokenHashClaim = "penny:session";

    public static ClaimsPrincipal ToPrincipal(AuthenticatedSession session) =>
        new(
            new ClaimsIdentity(
                [new(UserIdClaim, session.UserId), new(TokenHashClaim, session.TokenHash)],
                Scheme
            )
        );

    // Only valid on endpoints that require the session scheme.
    public static AuthenticatedSession Session(this ClaimsPrincipal user) =>
        new(
            user.FindFirstValue(UserIdClaim)
                ?? throw new InvalidOperationException("Authenticated route is missing a session."),
            user.FindFirstValue(TokenHashClaim)
                ?? throw new InvalidOperationException("Authenticated route is missing a session.")
        );
}

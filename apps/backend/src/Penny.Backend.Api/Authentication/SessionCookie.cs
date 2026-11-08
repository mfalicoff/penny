using Penny.Backend.Application.Authentication;

namespace Penny.Backend.Api.Authentication;

// Web clients use the HttpOnly cookie; native clients use the returned bearer token.
public static class SessionCookie
{
    public static void Append(HttpResponse response, string token, bool secure, TimeProvider clock)
    {
        var options = Options(secure);
        options.MaxAge = SessionTokens.Lifetime;
        options.Expires = clock.GetUtcNow() + SessionTokens.Lifetime;
        response.Cookies.Append(SessionCredentials.CookieName, token, options);
    }

    public static void Clear(HttpResponse response, bool secure) =>
        response.Cookies.Delete(SessionCredentials.CookieName, Options(secure));

    private static CookieOptions Options(bool secure) =>
        new()
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = "/api",
        };
}

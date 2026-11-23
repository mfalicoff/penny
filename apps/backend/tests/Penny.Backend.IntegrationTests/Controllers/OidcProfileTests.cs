using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Profiles;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Provider-managed names and pictures (MAZ-171): read only, refreshed at each sign-in,
// the picture copied to Penny once per URL. A provider that sends nothing leaves the field
// to the person.
public sealed class OidcProfileTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    [Fact]
    public async Task whenProviderSendsName_OidcSignIn_ShouldStoreReadOnlyNameAndRefreshIt()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);
        var token = await SignInTokenAsync(client, Grant(new() { ["name"] = "Grace Hopper" }));

        var profile = await ProfileAsync(client, token);
        profile.GetProperty("displayName").GetString().ShouldBe("Grace Hopper");
        profile.GetProperty("nameEditable").GetBoolean().ShouldBeFalse();
        profile.GetProperty("needsName").GetBoolean().ShouldBeFalse();
        profile.GetProperty("signIn").GetString().ShouldBe("oidc");
        profile.GetProperty("provider").GetString().ShouldBe("Synthetic SSO");
        // The provider said the email is verified (MAZ-172).
        profile.GetProperty("emailVerified").GetBoolean().ShouldBeTrue();

        // The API refuses a change, and the name stays.
        using (var change = await PatchAsync(client, token, new { displayName = "Someone" }))
            await AuthTests.ShouldBeErrorAsync(
                change,
                HttpStatusCode.Forbidden,
                ProfileService.NameManaged
            );
        using (var clear = await PatchAsync(client, token, new { displayName = (string?)null }))
            clear.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // The provider renames the person: the next sign-in brings the new name.
        token = await SignInTokenAsync(client, Grant(new() { ["name"] = "Rear Admiral Hopper" }));
        (await ProfileAsync(client, token))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Rear Admiral Hopper");
    }

    [Fact]
    public async Task whenProviderSendsGivenAndFamilyName_OidcSignIn_ShouldJoinThem()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);

        var token = await SignInTokenAsync(
            client,
            Grant(new() { ["given_name"] = " Katherine\t", ["family_name"] = "Johnson" })
        );

        (await ProfileAsync(client, token))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Katherine Johnson");
    }

    [Fact]
    public async Task whenProviderNameTooLong_OidcSignIn_ShouldCutItToSixtyCharacters()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);

        var token = await SignInTokenAsync(
            client,
            Grant(new() { ["name"] = new string('n', 59) + "😀 tail" })
        );

        // Cut before the emoji rather than through its surrogate pair.
        (await ProfileAsync(client, token))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe(new string('n', 59));
    }

    [Fact]
    public async Task whenProviderSendsProfileOnlyInUserInfo_OidcSignIn_ShouldReadIt()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);

        var token = await SignInTokenAsync(
            client,
            new FakeOidcGrant
            {
                UserInfoClaims = new Dictionary<string, object?> { ["name"] = "Dorothy Vaughan" },
            }
        );

        (await ProfileAsync(client, token))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Dorothy Vaughan");
    }

    [Fact]
    public async Task whenProviderSendsNoName_OidcSignIn_ShouldLetThePersonSetOne()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);
        var token = await SignInTokenAsync(client, new FakeOidcGrant());

        var profile = await ProfileAsync(client, token);
        profile.TryGetProperty("displayName", out _).ShouldBeFalse();
        profile.GetProperty("nameEditable").GetBoolean().ShouldBeTrue();
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeTrue();
        profile.GetProperty("needsName").GetBoolean().ShouldBeTrue();
        using (var set = await PatchAsync(client, token, new { displayName = "Mary Jackson" }))
            set.StatusCode.ShouldBe(HttpStatusCode.OK);

        // A later sign-in that still sends no name keeps the person's own.
        token = await SignInTokenAsync(client, new FakeOidcGrant());
        var after = await ProfileAsync(client, token);
        after.GetProperty("displayName").GetString().ShouldBe("Mary Jackson");
        after.GetProperty("nameEditable").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task whenProviderSendsPicture_OidcSignIn_ShouldCopyItOnceAndKeepItReadOnly()
    {
        Provider.Picture = ProfileImages.Png();
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);
        var grant = Grant(new() { ["picture"] = FakeOidcProvider.PictureUrl });
        var token = await SignInTokenAsync(client, grant);

        var profile = await ProfileAsync(client, token);
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeFalse();
        var url = profile.GetProperty("avatarUrl").GetString()!;
        // Penny serves its own copy; the provider's URL never reaches clients.
        url.ShouldStartWith("/api/users/");
        profile.GetRawText().ShouldNotContain(FakeOidcProvider.Issuer + "/picture");
        using (var picture = await GetAsync(client, token, url))
        {
            picture.StatusCode.ShouldBe(HttpStatusCode.OK);
            picture.Content.Headers.ContentType!.MediaType.ShouldBe("image/webp");
        }
        Provider.PictureRequests.ShouldBe(1);

        // Read only: upload and removal are refused.
        using (var upload = await UploadAsync(client, token, SyntheticReceipts.Png(64, 64)))
            await AuthTests.ShouldBeErrorAsync(
                upload,
                HttpStatusCode.Forbidden,
                ProfileService.AvatarManaged
            );
        using (
            var remove = await SendAsync(client, token, HttpMethod.Delete, "/api/profile/avatar")
        )
            await AuthTests.ShouldBeErrorAsync(
                remove,
                HttpStatusCode.Forbidden,
                ProfileService.AvatarManaged
            );

        // The same URL at the next sign-in is not downloaded again.
        token = await SignInTokenAsync(client, grant);
        Provider.PictureRequests.ShouldBe(1);
        (await ProfileAsync(client, token)).GetProperty("avatarUrl").GetString().ShouldBe(url);

        // A new URL (the person changed their picture) is copied again.
        token = await SignInTokenAsync(
            client,
            Grant(new() { ["picture"] = FakeOidcProvider.Issuer + "/picture/2.png" })
        );
        Provider.PictureRequests.ShouldBe(2);
        (await ProfileAsync(client, token)).GetProperty("avatarUrl").GetString().ShouldNotBe(url);
    }

    [Fact]
    public async Task whenProviderPictureUnavailable_OidcSignIn_ShouldStillSignIn()
    {
        // Provider.Picture is null: the picture URL answers 404.
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);

        var token = await SignInTokenAsync(
            client,
            Grant(new() { ["picture"] = FakeOidcProvider.PictureUrl })
        );

        var profile = await ProfileAsync(client, token);
        profile.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeFalse();
        Provider.PictureRequests.ShouldBe(1);
    }

    [Theory]
    [InlineData("http://issuer.example.test/picture/1.png")]
    [InlineData("not a url")]
    public async Task whenProviderPictureNotHttps_OidcSignIn_ShouldIgnoreIt(string picture)
    {
        Provider.Picture = ProfileImages.Png();
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);

        var token = await SignInTokenAsync(client, Grant(new() { ["picture"] = picture }));

        var profile = await ProfileAsync(client, token);
        profile.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeTrue();
        Provider.PictureRequests.ShouldBe(0);
    }

    [Fact]
    public async Task whenAccountSignsInWithProvider_ChangePassword_ShouldReturnForbidden()
    {
        await using var api = Provider.CreateApi(Fixture.Connection);
        using var client = CreateClient(api);
        var token = await SignInTokenAsync(client, new FakeOidcGrant());

        using var response = await SendAsync(
            client,
            token,
            HttpMethod.Post,
            "/api/auth/password",
            JsonContent.Create(new { currentPassword = "", newPassword = "a brand new password" })
        );

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.Forbidden,
            AuthService.NoPassword
        );
        (await ProfileAsync(client, token))
            .TryGetProperty("passwordChangedAt", out _)
            .ShouldBeFalse();
    }

    private static FakeOidcGrant Grant(Dictionary<string, object?> claims) =>
        new() { Claims = claims };

    private async Task<string> SignInTokenAsync(HttpClient client, FakeOidcGrant grant)
    {
        using var response = await SignInAsync(client, grant);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.GetProperty("token").GetString()!;
    }

    private static async Task<JsonElement> ProfileAsync(HttpClient client, string token)
    {
        using var response = await GetAsync(client, token, "/api/profile");
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static Task<HttpResponseMessage> GetAsync(
        HttpClient client,
        string token,
        string path
    ) => SendAsync(client, token, HttpMethod.Get, path);

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        string token,
        HttpMethod method,
        string path,
        HttpContent? content = null
    )
    {
        using var request = Authorized(method, path, bearer: token);
        request.Content = content;
        return await client.SendAsync(request, Ct);
    }

    private static Task<HttpResponseMessage> PatchAsync(
        HttpClient client,
        string token,
        object body
    ) => SendAsync(client, token, HttpMethod.Patch, "/api/profile", JsonContent.Create(body));

    private static Task<HttpResponseMessage> UploadAsync(
        HttpClient client,
        string token,
        byte[] content
    )
    {
        var body = new ByteArrayContent(content);
        body.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        return SendAsync(client, token, HttpMethod.Put, "/api/profile/avatar", body);
    }
}

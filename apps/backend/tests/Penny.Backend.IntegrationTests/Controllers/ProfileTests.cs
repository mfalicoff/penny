using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Application.Profiles;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Password accounts' display names and pictures (MAZ-171): the limits, bad files, the
// privacy rule and the fallbacks. Provider-managed fields are in OidcProfileTests.
public sealed class ProfileTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    [Fact]
    public async Task whenRegisteredWithName_Profile_ShouldReturnTrimmedEditableName()
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new
            {
                email = "ada@example.test",
                password = TestPassword,
                displayName = "  Ada Lovelace ",
            },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var token = (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;

        var profile = await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK);

        profile.GetProperty("email").GetString().ShouldBe("ada@example.test");
        profile.GetProperty("displayName").GetString().ShouldBe("Ada Lovelace");
        profile.GetProperty("nameEditable").GetBoolean().ShouldBeTrue();
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeTrue();
        profile.GetProperty("needsName").GetBoolean().ShouldBeFalse();
        profile.GetProperty("signIn").GetString().ShouldBe("password");
        profile.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
        profile.TryGetProperty("provider", out _).ShouldBeFalse();

        // The apps' chrome reads the summary from /me.
        var me = await ExpectAsync(HttpMethod.Get, "/api/auth/me", token, HttpStatusCode.OK);
        me.GetProperty("email").GetString().ShouldBe("ada@example.test");
        me.GetProperty("userId").GetString().ShouldBe(profile.GetProperty("userId").GetString());
        me.GetProperty("displayName").GetString().ShouldBe("Ada Lovelace");
        me.GetProperty("needsName").GetBoolean().ShouldBeFalse();
        me.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task whenRegisteredWithBlankName_Profile_ShouldAskForNameUntilDismissed(
        string blank
    )
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new
            {
                email = "blank@example.test",
                password = TestPassword,
                displayName = blank,
            },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var token = (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
        var profile = await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK);
        profile.TryGetProperty("displayName", out _).ShouldBeFalse();
        profile.GetProperty("needsName").GetBoolean().ShouldBeTrue();

        var dismissed = await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.OK,
            new { namePromptDismissed = true }
        );

        dismissed.GetProperty("needsName").GetBoolean().ShouldBeFalse();
        dismissed.TryGetProperty("displayName", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task whenAccountPredatesProfiles_Profile_ShouldAskForName()
    {
        // RegisterAsync sends only the credentials, as apps before profiles did.
        var token = await RegisterAsync("legacy@example.test");

        var profile = await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK);

        profile.GetProperty("needsName").GetBoolean().ShouldBeTrue();
        profile.GetProperty("nameEditable").GetBoolean().ShouldBeTrue();
    }

    [Theory]
    [InlineData("A")]
    [InlineData("Zoë Ångström-Ōtsuka")]
    [InlineData("😀 Sixty code units: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task whenNameWithinLimits_UpdateProfile_ShouldStoreIt(string name)
    {
        name.Length.ShouldBeLessThanOrEqualTo(DisplayName.MaxLength);
        var token = await RegisterAsync("named@example.test");

        var profile = await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.OK,
            new { displayName = name }
        );

        profile.GetProperty("displayName").GetString().ShouldBe(name);
        profile.GetProperty("needsName").GetBoolean().ShouldBeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("    ")]
    [InlineData("Line\nbreak")]
    [InlineData("Bell\u0007")]
    [InlineData("Separator\u2028here")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task whenNameBreaksRules_UpdateProfile_ShouldReturnBadRequestAndKeepName(
        string name
    )
    {
        var token = await RegisterAsync("rules@example.test");
        await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.OK,
            new { displayName = "Kept" }
        );

        await ExpectErrorAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.BadRequest,
            ProfileService.InvalidName,
            new { displayName = name }
        );

        (await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Kept");
    }

    [Fact]
    public async Task whenRegisterNameBreaksRules_Register_ShouldReturnBadRequestAndCreateNothing()
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new
            {
                email = "toolong@example.test",
                password = TestPassword,
                displayName = new string('x', 61),
            },
            Ct
        );

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            ProfileService.InvalidName
        );
        (await CountAsync("SELECT count(*) FROM penny.users")).ShouldBe(0);
    }

    [Theory]
    [InlineData("""{"displayName":42}""")]
    [InlineData("""{"namePromptDismissed":false}""")]
    [InlineData("""["Ada"]""")]
    public async Task whenBodyHasWrongTypes_UpdateProfile_ShouldReturnBadRequest(string body)
    {
        var token = await RegisterAsync("types@example.test");
        using var request = Authorized(HttpMethod.Patch, "/api/profile", bearer: token);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var response = await Client.SendAsync(request, Ct);

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            ProfilePatchBody.InvalidBody
        );
    }

    [Fact]
    public async Task whenNameCleared_UpdateProfile_ShouldFallBackToEmail()
    {
        var token = await RegisterAsync("clear@example.test");
        await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.OK,
            new { displayName = "Temporary" }
        );

        var profile = await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            token,
            HttpStatusCode.OK,
            new { displayName = (string?)null }
        );

        profile.TryGetProperty("displayName", out _).ShouldBeFalse();
        profile.GetProperty("email").GetString().ShouldBe("clear@example.test");
    }

    [Fact]
    public async Task whenPictureUploaded_ProfileAvatar_ShouldStoreSquareWebpWithoutMetadata()
    {
        var (token, userId) = await AccountAsync("photo@example.test");
        var original = ProfileImages.JpegWithMetadata();
        Encoding.ASCII.GetString(original).ShouldContain(ProfileImages.HiddenMarker);

        var profile = await UploadAvatarAsync(token, "image/jpeg", original, HttpStatusCode.OK);

        var url = profile.GetProperty("avatarUrl").GetString()!;
        url.ShouldMatch($"^/api/users/{userId}/avatar\\?v=[0-9a-f]{{32}}$");
        using var download = await SendAsync(HttpMethod.Get, url, token);
        download.StatusCode.ShouldBe(HttpStatusCode.OK);
        download.Content.Headers.ContentType!.MediaType.ShouldBe("image/webp");
        download.Headers.CacheControl!.Private.ShouldBeTrue();
        download.Headers.CacheControl.MaxAge.ShouldBe(TimeSpan.FromDays(365));
        download.Headers.CacheControl.Extensions.ShouldContain(value => value.Name == "immutable");
        var stored = await download.Content.ReadAsByteArrayAsync(Ct);
        Encoding.ASCII.GetString(stored, 0, 4).ShouldBe("RIFF");
        Encoding.ASCII.GetString(stored, 8, 4).ShouldBe("WEBP");
        Encoding.ASCII.GetString(stored).ShouldNotContain(ProfileImages.HiddenMarker);
        Encoding.ASCII.GetString(stored).ShouldNotContain("EXIF");
        var (width, height) = ProfileImages.WebpSize(stored);
        width.ShouldBe(height);
        width.ShouldBeLessThanOrEqualTo(AvatarFormat.MaxSide);
        width.ShouldBeGreaterThan(AvatarFormat.MinSide);

        // Any other version is revalidated rather than cached for good.
        using var stale = await SendAsync(
            HttpMethod.Get,
            $"/api/users/{userId}/avatar?v=0000",
            token
        );
        stale.Headers.CacheControl!.Private.ShouldBeTrue();
        stale.Headers.CacheControl.NoCache.ShouldBeTrue();
    }

    [Fact]
    public async Task whenPictureReplaced_ProfileAvatar_ShouldChangeItsVersion()
    {
        var token = await RegisterAsync("replace@example.test");
        var first = (
            await UploadAvatarAsync(token, "image/png", ProfileImages.Png(), HttpStatusCode.OK)
        )
            .GetProperty("avatarUrl")
            .GetString();

        var second = (
            await UploadAvatarAsync(
                token,
                "image/jpeg",
                ProfileImages.JpegWithMetadata(),
                HttpStatusCode.OK
            )
        )
            .GetProperty("avatarUrl")
            .GetString();

        second.ShouldNotBe(first);
        (await CountAsync("SELECT count(*) FROM penny.user_avatars")).ShouldBe(1);
    }

    [Fact]
    public async Task whenPictureRemoved_ProfileAvatar_ShouldFallBackToInitials()
    {
        var (token, userId) = await AccountAsync("remove@example.test");
        await UploadAvatarAsync(token, "image/png", ProfileImages.Png(), HttpStatusCode.OK);

        var profile = await ExpectAsync(
            HttpMethod.Delete,
            "/api/profile/avatar",
            token,
            HttpStatusCode.OK
        );

        profile.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
        await ExpectErrorAsync(
            HttpMethod.Get,
            $"/api/users/{userId}/avatar",
            token,
            HttpStatusCode.NotFound,
            ProfileService.PictureNotFound
        );
        (await CountAsync("SELECT count(*) FROM penny.user_avatars")).ShouldBe(0);
    }

    public static TheoryData<string, byte[], string> BadFiles() =>
        new()
        {
            // Not a picture type, or a signature that doesn't match the declared type.
            { "application/pdf", TestPdf.Create(), ProfileService.InvalidPicture },
            { "image/gif", "GIF89a......"u8.ToArray(), ProfileService.InvalidPicture },
            { "image/png", "not a png at all"u8.ToArray(), ProfileService.InvalidPicture },
            { "image/jpeg", ProfileImages.Png(), ProfileService.InvalidPicture },
            { "image/png", [], ProfileService.InvalidPicture },
            // The right signature, but nothing libvips can decode.
            {
                "image/png",
                [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8],
                ProfileService.UnreadablePicture
            },
        };

    [Theory]
    [MemberData(nameof(BadFiles))]
    public async Task whenFileIsNotAUsablePicture_ProfileAvatar_ShouldReturnBadRequest(
        string mime,
        byte[] content,
        string message
    )
    {
        var token = await RegisterAsync("badfile@example.test");

        var error = await UploadAvatarAsync(token, mime, content, HttpStatusCode.BadRequest);

        error.GetProperty("error").GetString().ShouldBe(message);
        (await CountAsync("SELECT count(*) FROM penny.user_avatars")).ShouldBe(0);
    }

    [Fact]
    public async Task whenPictureTooSmall_ProfileAvatar_ShouldReturnBadRequest()
    {
        var token = await RegisterAsync("tiny@example.test");
        var tiny = SyntheticReceipts.Png(8, 8);

        var error = await UploadAvatarAsync(token, "image/png", tiny, HttpStatusCode.BadRequest);

        error.GetProperty("error").GetString().ShouldBe(ProfileService.UnreadablePicture);
    }

    [Fact]
    public async Task whenPictureOverTenMegabytes_ProfileAvatar_ShouldReturnBadRequest()
    {
        // The production request limit (20 MB); the shared host uses 64 KB.
        await using var factory = new TestApiFactory(
            Fixture.Connection,
            new Dictionary<string, string>
            {
                ["Backend:MaxRequestBodyBytes"] = (20 * 1024 * 1024).ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
            }
        );
        using var client = CreateClient(factory);
        var token = await RegisterAsync("large@example.test", client);
        var large = new byte[AvatarFormat.MaxBytes + 1];
        ProfileImages.Png().CopyTo(large, 0);

        var error = await UploadAvatarAsync(
            token,
            "image/png",
            large,
            HttpStatusCode.BadRequest,
            client
        );

        error.GetProperty("error").GetString().ShouldBe(ProfileService.InvalidPicture);
    }

    [Fact]
    public async Task whenPeopleShareAHousehold_HouseholdMembers_ShouldShowNamesAndPictures()
    {
        At(Noon);
        var (ownerToken, ownerId) = await AccountAsync("owner@example.test");
        var (guestToken, guestId) = await AccountAsync("guest@example.test");
        await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            ownerToken,
            HttpStatusCode.OK,
            new { displayName = "Owner Person" }
        );
        await UploadAvatarAsync(ownerToken, "image/png", ProfileImages.Png(), HttpStatusCode.OK);
        var household = (await CreateHouseholdAsync(ownerToken)).GetProperty("id").GetString()!;
        await AdmitAsync(household, ownerToken, guestToken);

        var owner = await MemberAsync(household, guestToken, ownerId);
        var guest = await MemberAsync(household, ownerToken, guestId);

        owner.GetProperty("displayName").GetString().ShouldBe("Owner Person");
        var url = owner.GetProperty("avatarUrl").GetString()!;
        using (var picture = await SendAsync(HttpMethod.Get, url, guestToken))
            picture.StatusCode.ShouldBe(HttpStatusCode.OK);
        // No name and no picture: the member carries only the email, so apps fall back.
        guest.TryGetProperty("displayName", out _).ShouldBeFalse();
        guest.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
        guest.GetProperty("email").GetString().ShouldBe("guest@example.test");

        // A rename shows up for the other members at once.
        await ExpectAsync(
            HttpMethod.Patch,
            "/api/profile",
            ownerToken,
            HttpStatusCode.OK,
            new { displayName = "Renamed Owner" }
        );
        (await MemberAsync(household, guestToken, ownerId))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Renamed Owner");
    }

    [Fact]
    public async Task whenPeopleShareNoHousehold_UserAvatar_ShouldReturnNotFound()
    {
        var (ownerToken, ownerId) = await AccountAsync("private@example.test");
        var strangerToken = await RegisterAsync("stranger@example.test");
        var url = (
            await UploadAvatarAsync(ownerToken, "image/png", ProfileImages.Png(), HttpStatusCode.OK)
        )
            .GetProperty("avatarUrl")
            .GetString()!;

        await ExpectErrorAsync(
            HttpMethod.Get,
            url,
            strangerToken,
            HttpStatusCode.NotFound,
            ProfileService.PictureNotFound
        );
        // The same answer as for an account that doesn't exist.
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/users/no-such-user/avatar",
            strangerToken,
            HttpStatusCode.NotFound,
            ProfileService.PictureNotFound
        );
        using var anonymous = await Client.GetAsync(url, Ct);
        anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        // The owner sees their own picture.
        using var own = await SendAsync(HttpMethod.Get, $"/api/users/{ownerId}/avatar", ownerToken);
        own.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenViewerLeftTheHousehold_UserAvatar_ShouldReturnNotFound()
    {
        At(Noon);
        var (ownerToken, _) = await AccountAsync("stays@example.test");
        var (leaverToken, _) = await AccountAsync("leaves@example.test");
        var url = (
            await UploadAvatarAsync(ownerToken, "image/png", ProfileImages.Png(), HttpStatusCode.OK)
        )
            .GetProperty("avatarUrl")
            .GetString()!;
        var household = (await CreateHouseholdAsync(ownerToken)).GetProperty("id").GetString()!;
        await AdmitAsync(household, ownerToken, leaverToken);
        using (var shared = await SendAsync(HttpMethod.Get, url, leaverToken))
            shared.StatusCode.ShouldBe(HttpStatusCode.OK);

        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{household}/leave",
            leaverToken,
            HttpStatusCode.OK
        );

        using var after = await SendAsync(HttpMethod.Get, url, leaverToken);
        after.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task whenFormerMemberHasPicture_UserAvatar_ShouldStayVisibleToCurrentMembers()
    {
        At(Noon);
        var (ownerToken, _) = await AccountAsync("keeper@example.test");
        var (leaverToken, leaverId) = await AccountAsync("former@example.test");
        await UploadAvatarAsync(leaverToken, "image/png", ProfileImages.Png(), HttpStatusCode.OK);
        var household = (await CreateHouseholdAsync(ownerToken)).GetProperty("id").GetString()!;
        await AdmitAsync(household, ownerToken, leaverToken);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{household}/leave",
            leaverToken,
            HttpStatusCode.OK
        );

        // Their name and picture stay in the household's history.
        var former = await MemberAsync(household, ownerToken, leaverId);
        former.TryGetProperty("leftAt", out _).ShouldBeTrue();
        using var picture = await SendAsync(
            HttpMethod.Get,
            former.GetProperty("avatarUrl").GetString()!,
            ownerToken
        );
        picture.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task<JsonElement> UploadAvatarAsync(
        string token,
        string mime,
        byte[] content,
        HttpStatusCode status,
        HttpClient? client = null
    )
    {
        using var request = Authorized(HttpMethod.Put, "/api/profile/avatar", bearer: token);
        request.Content = new ByteArrayContent(content);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(mime);
        using var response = await (client ?? Client).SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(status, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}

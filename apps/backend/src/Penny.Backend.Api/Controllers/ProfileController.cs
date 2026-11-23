using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Api.Receipts;
using Penny.Backend.Application.Profiles;

namespace Penny.Backend.Api.Controllers;

// Display names and pictures (MAZ-171). Session-protected by the fallback policy. A
// person changes only the fields their sign-in provider doesn't send (403 otherwise).
// Pictures are uploaded as the raw file, like receipts, and served only to the person and
// to the current members of a household they are or were in.
[ApiController]
[Route("api")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class ProfileController(ProfileService profiles) : ControllerBase
{
    [HttpGet("profile", Name = "getApiProfile")]
    [ProducesResponseType<ProfileResponse>(200)]
    public async Task<ActionResult<ProfileResponse>> Get(CancellationToken cancellationToken) =>
        Ok(ProfileResponse.From(await profiles.GetAsync(User.Session().UserId, cancellationToken)));

    [HttpPatch("profile", Name = "patchApiProfile")]
    [ProducesResponseType<ProfileResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<ProfileResponse>> Update(CancellationToken cancellationToken)
    {
        var (name, dismiss) = await ProfilePatchBody.ReadAsync(Request, cancellationToken);
        return Ok(
            ProfileResponse.From(
                await profiles.UpdateAsync(User.Session().UserId, name, dismiss, cancellationToken)
            )
        );
    }

    // A 10 MiB photo on a slow link can outlast the default request timeout.
    [DisableRequestTimeout]
    [HttpPut("profile/avatar", Name = "putApiProfileAvatar")]
    [ProducesResponseType<ProfileResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<ProfileResponse>> SetAvatar(CancellationToken cancellationToken)
    {
        var upload = await ReceiptUploadReader.ReadAsync(Request, cancellationToken);
        return Ok(
            ProfileResponse.From(
                await profiles.SetAvatarAsync(
                    User.Session().UserId,
                    upload.Mime,
                    upload.Content,
                    cancellationToken
                )
            )
        );
    }

    [HttpDelete("profile/avatar", Name = "deleteApiProfileAvatar")]
    [ProducesResponseType<ProfileResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    public async Task<ActionResult<ProfileResponse>> RemoveAvatar(
        CancellationToken cancellationToken
    ) =>
        Ok(
            ProfileResponse.From(
                await profiles.RemoveAvatarAsync(User.Session().UserId, cancellationToken)
            )
        );

    // `v` only busts caches: a URL with the current version may be cached for good, any
    // other answer is revalidated.
    [HttpGet("users/{userId}/avatar", Name = "getApiUsersUserIdAvatar")]
    [ProducesResponseType(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<IActionResult> ReadAvatar(
        string userId,
        [FromQuery(Name = "v")] string? version,
        CancellationToken cancellationToken
    )
    {
        var avatar = await profiles.ReadAvatarAsync(
            User.Session().UserId,
            userId,
            cancellationToken
        );
        Response.Headers.CacheControl = string.Equals(
            version,
            avatar.Version,
            StringComparison.Ordinal
        )
            ? "private, max-age=31536000, immutable"
            : "private, no-cache";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(avatar.Content, avatar.Mime);
    }
}

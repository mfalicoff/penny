namespace Penny.Backend.AppHost;

// Local-only containers that the operator stack doesn't run, pinned by their multi-platform
// index digest. Update the tag and the digest together.
public static class DevelopmentImages
{
    // Local SMTP server with a web inbox for the API's password reset and invitation emails.
    public static readonly PinnedImage Mailpit = new(
        "docker.io",
        "axllent/mailpit",
        "v1.34.0",
        "23a2ef85bc50853ab3093645d1d64679afd8887e89da5e48a88940c172591a4e"
    );
}

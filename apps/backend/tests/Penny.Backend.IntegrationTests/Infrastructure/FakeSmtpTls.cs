namespace Penny.Backend.IntegrationTests.Infrastructure;

// How the fake SMTP server secures connections.
public enum FakeSmtpTls
{
    None,

    // TLS from the first byte, as on port 465.
    Implicit,

    // Plain text upgraded with STARTTLS, as on port 587.
    StartTls,
}

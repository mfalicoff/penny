namespace Penny.Backend.Api.Mail;

// `Email__Smtp__Security`: `starttls` (default, port 587) upgrades the connection and
// refuses servers that can't; `tls` (port 465) is TLS from the first byte; `none` is
// plain text and only allowed to a loopback host (a local relay or a test server).
public enum SmtpSecurity
{
    StartTls,
    Tls,
    None,
}

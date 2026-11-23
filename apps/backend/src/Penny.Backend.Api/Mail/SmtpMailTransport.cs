using System.Net.Sockets;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Penny.Backend.Application.Mail;

namespace Penny.Backend.Api.Mail;

// Sends through the operator's SMTP server with MailKit (MAZ-124): one connection per
// batch, TLS as configured (certificates validated by the platform), optional
// authentication. Outcomes are reason codes only: SMTP status codes or the failing step,
// never the server's text, which may echo the address. MailKit logs nothing unless given
// a protocol logger, and none is given.
public sealed class SmtpMailTransport(SmtpSettings settings)
    : Penny.Backend.Application.Mail.IMailTransport
{
    public async Task<IReadOnlyList<MailOutcome>> SendAsync(
        IReadOnlyList<OutgoingMail> messages,
        CancellationToken cancellationToken
    )
    {
        var outcomes = new MailOutcome[messages.Count];
        using var client = new SmtpClient { Timeout = (int)settings.Timeout.TotalMilliseconds };
        var connected = await ConnectAsync(client, cancellationToken);
        if (connected is not null)
        {
            Array.Fill(outcomes, connected);
            return outcomes;
        }
        var index = 0;
        try
        {
            for (; index < messages.Count; index++)
            {
                if (!client.IsConnected)
                    break;
                outcomes[index] = await SendOneAsync(client, messages[index], cancellationToken);
            }
        }
        finally
        {
            for (var rest = index; rest < messages.Count; rest++)
                outcomes[rest] ??= MailOutcome.Retry("smtp:connection-lost");
            if (client.IsConnected)
            {
                try
                {
                    await client.DisconnectAsync(quit: true, CancellationToken.None);
                }
                catch (Exception error) when (IsTransportFailure(error)) { }
            }
        }
        return outcomes;
    }

    private async Task<MailOutcome?> ConnectAsync(
        SmtpClient client,
        CancellationToken cancellationToken
    )
    {
        try
        {
            await client.ConnectAsync(
                settings.Host,
                settings.Port,
                settings.Security switch
                {
                    SmtpSecurity.Tls => SecureSocketOptions.SslOnConnect,
                    SmtpSecurity.None => SecureSocketOptions.None,
                    _ => SecureSocketOptions.StartTls,
                },
                cancellationToken
            );
        }
        catch (SslHandshakeException)
        {
            return MailOutcome.Retry("smtp:tls");
        }
        catch (Exception error) when (IsTransportFailure(error))
        {
            return MailOutcome.Retry("smtp:connect");
        }
        if (settings.Username is null || settings.Password is null)
            return null;
        try
        {
            await client.AuthenticateAsync(settings.Username, settings.Password, cancellationToken);
            return null;
        }
        catch (AuthenticationException)
        {
            return MailOutcome.Retry("smtp:auth");
        }
        catch (Exception error) when (IsTransportFailure(error))
        {
            return MailOutcome.Retry("smtp:auth");
        }
    }

    private async Task<MailOutcome> SendOneAsync(
        SmtpClient client,
        OutgoingMail mail,
        CancellationToken cancellationToken
    )
    {
        MimeMessage message;
        try
        {
            message = new MimeMessage();
            message.From.Add(new MailboxAddress(settings.FromName, settings.From));
            message.To.Add(MailboxAddress.Parse(mail.To));
        }
        catch (ParseException)
        {
            return MailOutcome.Permanent("invalid-address");
        }
        message.Subject = MailTemplates.OneLine(mail.Subject);
        message.Body = new TextPart("plain") { Text = mail.Text };
        try
        {
            await client.SendAsync(message, cancellationToken);
            return MailOutcome.Sent;
        }
        catch (SmtpCommandException error)
        {
            var code = (int)error.StatusCode;
            return code is >= 500 and < 600
                ? MailOutcome.Permanent($"smtp:{code}")
                : MailOutcome.Retry($"smtp:{code}");
        }
        catch (Exception error) when (IsTransportFailure(error))
        {
            return MailOutcome.Retry("smtp:connection-lost");
        }
    }

    private static bool IsTransportFailure(Exception error) =>
        error
            is SmtpCommandException
                or SmtpProtocolException
                or ProtocolException
                or IOException
                or SocketException
                or TimeoutException
                or ServiceNotConnectedException
                or ServiceNotAuthenticatedException
                or InvalidOperationException
                or NotSupportedException
                or AuthenticationException;
}

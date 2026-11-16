using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A host whose penny-render is a fake that returns a fixed PDF (MAZ-184), and the
// synthetic mail the processing and inbox suites send.
public sealed class FakeRenderer : IEmailRenderer
{
    public bool Down { get; set; }
    public int Calls { get; private set; }

    public Task<byte[]?> RenderAsync(
        string html,
        long maxBytes,
        CancellationToken cancellationToken
    )
    {
        Calls++;
        if (Down)
            throw new MailRendererUnavailableException();
        return Task.FromResult<byte[]?>(TestPdf.Create());
    }
}

public static class InboundMailHost
{
    public static WebApplicationFactory<Program> With(
        ApiFixture fixture,
        IEmailRenderer renderer
    ) =>
        fixture.Factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(renderer))
        );

    public static Task<long> ProcessAsync(
        WebApplicationFactory<Program> host,
        CancellationToken cancellationToken
    ) => host.Services.GetRequiredService<InboundMailProcessor>().CatchUpAsync(cancellationToken);

    public static byte[] MailWithInvoice(byte[] invoice, string subject = "Order 1042 confirmed")
    {
        var body = new BodyBuilder { HtmlBody = "<p>Total $12.50</p>" };
        body.Attachments.Add("invoice-0412.pdf", invoice, new ContentType("application", "pdf"));
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Acme Store", "orders@shop.example.test"));
        message.To.Add(new MailboxAddress("", "someone@receipts.example.test"));
        message.Subject = subject;
        message.Body = body.ToMessageBody();
        using var stream = new MemoryStream();
        message.WriteTo(stream);
        return stream.ToArray();
    }
}

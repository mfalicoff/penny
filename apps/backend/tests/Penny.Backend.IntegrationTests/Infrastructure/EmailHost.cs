using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Penny.Backend.Application.Mail;
using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// One API host with email on (MAZ-124), shared by a test class: real MailKit SMTP to a
// local fake server, over the shared PostgreSQL database. The mail worker is off; tests
// run the delivery runner explicitly with this host's pinned clock. Logs are captured at
// Information so tests can prove no address or code reaches them.
public sealed class EmailHost(ApiFixture fixture) : IAsyncLifetime
{
    public const string AppUrl = "http://localhost:4173";
    public const int RecipientLimit = 3;
    public const int AccountLimit = 4;

    public FakeSmtpServer Smtp { get; } = new();
    public CapturingLoggerProvider Logs { get; } = new();
    public TestApiFactory Factory { get; private set; } = null!;

    public MailDeliveryRunner Runner => Factory.Services.GetRequiredService<MailDeliveryRunner>();

    public ValueTask InitializeAsync()
    {
        Factory = new TestApiFactory(
            fixture.Connection,
            new Dictionary<string, string>
            {
                ["Email:Smtp:Host"] = "127.0.0.1",
                ["Email:Smtp:Port"] = Smtp.Port.ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
                ["Email:Smtp:Security"] = "none",
                ["Email:Smtp:TimeoutSeconds"] = "5",
                ["Email:From"] = "penny@example.test",
                ["Email:AppUrl"] = AppUrl,
                ["Email:Worker"] = "false",
                ["Email:RecipientMessagesPerDay"] = RecipientLimit.ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
                ["Email:AccountMessagesPerDay"] = AccountLimit.ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                ),
                ["Logging:LogLevel:Default"] = "Information",
            },
            services =>
            {
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(Logs);
            }
        );
        Factory.StartServer();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        await Factory.DisposeAsync();
        await Smtp.DisposeAsync();
    }
}

using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Records every formatted log message (and exception text) a host writes, so tests
// can prove secrets never reach logs.
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> messages = new();

    public IReadOnlyCollection<string> Messages => messages;

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public void Dispose() { }

    private sealed class Logger(CapturingLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter
        ) => provider.messages.Enqueue($"{category}: {formatter(state, exception)} {exception}");
    }
}

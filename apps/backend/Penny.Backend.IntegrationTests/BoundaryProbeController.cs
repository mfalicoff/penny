using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Domain;

namespace Penny.Backend.IntegrationTests;

public sealed class ProbeSignals
{
    public TaskCompletionSource Started { get; private set; } = Create();
    public TaskCompletionSource Canceled { get; private set; } = Create();
    public TaskCompletionSource Release { get; private set; } = Create();

    private static TaskCompletionSource Create() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Reset()
    {
        Started = Create();
        Canceled = Create();
        Release = Create();
    }
}

public sealed record ProbeBody([Required, MinLength(1)] string Value);

// Loaded through ConfigureTestServices only, never part of the deployed API.
[ApiController]
[Route("api/test")]
public sealed class BoundaryProbeController(ProbeSignals signals) : ControllerBase
{
    [HttpGet("failure/{kind}")]
    public IActionResult Failure(FailureKind kind) =>
        throw new BackendFailure(kind, "Synthetic domain failure.");

    [HttpGet("unexpected")]
    public IActionResult Unexpected() =>
        throw new InvalidOperationException("synthetic-secret-not-for-http");

    [HttpPost("body")]
    public IActionResult Body([FromBody] ProbeBody body) => Ok(body);

    [HttpGet("wait")]
    public async Task<IActionResult> Wait(CancellationToken ct)
    {
        signals.Started.TrySetResult();
        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            signals.Canceled.TrySetResult();
            throw;
        }
        return Ok();
    }

    [HttpGet("drain")]
    public async Task<IActionResult> Drain(CancellationToken ct)
    {
        signals.Started.TrySetResult();
        await signals.Release.Task.WaitAsync(ct);
        return Ok();
    }
}

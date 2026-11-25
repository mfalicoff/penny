namespace Penny.Backend.Api.Contracts;

/// <summary>
/// What client telemetry the server accepts (MAZ-129). Every flag is false unless the
/// operator turned it on; clients then never ask, collect or send anything.
/// </summary>
/// <param name="Web">The web app may offer error and performance reports (POST /api/telemetry/faro).</param>
/// <param name="SessionReplay">The web app may also offer Session Replay, always masked.</param>
/// <param name="Native">The iOS app may offer crash and performance reports (POST /api/telemetry/otlp/v1/*).</param>
public sealed record ClientTelemetryInfo(bool Web, bool SessionReplay, bool Native);

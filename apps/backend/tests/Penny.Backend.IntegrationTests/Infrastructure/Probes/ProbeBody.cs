using System.ComponentModel.DataAnnotations;

namespace Penny.Backend.IntegrationTests.Infrastructure.Probes;

public sealed record ProbeBody([Required, MinLength(1)] string Value);

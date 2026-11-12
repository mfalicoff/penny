namespace Penny.Backend.Persistence.Receipts;

// Per-process resource limits of the OCR engines (MAZ-125): every engine program is
// started through util-linux `prlimit` (`Prlimit`, a path or a name on PATH), which sets
// RLIMIT_AS to `MemoryBytes` and RLIMIT_CPU to `CpuSeconds` and then executes the
// program. A program that exceeds them fails (allocation error) or is killed
// (SIGXCPU/SIGKILL); the attempt fails and is retried until `Ocr__MaxAttempts`.
public sealed record OcrEngineLimits(string Prlimit, long MemoryBytes, int CpuSeconds);

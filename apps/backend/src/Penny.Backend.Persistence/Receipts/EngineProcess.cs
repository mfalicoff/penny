using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;

namespace Penny.Backend.Persistence.Receipts;

// Runs one OCR engine program (MAZ-125) with the receipt bytes on standard input and
// reads its result from standard output, so decrypted content never touches the disk.
// Cancellation (the extraction time bound or shutdown) kills the process tree at once;
// output beyond `maxOutputBytes` is drained and dropped so the program cannot block or
// exhaust memory. Standard error is drained and never logged (it can echo content).
// With `limits`, the program runs under `prlimit` with a memory (address space) and CPU
// time limit, so a decompression bomb that slips past the size planning cannot take
// the host's memory. Every buffer that held program output is zeroed after use.
internal static class EngineProcess
{
    private const int MaxErrorBytes = 64 * 1024;
    private const int ChunkBytes = 81920;

    // Exit codes of a program killed by a signal (128 + signal): SIGKILL (the CPU hard
    // limit, or the kernel's out-of-memory killer under a cgroup memory limit) and
    // SIGXCPU (the CPU soft limit).
    private static readonly HashSet<int> LimitExitCodes = [128 + 9, 128 + 24];

    public sealed record Result(int ExitCode, byte[] Output, string Error)
    {
        // The program was killed by a resource limit (not by our cancellation).
        public bool HitLimit => LimitExitCodes.Contains(ExitCode);
    }

    public static async Task<Result> RunAsync(
        string program,
        IReadOnlyList<string> arguments,
        ReadOnlyMemory<byte> input,
        IReadOnlyDictionary<string, string> environment,
        OcrEngineLimits? limits,
        int maxOutputBytes,
        CancellationToken cancellationToken
    )
    {
        var start = new ProcessStartInfo(limits?.Prlimit ?? program)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (limits is not null)
        {
            start.ArgumentList.Add(
                "--as=" + limits.MemoryBytes.ToString(CultureInfo.InvariantCulture)
            );
            start.ArgumentList.Add(
                "--cpu=" + limits.CpuSeconds.ToString(CultureInfo.InvariantCulture)
            );
            start.ArgumentList.Add("--");
            start.ArgumentList.Add(program);
        }
        foreach (var argument in arguments)
            start.ArgumentList.Add(argument);
        foreach (var (name, value) in environment)
            start.Environment[name] = value;
        using var process = new Process { StartInfo = start };
        try
        {
            process.Start();
        }
        catch (Win32Exception failure)
        {
            throw new InvalidOperationException(
                $"The OCR program {Path.GetFileName(start.FileName)} could not be started. Install it or set its path (see docs/operations.md#receipt-text-ocr).",
                failure
            );
        }
        await using var kill = cancellationToken.Register(() => Kill(process));
        var output = ReadAsync(process.StandardOutput.BaseStream, maxOutputBytes);
        var error = ReadAsync(process.StandardError.BaseStream, MaxErrorBytes);
        try
        {
            await process.StandardInput.BaseStream.WriteAsync(input, cancellationToken);
            await process.StandardInput.BaseStream.FlushAsync(cancellationToken);
        }
        catch (IOException)
        {
            // The program exited before reading everything (it rejected the input); its
            // exit code says so.
        }
        finally
        {
            try
            {
                process.StandardInput.Close();
            }
            catch (IOException) { }
        }
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            Kill(process);
            CryptographicOperations.ZeroMemory(await output);
            throw;
        }
        var bytes = await output;
        var errorBytes = await error;
        var errorText = System.Text.Encoding.UTF8.GetString(errorBytes);
        CryptographicOperations.ZeroMemory(errorBytes);
        if (cancellationToken.IsCancellationRequested)
        {
            CryptographicOperations.ZeroMemory(bytes);
            cancellationToken.ThrowIfCancellationRequested();
        }
        return new(process.ExitCode, bytes, errorText);
    }

    private static void Kill(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { }
        catch (Win32Exception) { }
    }

    // Keeps the first `limit` bytes. The buffer grows by copying, and every buffer it
    // leaves behind (and the read chunk) is zeroed, so no copy of the output lingers.
    private static async Task<byte[]> ReadAsync(Stream stream, int limit)
    {
        var chunk = new byte[ChunkBytes];
        var kept = new byte[Math.Min(limit, ChunkBytes)];
        var length = 0;
        try
        {
            int read;
            while ((read = await stream.ReadAsync(chunk)) > 0)
            {
                var take = Math.Min(limit - length, read);
                if (take <= 0)
                    continue;
                if (length + take > kept.Length)
                {
                    var grown = new byte[
                        (int)Math.Min(limit, Math.Max(kept.Length * 2L, length + take))
                    ];
                    kept.AsSpan(0, length).CopyTo(grown);
                    CryptographicOperations.ZeroMemory(kept);
                    kept = grown;
                }
                chunk.AsSpan(0, take).CopyTo(kept.AsSpan(length));
                length += take;
            }
            return kept.AsSpan(0, length).ToArray();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(chunk);
            CryptographicOperations.ZeroMemory(kept);
        }
    }
}

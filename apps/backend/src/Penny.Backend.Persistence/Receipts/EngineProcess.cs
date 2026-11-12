using System.ComponentModel;
using System.Diagnostics;

namespace Penny.Backend.Persistence.Receipts;

// Runs one OCR engine program (MAZ-125) with the receipt bytes on standard input and
// reads its result from standard output, so decrypted content never touches the disk.
// Cancellation (the extraction time bound or shutdown) kills the process tree at once;
// output beyond `maxOutputBytes` is drained and dropped so the program cannot block or
// exhaust memory. Standard error is drained and never logged (it can echo content).
internal static class EngineProcess
{
    private const int MaxErrorBytes = 64 * 1024;

    public sealed record Result(int ExitCode, byte[] Output, string Error);

    public static async Task<Result> RunAsync(
        string program,
        IReadOnlyList<string> arguments,
        ReadOnlyMemory<byte> input,
        IReadOnlyDictionary<string, string> environment,
        int maxOutputBytes,
        CancellationToken cancellationToken
    )
    {
        var start = new ProcessStartInfo(program)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
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
                $"The OCR program {Path.GetFileName(program)} could not be started. Install it or set its path (see docs/operations.md#receipt-text-ocr).",
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
            throw;
        }
        var bytes = await output;
        var errorText = System.Text.Encoding.UTF8.GetString(await error);
        cancellationToken.ThrowIfCancellationRequested();
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

    private static async Task<byte[]> ReadAsync(Stream stream, int limit)
    {
        using var kept = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(buffer)) > 0)
        {
            var room = limit - (int)kept.Length;
            if (room > 0)
                kept.Write(buffer, 0, Math.Min(room, read));
        }
        return kept.ToArray();
    }
}

using System.Buffers;
using System.Text;
using Microsoft.Net.Http.Headers;
using Penny.Backend.Application.Receipts;

namespace Penny.Backend.Api.Receipts;

// Reads `POST /api/receipts` (MAZ-131): the body is the file's bytes, `Content-Type` its
// MIME type and `Content-Disposition` its name as an RFC 8187 `filename*` (UTF-8,
// percent-encoded). Nothing is decoded. The buffer starts at the declared `Content-Length`
// but at most 1 MiB, so a client that declares 10 MiB and then trickles bytes cannot pin
// 10 MiB per connection; it grows as bytes arrive. A body over the 10 MiB file limit is
// read to the end and discarded, so the client receives the 400 instead of a reset; the
// API-wide request limit still bounds it.
public static class ReceiptUploadReader
{
    private const int ChunkBytes = 81920;
    private const int MaxInitialBufferBytes = 1024 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, throwOnInvalidBytes: true);

    public static async Task<ReceiptUpload> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        var mime = MediaTypeHeaderValue.TryParse(request.ContentType, out var type)
            ? type.MediaType.Value?.ToLowerInvariant()
            : null;
        var name = request.Headers.ContentDisposition is [{ } disposition]
            ? FileName(disposition)
            : null;
        var content = await ContentAsync(request, cancellationToken);
        return new(name, mime, content);
    }

    // The decoded `filename*` parameter (`UTF-8''` and percent-encoded bytes), or null when
    // it is missing, repeated or not valid UTF-8. The disposition type is not checked.
    // Characters RFC 8187 would escape but JavaScript's encodeURIComponent leaves
    // (`' ( ) *`) are accepted literally.
    public static string? FileName(string disposition)
    {
        string? found = null;
        foreach (var part in disposition.Split(';').Skip(1))
        {
            var separator = part.IndexOf('=', StringComparison.Ordinal);
            if (separator < 0)
                return null;
            if (!part[..separator].Trim().Equals("filename*", StringComparison.OrdinalIgnoreCase))
                continue;
            if (found is not null)
                return null;
            var value = part[(separator + 1)..].Trim();
            const string prefix = "UTF-8''";
            if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return null;
            found = Decode(value[prefix.Length..]);
            if (found is null)
                return null;
        }
        return found;
    }

    private static string? Decode(string encoded)
    {
        var bytes = new List<byte>(encoded.Length);
        for (var index = 0; index < encoded.Length; index++)
        {
            var character = encoded[index];
            if (character == '%')
            {
                if (
                    index + 2 >= encoded.Length
                    || !byte.TryParse(
                        encoded.AsSpan(index + 1, 2),
                        System.Globalization.NumberStyles.AllowHexSpecifier,
                        null,
                        out var octet
                    )
                )
                    return null;
                bytes.Add(octet);
                index += 2;
            }
            else if (character is > ' ' and < (char)0x7F and not ('"' or ',' or '\\'))
                bytes.Add((byte)character);
            else
                return null;
        }
        try
        {
            return StrictUtf8.GetString([.. bytes]);
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    // The body, or null when it is longer than `ReceiptFormat.MaxBytes`. The buffer starts
    // at the declared length capped at `MaxInitialBufferBytes`, and the array is returned
    // without a copy when the body fills it exactly.
    private static async Task<byte[]?> ContentAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        if (request.ContentLength > ReceiptFormat.MaxBytes)
        {
            await request.Body.CopyToAsync(Stream.Null, cancellationToken);
            return null;
        }
        using var buffer = new MemoryStream(
            (int)Math.Min(request.ContentLength ?? 0, MaxInitialBufferBytes)
        );
        var chunk = ArrayPool<byte>.Shared.Rent(ChunkBytes);
        try
        {
            int read;
            while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > ReceiptFormat.MaxBytes)
                {
                    await request.Body.CopyToAsync(Stream.Null, cancellationToken);
                    return null;
                }
                buffer.Write(chunk, 0, read);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(chunk);
        }
        return buffer.Length == buffer.Capacity ? buffer.GetBuffer() : buffer.ToArray();
    }
}

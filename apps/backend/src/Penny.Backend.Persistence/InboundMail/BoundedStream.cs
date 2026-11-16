namespace Penny.Backend.Persistence.InboundMail;

// A write-only buffer that refuses to grow past `limit` (decoded MIME parts). It wraps
// a MemoryStream rather than deriving from it, so every write path goes through the
// one bounded method.
internal sealed class BoundedStream(long limit) : Stream
{
    private readonly MemoryStream buffer = new();

    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => buffer.Length;

    public override long Position
    {
        get => buffer.Position;
        set => throw new NotSupportedException();
    }

    public byte[] ToArray() => buffer.ToArray();

    public override void Write(byte[] buffer, int offset, int count) =>
        Write(buffer.AsSpan(offset, count));

    public override void Write(ReadOnlySpan<byte> bytes)
    {
        if (buffer.Length + bytes.Length > limit)
            throw new LimitExceededException();
        buffer.Write(bytes);
    }

    public override void WriteByte(byte value) => Write([value]);

    public override Task WriteAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken
    )
    {
        Write(buffer.AsSpan(offset, count));
        return Task.CompletedTask;
    }

    public override ValueTask WriteAsync(
        ReadOnlyMemory<byte> bytes,
        CancellationToken cancellationToken = default
    )
    {
        Write(bytes.Span);
        return ValueTask.CompletedTask;
    }

    public override void Flush() { }

    public override int Read(byte[] buffer, int offset, int count) =>
        throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            buffer.Dispose();
        base.Dispose(disposing);
    }

    public sealed class LimitExceededException : IOException;
}

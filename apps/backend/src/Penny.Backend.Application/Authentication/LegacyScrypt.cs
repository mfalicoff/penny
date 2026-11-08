using System.Buffers.Binary;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Penny.Backend.Application.Authentication;

// RFC 7914 scrypt with the legacy Node `crypto.scrypt(password, salt, 64)` defaults
// (N=16384, r=8, p=1). Both the password and the hex salt are hashed as their UTF-8
// text, exactly as Node does for string inputs. Changing any parameter locks out
// every existing account, so this is fixed rather than configurable.
public static class LegacyScrypt
{
    public const int Cost = 16384;
    public const int BlockSize = 8;
    public const int Parallelization = 1;
    public const int KeyLength = 64;

    public static byte[] Derive(ReadOnlySpan<byte> password, ReadOnlySpan<byte> salt) =>
        Derive(password, salt, Cost, BlockSize, Parallelization, KeyLength);

    public static byte[] Derive(
        ReadOnlySpan<byte> password,
        ReadOnlySpan<byte> salt,
        int cost,
        int blockSize,
        int parallelization,
        int keyLength
    )
    {
        if (cost < 2 || !BitOperations.IsPow2(cost))
            throw new ArgumentOutOfRangeException(nameof(cost));
        ArgumentOutOfRangeException.ThrowIfLessThan(blockSize, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(parallelization, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(keyLength, 1);
        var blockBytes = 128 * blockSize;
        var blocks = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            1,
            HashAlgorithmName.SHA256,
            blockBytes * parallelization
        );
        var words = 32 * blockSize;
        var x = new uint[words];
        var scratch = new uint[words];
        var table = new uint[words * cost];
        try
        {
            for (var i = 0; i < parallelization; i++)
            {
                var block = blocks.AsSpan(i * blockBytes, blockBytes);
                for (var w = 0; w < words; w++)
                    x[w] = BinaryPrimitives.ReadUInt32LittleEndian(block[(w * 4)..]);
                RoMix(x, scratch, table, cost, blockSize);
                for (var w = 0; w < words; w++)
                    BinaryPrimitives.WriteUInt32LittleEndian(block[(w * 4)..], x[w]);
            }
            return Rfc2898DeriveBytes.Pbkdf2(
                password,
                blocks,
                1,
                HashAlgorithmName.SHA256,
                keyLength
            );
        }
        finally
        {
            CryptographicOperations.ZeroMemory(blocks);
            CryptographicOperations.ZeroMemory(MemoryMarshal.AsBytes(x.AsSpan()));
            CryptographicOperations.ZeroMemory(MemoryMarshal.AsBytes(scratch.AsSpan()));
            CryptographicOperations.ZeroMemory(MemoryMarshal.AsBytes(table.AsSpan()));
        }
    }

    private static void RoMix(uint[] x, uint[] scratch, uint[] table, int cost, int blockSize)
    {
        var words = x.Length;
        for (var i = 0; i < cost; i++)
        {
            x.CopyTo(table, i * words);
            BlockMix(x, scratch, blockSize);
        }
        for (var i = 0; i < cost; i++)
        {
            // Integerify: the low word of the last 64-byte sub-block; cost is a power of 2.
            var j = (int)(x[words - 16] & (uint)(cost - 1));
            var row = table.AsSpan(j * words, words);
            for (var w = 0; w < words; w++)
                x[w] ^= row[w];
            BlockMix(x, scratch, blockSize);
        }
    }

    private static void BlockMix(uint[] b, uint[] y, int blockSize)
    {
        Span<uint> state = stackalloc uint[16];
        b.AsSpan((2 * blockSize - 1) * 16, 16).CopyTo(state);
        for (var i = 0; i < 2 * blockSize; i++)
        {
            for (var w = 0; w < 16; w++)
                state[w] ^= b[i * 16 + w];
            Salsa208(state);
            // Even sub-blocks go to the first half of the output, odd to the second.
            var target = (i / 2 + (i % 2) * blockSize) * 16;
            state.CopyTo(y.AsSpan(target, 16));
        }
        y.CopyTo(b, 0);
    }

    private static void Salsa208(Span<uint> b)
    {
        Span<uint> x = stackalloc uint[16];
        b.CopyTo(x);
        for (var round = 0; round < 8; round += 2)
        {
            x[4] ^= BitOperations.RotateLeft(x[0] + x[12], 7);
            x[8] ^= BitOperations.RotateLeft(x[4] + x[0], 9);
            x[12] ^= BitOperations.RotateLeft(x[8] + x[4], 13);
            x[0] ^= BitOperations.RotateLeft(x[12] + x[8], 18);
            x[9] ^= BitOperations.RotateLeft(x[5] + x[1], 7);
            x[13] ^= BitOperations.RotateLeft(x[9] + x[5], 9);
            x[1] ^= BitOperations.RotateLeft(x[13] + x[9], 13);
            x[5] ^= BitOperations.RotateLeft(x[1] + x[13], 18);
            x[14] ^= BitOperations.RotateLeft(x[10] + x[6], 7);
            x[2] ^= BitOperations.RotateLeft(x[14] + x[10], 9);
            x[6] ^= BitOperations.RotateLeft(x[2] + x[14], 13);
            x[10] ^= BitOperations.RotateLeft(x[6] + x[2], 18);
            x[3] ^= BitOperations.RotateLeft(x[15] + x[11], 7);
            x[7] ^= BitOperations.RotateLeft(x[3] + x[15], 9);
            x[11] ^= BitOperations.RotateLeft(x[7] + x[3], 13);
            x[15] ^= BitOperations.RotateLeft(x[11] + x[7], 18);
            x[1] ^= BitOperations.RotateLeft(x[0] + x[3], 7);
            x[2] ^= BitOperations.RotateLeft(x[1] + x[0], 9);
            x[3] ^= BitOperations.RotateLeft(x[2] + x[1], 13);
            x[0] ^= BitOperations.RotateLeft(x[3] + x[2], 18);
            x[6] ^= BitOperations.RotateLeft(x[5] + x[4], 7);
            x[7] ^= BitOperations.RotateLeft(x[6] + x[5], 9);
            x[4] ^= BitOperations.RotateLeft(x[7] + x[6], 13);
            x[5] ^= BitOperations.RotateLeft(x[4] + x[7], 18);
            x[11] ^= BitOperations.RotateLeft(x[10] + x[9], 7);
            x[8] ^= BitOperations.RotateLeft(x[11] + x[10], 9);
            x[9] ^= BitOperations.RotateLeft(x[8] + x[11], 13);
            x[10] ^= BitOperations.RotateLeft(x[9] + x[8], 18);
            x[12] ^= BitOperations.RotateLeft(x[15] + x[14], 7);
            x[13] ^= BitOperations.RotateLeft(x[12] + x[15], 9);
            x[14] ^= BitOperations.RotateLeft(x[13] + x[12], 13);
            x[15] ^= BitOperations.RotateLeft(x[14] + x[13], 18);
        }
        for (var i = 0; i < 16; i++)
            b[i] += x[i];
        x.Clear();
    }
}

using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Penny.Backend.Persistence.Import;

// SHA-256 over every mapped column of every row, ordered by primary key. The same
// digest is computed for the rows derived from the source and the rows read back.
internal static class ImportDigest
{
    public static ImportTableReport Compute(IEntityType type, IEnumerable<object> rows)
    {
        var properties = type.GetProperties().ToArray();
        var keys = type.FindPrimaryKey()!.Properties;
        var ordered = rows.Select(row =>
                (Key: keys.Select(k => k.PropertyInfo!.GetValue(row)).ToArray(), Row: row)
            )
            .Order(Comparer<(object?[] Key, object Row)>.Create(CompareKeys))
            .ToList();
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var (_, row) in ordered)
        foreach (var property in properties)
            Append(hash, Canonical(property, property.PropertyInfo!.GetValue(row)));
        return new(
            type.GetTableName()!,
            ordered.Count,
            Convert.ToHexString(hash.GetHashAndReset())
        );
    }

    public static ImportTableReport Receipts(IEnumerable<ReceiptEvidence> receipts)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long count = 0;
        foreach (var receipt in receipts.OrderBy(r => r.Id, StringComparer.Ordinal))
        {
            foreach (
                var value in new[]
                {
                    receipt.Id,
                    receipt.UserId,
                    receipt.Name,
                    receipt.Mime,
                    receipt.SizeBytes.ToString(CultureInfo.InvariantCulture),
                    receipt.ContentSha256,
                }
            )
                Append(hash, [1, .. Encoding.UTF8.GetBytes(value)]);
            count++;
        }
        return new("receipts", count, Convert.ToHexString(hash.GetHashAndReset()));
    }

    private static byte[] Canonical(IProperty property, object? value) =>
        value switch
        {
            null => [0],
            byte[] bytes => [1, .. bytes],
            string json when property.GetColumnType() == "jsonb" =>
            [
                1,
                .. ImportValue.CanonicalJson(json),
            ],
            string text => [1, .. Encoding.UTF8.GetBytes(text)],
            DateTimeOffset time => Text(time.ToUnixTimeMilliseconds()),
            DateOnly date =>
            [
                1,
                .. Encoding.UTF8.GetBytes(
                    date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                ),
            ],
            bool flag => [1, flag ? (byte)1 : (byte)0],
            IFormattable number =>
            [
                1,
                .. Encoding.UTF8.GetBytes(number.ToString(null, CultureInfo.InvariantCulture)),
            ],
            _ => throw new InvalidOperationException("Unsupported column type in import digest."),
        };

    private static byte[] Text(long value) =>
        [1, .. Encoding.UTF8.GetBytes(value.ToString(CultureInfo.InvariantCulture))];

    private static void Append(IncrementalHash hash, byte[] bytes)
    {
        Span<byte> size = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(size, bytes.LongLength);
        hash.AppendData(size);
        hash.AppendData(bytes);
    }

    private static int CompareKeys((object?[] Key, object Row) x, (object?[] Key, object Row) y)
    {
        for (var index = 0; index < x.Key.Length; index++)
        {
            var result = (x.Key[index], y.Key[index]) switch
            {
                (string a, string b) => string.CompareOrdinal(a, b),
                (IComparable a, var b) => a.CompareTo(b),
                _ => 0,
            };
            if (result != 0)
                return result;
        }
        return 0;
    }
}

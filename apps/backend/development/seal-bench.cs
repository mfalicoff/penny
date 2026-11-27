#:property RestorePackagesWithLockFile=false
// Seal and open costs for the ledger encryption design (ADR 006 in
// docs/reference/architecture.md). A .NET file-based app with no packages:
//
//   node --input-type=module -e "import { syntheticLedger } from './apps/web/scripts/ledger-bench/synthetic.ts';
//     import { writeFileSync } from 'node:fs';
//     for (const n of [2000, 50000, 100000]) writeFileSync('/tmp/ledger-' + n + '.json', JSON.stringify(syntheticLedger({ entries: n })));"
//   dotnet run apps/backend/development/seal-bench.cs -- /tmp/ledger-2000.json /tmp/ledger-50000.json /tmp/ledger-100000.json
//
// It measures, in process and without PostgreSQL: unwrapping a data key, sealing and
// opening every sensitive field of a ledger with AES-256-GCM (the envelope of the ADR),
// the bytes added, an in-memory search over the decrypted documents (cold: decrypt
// first; warm: from a cache), keyed trigram tokens (the blind-index alternative) and a
// brute-force cosine scan over 384-dimension vectors (the sealed-embedding alternative).
// Every value is synthetic. Nothing is written.
using System.Diagnostics;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const int Runs = 7;
var files = args.Length > 0 ? args : ["/tmp/ledger-2000.json"];
Console.WriteLine($"{RuntimeInformation()}; median of {Runs} runs after one warm-up");
Console.WriteLine();
Console.WriteLine(
    "| Entries | Fields | Plain KiB | Sealed KiB | Unwrap µs | Seal ms | Open ms | Search cold ms | Search warm ms | Trigram tokens | Tokens ms | Vector scan ms |"
);
Console.WriteLine("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
foreach (var file in files)
    Measure(file);

static void Measure(string file)
{
    using var json = JsonDocument.Parse(File.ReadAllBytes(file));
    var root = json.RootElement;
    var fields = new List<Field>();
    var categories = new Dictionary<string, string>();
    var accounts = new Dictionary<string, string>();
    foreach (var account in root.GetProperty("accounts").EnumerateArray())
    {
        var id = account.GetProperty("id").GetString()!;
        accounts[id] = account.GetProperty("name").GetString()!;
        fields.Add(new("ledger_accounts", "name", id, accounts[id]));
    }
    foreach (var category in root.GetProperty("categories").EnumerateArray())
    {
        var id = category.GetProperty("id").GetString()!;
        categories[id] = category.GetProperty("name").GetString()!;
        fields.Add(new("ledger_categories", "name", id, categories[id]));
        fields.Add(new("ledger_categories", "icon", id, category.GetProperty("icon").GetString()!));
    }
    foreach (var trip in root.GetProperty("trips").EnumerateArray())
        fields.Add(
            new(
                "ledger_trips",
                "name",
                trip.GetProperty("id").GetString()!,
                trip.GetProperty("name").GetString()!
            )
        );
    foreach (var rule in root.GetProperty("recurring").EnumerateArray())
    {
        var id = rule.GetProperty("id").GetString()!;
        fields.Add(new("ledger_recurring", "title", id, rule.GetProperty("title").GetString()!));
        fields.Add(new("ledger_recurring", "note", id, Text(rule, "note")));
    }
    var documents = new List<string>();
    foreach (var entry in root.GetProperty("transactions").EnumerateArray())
    {
        var id = entry.GetProperty("id").GetString()!;
        var title = entry.GetProperty("title").GetString()!;
        var note = Text(entry, "note");
        fields.Add(new("ledger_entries", "title", id, title));
        fields.Add(new("ledger_entries", "note", id, note));
        var category = categories.GetValueOrDefault(Text(entry, "categoryId"), "");
        var account = accounts.GetValueOrDefault(Text(entry, "accountId"), "");
        documents.Add(Normalize($"{title} {note} {category} {account}"));
    }
    var entries = documents.Count;

    var kek = RandomNumberGenerator.GetBytes(32);
    var dek = RandomNumberGenerator.GetBytes(32);
    var wrapped = Envelope.Seal(kek, dek, Aad("data_keys", "dek", "user", "bench-user", "1"));

    var unwrapMicros =
        Median(() =>
        {
            for (var i = 0; i < 1000; i++)
                Envelope.Open(kek, wrapped, Aad("data_keys", "dek", "user", "bench-user", "1"));
        })
        * 1000
        / 1000;

    byte[][] sealedFields = [];
    var sealMs = Median(() =>
    {
        using var aes = new AesGcm(dek, Envelope.TagBytes);
        sealedFields = fields
            .Select(field => Envelope.Seal(aes, Encoding.UTF8.GetBytes(field.Value), field.Aad))
            .ToArray();
    });
    var openMs = Median(() =>
    {
        using var aes = new AesGcm(dek, Envelope.TagBytes);
        for (var i = 0; i < fields.Count; i++)
            Envelope.Open(aes, sealedFields[i], fields[i].Aad);
    });
    var plainBytes = fields.Sum(field => Encoding.UTF8.GetByteCount(field.Value));
    var sealedBytes = sealedFields.Sum(field => (long)field.Length);

    // In-memory search: decrypt the entry fields, rebuild the documents, scan.
    string[] queries = ["coffee", "groceries", "esspresso", "a", "zzzz-no-match"];
    var entryFields = fields
        .Select((field, index) => (field, index))
        .Where(item => item.field.Table == "ledger_entries")
        .ToArray();
    var coldMs = Median(() =>
    {
        using var aes = new AesGcm(dek, Envelope.TagBytes);
        var texts = new string[entryFields.Length];
        for (var i = 0; i < entryFields.Length; i++)
            texts[i] = Encoding.UTF8.GetString(
                Envelope.Open(aes, sealedFields[entryFields[i].index], entryFields[i].field.Aad)
            );
        var built = new string[entries];
        for (var i = 0; i < entries; i++)
            built[i] = Normalize(texts[2 * i] + " " + texts[2 * i + 1]);
        Scan(built, queries[0]);
    });
    var warmMs =
        Median(() =>
        {
            foreach (var query in queries)
                Scan(documents, query);
        }) / queries.Length;

    // Blind index: HMAC-SHA256 of each distinct trigram, truncated to 32 bits.
    var tokenKey = RandomNumberGenerator.GetBytes(32);
    long tokens = 0;
    var tokensMs = Median(() =>
    {
        tokens = 0;
        using var hmac = new HMACSHA256(tokenKey);
        Span<byte> hash = stackalloc byte[32];
        foreach (var document in documents)
        {
            var padded = "  " + document + " ";
            var seen = new HashSet<string>();
            for (var i = 0; i + 3 <= padded.Length; i++)
            {
                var trigram = padded.Substring(i, 3);
                if (!seen.Add(trigram))
                    continue;
                hmac.TryComputeHash(Encoding.UTF8.GetBytes(trigram), hash, out _);
                tokens++;
            }
        }
    });

    // Sealed embeddings: brute-force cosine over unit vectors, keep the best 200.
    var random = new Random(186);
    var vectors = new float[entries * 384];
    for (var i = 0; i < vectors.Length; i++)
        vectors[i] = (float)(random.NextDouble() - 0.5);
    var query = new float[384];
    for (var i = 0; i < query.Length; i++)
        query[i] = (float)(random.NextDouble() - 0.5);
    var vectorMs = Median(() =>
    {
        var scores = new float[entries];
        for (var i = 0; i < entries; i++)
            scores[i] = Dot(vectors.AsSpan(i * 384, 384), query);
        var best = new PriorityQueue<int, float>();
        for (var i = 0; i < entries; i++)
        {
            best.Enqueue(i, scores[i]);
            if (best.Count > 200)
                best.Dequeue();
        }
    });

    Console.WriteLine(
        string.Create(
            CultureInfo.InvariantCulture,
            $"| {entries:N0} | {fields.Count:N0} | {plainBytes / 1024.0:F0} | {sealedBytes / 1024.0:F0} | {unwrapMicros:F1} | {sealMs:F1} | {openMs:F1} | {coldMs:F1} | {warmMs:F1} | {tokens:N0} | {tokensMs:F0} | {vectorMs:F1} |"
        )
    );
}

static float Dot(ReadOnlySpan<float> left, ReadOnlySpan<float> right)
{
    var sum = Vector<float>.Zero;
    var width = Vector<float>.Count;
    for (var i = 0; i < left.Length; i += width)
        sum += new Vector<float>(left[i..]) * new Vector<float>(right[i..]);
    return Vector.Sum(sum);
}

static int Scan(IReadOnlyList<string> documents, string query)
{
    var count = 0;
    foreach (var document in documents)
        if (document.Contains(query, StringComparison.Ordinal))
            count++;
    return count;
}

static string Text(JsonElement element, string name) =>
    element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
        ? value.GetString()!
        : "";

// The search normalization of docs/reference/search.md, close enough for timing.
static string Normalize(string text)
{
    var decomposed = text.Normalize(NormalizationForm.FormKD);
    var builder = new StringBuilder(decomposed.Length);
    foreach (var c in decomposed)
        if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            builder.Append(char.ToLowerInvariant(c));
    return string.Join(
        ' ',
        builder.ToString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
    );
}

static byte[] Aad(string table, string column, string scope, string owner, string row) =>
    Encoding.UTF8.GetBytes($"penny/field/v1\0{table}\0{column}\0{scope}\0{owner}\0{row}");

static double Median(Action action)
{
    action();
    var times = new double[Runs];
    for (var i = 0; i < Runs; i++)
    {
        var watch = Stopwatch.StartNew();
        action();
        times[i] = watch.Elapsed.TotalMilliseconds;
    }
    Array.Sort(times);
    return times[Runs / 2];
}

static string RuntimeInformation() =>
    $"{System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}, {System.Runtime.InteropServices.RuntimeInformation.OSDescription}, {Environment.ProcessorCount} CPUs";

sealed record Field(string Table, string Column, string Row, string Value)
{
    public byte[] Aad { get; } =
        Encoding.UTF8.GetBytes($"penny/field/v1\0{Table}\0{Column}\0user\0bench-user\0{Row}");
}

// version (1) | data key version (4, big-endian) | nonce (12) | ciphertext | tag (16)
static class Envelope
{
    public const int TagBytes = 16;
    private const int NonceBytes = 12;
    private const int Header = 1 + 4 + NonceBytes;

    public static byte[] Seal(byte[] key, ReadOnlySpan<byte> plain, byte[] aad)
    {
        using var aes = new AesGcm(key, TagBytes);
        return Seal(aes, plain, aad);
    }

    public static byte[] Seal(AesGcm aes, ReadOnlySpan<byte> plain, byte[] aad)
    {
        var output = new byte[Header + plain.Length + TagBytes];
        output[0] = 1;
        output[4] = 1;
        RandomNumberGenerator.Fill(output.AsSpan(5, NonceBytes));
        aes.Encrypt(
            output.AsSpan(5, NonceBytes),
            plain,
            output.AsSpan(Header, plain.Length),
            output.AsSpan(Header + plain.Length),
            aad
        );
        return output;
    }

    public static byte[] Open(byte[] key, byte[] sealedValue, byte[] aad)
    {
        using var aes = new AesGcm(key, TagBytes);
        return Open(aes, sealedValue, aad);
    }

    public static byte[] Open(AesGcm aes, byte[] sealedValue, byte[] aad)
    {
        var length = sealedValue.Length - Header - TagBytes;
        var plain = new byte[length];
        aes.Decrypt(
            sealedValue.AsSpan(5, NonceBytes),
            sealedValue.AsSpan(Header, length),
            sealedValue.AsSpan(Header + length),
            plain,
            aad
        );
        return plain;
    }
}

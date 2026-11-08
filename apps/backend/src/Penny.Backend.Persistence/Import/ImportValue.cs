using System.Globalization;
using System.Text;
using System.Text.Json;
using NpgsqlTypes;

namespace Penny.Backend.Persistence.Import;

internal static class ImportValue
{
    private static readonly UTF8Encoding Utf8 = new(false, true);

    public static object Read(ImportColumn column, object value, string storageType)
    {
        if (storageType == "null")
            return column.Nullable ? DBNull.Value : throw new ImportFailure("required-value");
        if (column.Type is NpgsqlDbType.Bigint or NpgsqlDbType.Boolean)
        {
            if (
                storageType != "integer"
                || value is not long integer
                || integer is < -9007199254740991 or > 9007199254740991
            )
                throw new ImportFailure("invalid-integer");
            if (column.Type == NpgsqlDbType.Boolean)
                return integer is 0 or 1
                    ? integer == 1
                    : throw new ImportFailure("invalid-boolean");
            return integer;
        }
        if (column.Type == NpgsqlDbType.Bytea)
            return storageType == "blob" && value is byte[]
                ? value
                : throw new ImportFailure("invalid-binary");
        if (storageType != "text" || value is not byte[] raw)
            throw new ImportFailure("invalid-text");
        var text = Utf8.GetString(raw);
        if (text.Contains('\0', StringComparison.Ordinal))
            throw new ImportFailure("unsupported-text");
        if (column.Type == NpgsqlDbType.Date)
            return
                DateOnly.TryParseExact(
                    text,
                    "yyyy-MM-dd",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var date
                ) && date.Year is >= 2000 and <= 2100
                ? date
                : throw new ImportFailure("invalid-date");
        if (column.Type == NpgsqlDbType.Jsonb)
        {
            using var json = JsonDocument.Parse(text);
            ValidateJson(json.RootElement);
            if (column.Name == "data")
                LedgerImportValidator.Validate(json.RootElement);
        }
        return text;
    }

    private static void ValidateJson(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in value.EnumerateObject())
            {
                if (!names.Add(item.Name))
                    throw new ImportFailure("duplicate-json-property");
                ValidateText(item.Name);
                ValidateJson(item.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
                ValidateJson(item);
        }
        else if (value.ValueKind == JsonValueKind.String)
            ValidateText(value.GetString()!);
        else if (
            value.ValueKind == JsonValueKind.Number
            && (!value.TryGetDecimal(out _) || !double.IsFinite(value.GetDouble()))
        )
            throw new ImportFailure("unsupported-json-number");
    }

    private static void ValidateText(string value)
    {
        if (value.Contains('\0', StringComparison.Ordinal))
            throw new ImportFailure("unsupported-jsonb-text");
        Utf8.GetByteCount(value); // Reject unpaired surrogates rather than replacing them.
    }

    public static DateTimeOffset Time(long milliseconds)
    {
        try
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new ImportFailure("invalid-timestamp");
        }
    }

    // Property-order-independent JSON with normalized numbers, as PostgreSQL jsonb stores it.
    public static byte[] CanonicalJson(string value)
    {
        using var json = JsonDocument.Parse(value);
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output))
            WriteJson(writer, json.RootElement);
        return output.ToArray();
    }

    private static void WriteJson(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (
                var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)
            )
            {
                writer.WritePropertyName(property.Name);
                WriteJson(writer, property.Value);
            }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray())
                WriteJson(writer, item);
            writer.WriteEndArray();
        }
        else if (value.ValueKind == JsonValueKind.Number)
            writer.WriteRawValue(value.GetDecimal().ToString("G29", CultureInfo.InvariantCulture));
        else
            value.WriteTo(writer);
    }
}

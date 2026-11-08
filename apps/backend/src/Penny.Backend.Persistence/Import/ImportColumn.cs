using NpgsqlTypes;

namespace Penny.Backend.Persistence.Import;

internal sealed record ImportColumn(string Name, NpgsqlDbType Type, bool Nullable);

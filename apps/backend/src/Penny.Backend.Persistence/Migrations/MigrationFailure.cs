using System.Net.Sockets;
using Npgsql;

namespace Penny.Backend.Persistence.Migrations;

// Why a migration failed, for the `migrate` command and the startup migration, without
// credentials, SQL or row values: the exception type, then Penny's own message
// (DatabaseSetupException), the PostgreSQL SQLSTATE and its condition name, or Npgsql's
// client-side message and socket error. Server message texts are never included: they
// can quote values. Other exceptions (EF, I/O) are reduced to their type.
public static class MigrationFailure
{
    public static string Describe(Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        var type = error.GetType().Name;
        var detail = Detail(error);
        return detail is null ? type : $"{type}: {detail}";
    }

    private static string? Detail(Exception error)
    {
        for (Exception? current = error; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                case DatabaseSetupException setup:
                    return setup.Message;
                case PostgresException postgres:
                    return $"SQLSTATE {postgres.SqlState} ({Condition(postgres.SqlState)})";
                // Npgsql's own client-side messages are fixed texts (at most the host and
                // port it tried), never the password or connection string.
                case NpgsqlException client when client.InnerException is not PostgresException:
                    return client.InnerException is SocketException inner
                        ? $"{client.Message} (socket error {inner.SocketErrorCode})"
                        : client.Message;
                case SocketException socket:
                    return $"socket error {socket.SocketErrorCode}";
                case TimeoutException:
                    return "timed out";
            }
        }
        return error is OperationCanceledException ? "cancelled" : null;
    }

    // Condition names from PostgreSQL's errcodes table, for the codes a migration meets;
    // other codes fall back to their class.
    internal static string Condition(string sqlState) =>
        sqlState switch
        {
            "08001" => "sqlclient_unable_to_establish_sqlconnection",
            "08006" => "connection_failure",
            "0A000" => "feature_not_supported",
            "23505" => "unique_violation",
            "28000" => "invalid_authorization_specification",
            "28P01" => "invalid_password",
            "3D000" => "invalid_catalog_name",
            "3F000" => "invalid_schema_name",
            "40001" => "serialization_failure",
            "40P01" => "deadlock_detected",
            "42501" => "insufficient_privilege",
            "42601" => "syntax_error",
            "42703" => "undefined_column",
            "42704" => "undefined_object",
            "42710" => "duplicate_object",
            "42P01" => "undefined_table",
            "42P06" => "duplicate_schema",
            "42P07" => "duplicate_table",
            "53100" => "disk_full",
            "53200" => "out_of_memory",
            "53300" => "too_many_connections",
            "55P03" => "lock_not_available",
            "57014" => "query_canceled",
            "57P01" => "admin_shutdown",
            "57P03" => "cannot_connect_now",
            "58P01" => "undefined_file",
            _ => sqlState.Length >= 2 ? Class(sqlState[..2]) : "unknown",
        };

    private static string Class(string code) =>
        code switch
        {
            "08" => "connection exception",
            "0A" => "feature not supported",
            "22" => "data exception",
            "23" => "integrity constraint violation",
            "25" => "invalid transaction state",
            "28" => "invalid authorization specification",
            "3D" => "invalid catalog name",
            "3F" => "invalid schema name",
            "40" => "transaction rollback",
            "42" => "syntax error or access rule violation",
            "53" => "insufficient resources",
            "54" => "program limit exceeded",
            "55" => "object not in prerequisite state",
            "57" => "operator intervention",
            "58" => "system error",
            "XX" => "internal error",
            _ => "unknown",
        };
}

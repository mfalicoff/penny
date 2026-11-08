using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

namespace Penny.Backend.Persistence.Import;

public static class SqliteSnapshot
{
    public static string Create(string sourcePath, string snapshotPath)
    {
        // Reserve without overwrite. Only the destination is ever opened writable.
        using (
            var reserved = new FileStream(
                snapshotPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None
            )
        ) { }
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(snapshotPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        using (var source = OpenReadOnly(sourcePath))
        using (
            var destination = new SqliteConnection(
                new SqliteConnectionStringBuilder
                {
                    DataSource = snapshotPath,
                    Mode = SqliteOpenMode.ReadWrite,
                    Pooling = false,
                }.ToString()
            )
        )
        {
            destination.Open();
            source.BackupDatabase(destination);
            using var seal = destination.CreateCommand();
            seal.CommandText = "PRAGMA journal_mode=DELETE; PRAGMA integrity_check;";
            seal.ExecuteNonQuery();
        }
        return Hash(snapshotPath);
    }

    public static string Hash(string path)
    {
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(SHA256.HashData(file));
    }

    internal static SqliteConnection OpenReadOnly(string path)
    {
        var connection = new SqliteConnection(
            new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
                DefaultTimeout = 5,
            }.ToString()
        );
        try
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA query_only=ON; PRAGMA foreign_keys=ON;";
            command.ExecuteNonQuery();
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }
}

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Exports;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Application.Profiles;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Api.Exports;

// The full export (MAZ-152): one ZIP with everything on the server that belongs to the
// person. JSON files use the API's own shapes (contracts/openapi.json), so they read like
// the API's answers:
//
//   README.txt                  what each file holds
//   profile.json                the profile, who manages the name and picture, the picture's file
//   profile/picture.webp        the picture, when there is one
//   ledger.json                 the personal ledger (GET /api/ledger)
//   entries.csv                 personal entries and your share of shared expenses
//   households/NN-name.json     each household and trip joined: members, the expenses
//                               they can see with everyone's share, shared schedules and
//                               the history
//   receipts/id-name            each receipt they uploaded, as the original file
//
// The ZIP is written to a temporary file that is deleted when the download closes, so
// the server keeps no copy.
public sealed class AccountExport(
    ProfileService profiles,
    LedgerService ledgers,
    HouseholdService households,
    SharedExpenseService expenses,
    SharedRecurrenceService recurrence,
    SettlementService settlement,
    IReceiptRepository receipts,
    TimeProvider clock
)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public string FileName() => $"penny-export-{clock.GetUtcNow().UtcDateTime:yyyy-MM-dd}.zip";

    public static string EntriesFileName(string? period, DateTimeOffset now) =>
        $"penny-entries-{period ?? now.UtcDateTime.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)}.csv";

    // The entries CSV for a month (YYYY-MM), a year (YYYY) or everything.
    public async Task<string> EntriesAsync(
        string userId,
        string? month,
        string? year,
        CancellationToken cancellationToken
    )
    {
        // The projection validates the period (400 otherwise).
        var shared = await expenses.ProjectionAsync(userId, month, year, cancellationToken);
        var ledger = await ledgers.ReadAsync(userId, cancellationToken);
        return EntriesCsv.Build(ledger.Ledger, shared.Transactions, month ?? year);
    }

    // Writes the ZIP to a temporary file and returns it at its start; disposing the
    // stream deletes the file.
    public async Task<Stream> WriteAsync(string userId, CancellationToken cancellationToken)
    {
        var path = Path.Combine(Path.GetTempPath(), $"penny-export-{Guid.NewGuid():N}.zip");
        var file = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            81920,
            FileOptions.DeleteOnClose | FileOptions.Asynchronous
        );
        try
        {
            await using (
                var zip = await ZipArchive.CreateAsync(
                    file,
                    ZipArchiveMode.Create,
                    leaveOpen: true,
                    entryNameEncoding: Encoding.UTF8,
                    cancellationToken
                )
            )
                await FillAsync(zip, userId, cancellationToken);
            file.Position = 0;
            return file;
        }
        catch
        {
            await file.DisposeAsync();
            throw;
        }
    }

    private async Task FillAsync(ZipArchive zip, string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await TextAsync(zip, "README.txt", Readme, cancellationToken);

        var profile = await profiles.GetAsync(userId, cancellationToken);
        string? picture = null;
        if (profile.AvatarVersion is not null)
        {
            try
            {
                var avatar = await profiles.ReadAvatarAsync(userId, userId, cancellationToken);
                picture = "profile/picture.webp";
                await BytesAsync(zip, picture, avatar.Content, cancellationToken);
            }
            catch (BackendFailure failure) when (failure.Kind == FailureKind.NotFound)
            {
                // Removed while the export ran.
            }
        }
        await JsonAsync(
            zip,
            "profile.json",
            new
            {
                exportedAt = now,
                profile = ProfileResponse.From(profile),
                name = new
                {
                    value = profile.DisplayName,
                    managedBy = profile.NameEditable ? "you" : "signInProvider",
                },
                picture = new
                {
                    file = picture,
                    managedBy = profile.AvatarEditable ? "you" : "signInProvider",
                },
            },
            cancellationToken
        );

        var ledger = await ledgers.ReadAsync(userId, cancellationToken);
        await JsonAsync(zip, "ledger.json", LedgerSnapshotResponse.From(ledger), cancellationToken);
        var shared = await expenses.ProjectionAsync(userId, null, null, cancellationToken);
        await TextAsync(
            zip,
            "entries.csv",
            EntriesCsv.Build(ledger.Ledger, shared.Transactions, null),
            cancellationToken
        );

        var joined = await households.ListJoinedAsync(userId, cancellationToken);
        for (var index = 0; index < joined.Count; index++)
        {
            var household = joined[index];
            var detail = await households.GetAsync(household.Id, userId, cancellationToken);
            var list = await expenses.ListAsync(household.Id, userId, null, cancellationToken);
            var rules = await recurrence.ListAsync(household.Id, userId, cancellationToken);
            var history = await settlement.AuditAsync(
                household.Id,
                userId,
                null,
                cancellationToken
            );
            await JsonAsync(
                zip,
                $"households/{index + 1:D2}-{SafeName(household.Name, "household")}.json",
                new
                {
                    household = HouseholdResponse.From(detail.Household),
                    members = detail.Members.Select(HouseholdMemberResponse.From),
                    expenses = list.Select(ExpenseResponse.From),
                    recurring = rules.Select(SharedRuleResponse.From),
                    history = history.Select(AuditEventResponse.From),
                },
                cancellationToken
            );
        }

        foreach (var receiptId in await receipts.ListOwnedAsync(userId, cancellationToken))
        {
            var receipt = await receipts.ReadAsync(userId, receiptId, cancellationToken);
            if (receipt is null)
                continue;
            await BytesAsync(
                zip,
                $"receipts/{receipt.Id}-{SafeName(receipt.Name, "receipt")}",
                receipt.Data,
                cancellationToken
            );
        }
    }

    // A file name that works on every system: letters, digits, dots, dashes and
    // underscores, at most 80 characters.
    public static string SafeName(string name, string fallback)
    {
        var safe = new StringBuilder();
        foreach (var character in name.Normalize(NormalizationForm.FormC))
        {
            if (char.IsLetterOrDigit(character) || character is '.' or '-' or '_')
                safe.Append(character);
            else if (safe.Length > 0 && safe[^1] != '-')
                safe.Append('-');
            if (safe.Length >= 80)
                break;
        }
        var text = safe.ToString().Trim('-', '.');
        return text.Length == 0 ? fallback : text;
    }

    private static Task JsonAsync(
        ZipArchive zip,
        string name,
        object value,
        CancellationToken cancellationToken
    ) => BytesAsync(zip, name, JsonSerializer.SerializeToUtf8Bytes(value, Json), cancellationToken);

    private static Task TextAsync(
        ZipArchive zip,
        string name,
        string text,
        CancellationToken cancellationToken
    ) => BytesAsync(zip, name, Encoding.UTF8.GetBytes(text), cancellationToken);

    private static async Task BytesAsync(
        ZipArchive zip,
        string name,
        ReadOnlyMemory<byte> content,
        CancellationToken cancellationToken
    )
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        await using var stream = await entry.OpenAsync(cancellationToken);
        await stream.WriteAsync(content, cancellationToken);
    }

    private const string Readme = """
        Your Penny data

        profile.json          Your profile: email, name and picture, and who manages each
                              ("you", or "signInProvider" when your sign-in provider sends it).
        profile/picture.webp  Your picture, if you have one.
        ledger.json           Your personal ledger: accounts, categories, entries, schedules
                              and trips. Amounts are in cents.
        entries.csv           Your entries and your share of shared expenses, for a spreadsheet.
        households/           Each household and trip you joined: its members, the expenses
                              you can see with everyone's share, its schedules and its history.
        receipts/             Each receipt you uploaded, as the original file.

        """;
}

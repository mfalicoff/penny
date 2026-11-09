using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Delivery of the household notification outbox over real PostgreSQL with
// deterministic fake providers (MAZ-61): recipients and actor exclusion, deep-link
// payloads, Expo/APNs coexistence and environment routing, retries, permanent
// failures, invalid-token cleanup, logout/expiry, expiry of old messages and Expo
// receipts. All tokens and data are synthetic.
public sealed class PushDeliveryTests(ApiFixture fixture) : PushTestBase(fixture)
{
    [Fact]
    public async Task whenMemberAddsExpense_RunOnce_ShouldNotifyOtherMembersDevicesOnceWithDeepLink()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterExpoAsync(alex.Token);
        await RegisterExpoAsync(sam.Token, "ExponentPushToken[sam_phone]");
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "sandbox");
        await RegisterApnsAsync(sam.Token, ApnsToken(2), "production");

        var expense = await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        var run = await Runner().RunOnceAsync(Ct);

        run.Accepted.ShouldBe(3);
        (await Expo.SentToAsync(ExpoToken)).ShouldBeEmpty("the actor is never notified");
        var expo = (await Expo.SentToAsync("ExponentPushToken[sam_phone]")).Single();
        expo.Environment.ShouldBeNull();
        expo.Title.ShouldBe("New household expense");
        expo.Payload.ShouldBe(
            new PushPayload(householdId, "2026-09", Id(expense), expo.Payload.EventId)
        );
        var sandbox = (await Apns.SentToAsync(ApnsToken(1))).Single();
        var production = (await Apns.SentToAsync(ApnsToken(2))).Single();
        sandbox.Environment.ShouldBe(PushProviders.Sandbox);
        production.Environment.ShouldBe(PushProviders.Production);
        sandbox.Payload.ShouldBe(expo.Payload);
        sandbox.CollapseId.ShouldBe(production.CollapseId);
        sandbox.ExpiresAt.ShouldBe(Noon + PushDeliveryRunner.MaxAge);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_deliveries WHERE provider = 'apns' AND receipt_checked_at IS NOT NULL AND ticket_id IS NOT NULL"
            )
        ).ShouldBe(2);

        At(Noon.AddHours(2));
        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0);
        (Expo.Sent.Count + Apns.Sent.Count).ShouldBe(3, "accepted deliveries are never resent");
    }

    [Fact]
    public async Task whenReimbursementAndEditRecorded_RunOnce_ShouldUseLegacyEventText()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(alex.Token, ApnsToken(1), "production");
        var expense = await CreateExpenseAsync(householdId, sam.Token, Expense(1000, sam.UserId));
        await UpdateExpenseAsync(
            householdId,
            Id(expense),
            sam.Token,
            WithRevision(Expense(1200, sam.UserId), expense.GetProperty("revision").GetInt64())
        );

        await Runner().RunUntilIdleAsync(Ct);

        Apns.Sent.Select(message => message.Title)
            .Order()
            .ShouldBe(["Household expense updated", "New household expense"]);
        Apns.Sent.Select(message => message.Payload.ExpenseId)
            .Distinct()
            .Single()
            .ShouldBe(Id(expense));
    }

    [Fact]
    public async Task whenProviderFailsTransiently_RunOnce_ShouldBackOffAndDeliverLater()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        Apns.Respond = _ => PushOutcome.Retry("apns:503:ServiceUnavailable");

        (await Runner().RunOnceAsync(Ct)).Retried.ShouldBe(1);
        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0, "not due before the backoff");
        (await ScalarAsync("SELECT last_error FROM penny.push_outbox")).ShouldBe(
            "apns:503:ServiceUnavailable"
        );
        (await ScalarAsync("SELECT next_attempt_at FROM penny.push_deliveries")).ShouldBe(
            Noon.AddSeconds(5).UtcDateTime
        );

        At(Noon.AddSeconds(5));
        (await Runner().RunOnceAsync(Ct)).Retried.ShouldBe(1);
        (await ScalarAsync("SELECT next_attempt_at FROM penny.push_deliveries")).ShouldBe(
            Noon.AddSeconds(15).UtcDateTime,
            "the second retry waits 10 seconds"
        );

        Apns.Respond = _ => PushOutcome.Accepted(null);
        At(Noon.AddSeconds(15));
        (await Runner().RunOnceAsync(Ct)).Accepted.ShouldBe(1);
        (await ScalarAsync("SELECT attempts FROM penny.push_deliveries")).ShouldBe(3);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(1);
    }

    [Fact]
    public async Task whenProviderRejectsMessage_RunOnce_ShouldStopWithoutRemovingDevice()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        Apns.Respond = _ => PushOutcome.Permanent("apns:413:PayloadTooLarge");

        (await Runner().RunOnceAsync(Ct)).Failed.ShouldBe(1);

        (await UnsentMessagesAsync()).ShouldBe(0);
        (await ScalarAsync("SELECT last_error FROM penny.push_deliveries")).ShouldBe(
            "apns:413:PayloadTooLarge"
        );
        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(1);
        At(Noon.AddHours(1));
        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0);
    }

    [Fact]
    public async Task whenApnsSaysUnregistered_RunOnce_ShouldDeleteDeviceAndFinishItsOtherDeliveries()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await RegisterApnsAsync(sam.Token, ApnsToken(2), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        await CreateExpenseAsync(householdId, alex.Token, Expense(2000, alex.UserId));
        var rejected = false;
        Apns.Respond = message =>
            message.Token != ApnsToken(1) ? PushOutcome.Accepted(null)
            : !rejected && (rejected = true) ? PushOutcome.InvalidToken("apns:410:Unregistered")
            : PushOutcome.Retry("apns:503:ServiceUnavailable");

        var run = await Runner().RunOnceAsync(Ct);

        run.InvalidTokens.ShouldBe(1);
        (await ScalarAsync("SELECT string_agg(token, ',') FROM penny.push_devices")).ShouldBe(
            ApnsToken(2)
        );
        (await PendingAsync()).ShouldBe(0, "every delivery to the removed token finished");
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_deliveries WHERE token = '{ApnsToken(1)}' AND last_error = 'apns:410:Unregistered'"
            )
        ).ShouldBe(2);
        await Runner().RunUntilIdleAsync(Ct);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (await Apns.SentToAsync(ApnsToken(2))).Count.ShouldBe(2);
    }

    [Fact]
    public async Task whenTokenReRegisteredAfterRejectedSend_RecordInvalidToken_ShouldKeepTheFreshRegistration()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        var runner = Runner();
        Apns.Respond = _ =>
        {
            // The app re-registers the same token while APNs answers about the old one.
            At(Noon.AddSeconds(1));
            RegisterApnsAsync(sam.Token, ApnsToken(1), "production").GetAwaiter().GetResult();
            return PushOutcome.InvalidToken("apns:410:Unregistered");
        };

        await runner.RunOnceAsync(Ct);

        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(1);
    }

    [Fact]
    public async Task whenSessionLoggedOutOrExpired_RunOnce_ShouldNeverSendThatDeviceUserData()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        var samTablet = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/auth/login",
                null,
                System.Net.HttpStatusCode.OK,
                new { email = "sam@example.test", password = TestPassword }
            )
        )
            .GetProperty("token")
            .GetString()!;
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await RegisterApnsAsync(samTablet, ApnsToken(2), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        Apns.Respond = _ => PushOutcome.Retry("apns:503:ServiceUnavailable");
        await Runner().RunOnceAsync(Ct);
        (await PendingAsync()).ShouldBe(2);

        // Logout cascades the tablet's device and finishes its pending delivery.
        await ExpectAsync(
            HttpMethod.Post,
            "/api/auth/logout",
            samTablet,
            System.Net.HttpStatusCode.OK
        );
        // The phone's session expires (sessions last 30 days).
        await Fixture.SqlAsync(
            $"UPDATE penny.sessions SET expires_at = '{Noon.AddSeconds(4):O}' WHERE user_id = '{sam.UserId}'",
            Ct
        );
        Apns.Respond = _ => PushOutcome.Accepted(null);
        At(Noon.AddSeconds(5));
        var run = await Runner().RunOnceAsync(Ct);

        run.Accepted.ShouldBe(0);
        Apns.Sent.Count.ShouldBe(2, "only the first, failed attempts were sent");
        (await PendingAsync()).ShouldBe(0);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_deliveries WHERE last_error = 'device-removed'"
            )
        ).ShouldBe(2);
        (await UnsentMessagesAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task whenDeviceRemovedBeforeFirstPass_RunOnce_ShouldPlanNoDelivery()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        await ExpectAsync(
            HttpMethod.Delete,
            DevicesPath,
            sam.Token,
            System.Net.HttpStatusCode.OK,
            new { token = ApnsToken(1) }
        );

        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(1);

        Apns.Sent.ShouldBeEmpty();
        (await UnsentMessagesAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task whenMessageOlderThanMaxAge_RunOnce_ShouldExpireWithoutSending()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        Apns.Respond = _ => PushOutcome.Retry("apns:503:ServiceUnavailable");
        await Runner().RunOnceAsync(Ct);

        At(Noon + PushDeliveryRunner.MaxAge + TimeSpan.FromSeconds(1));
        await Runner().RunOnceAsync(Ct);

        Apns.Sent.Count.ShouldBe(1);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (await ScalarAsync("SELECT last_error FROM penny.push_outbox")).ShouldBe("expired");
        (await ScalarAsync("SELECT last_error FROM penny.push_deliveries")).ShouldBe("expired");
    }

    [Fact]
    public async Task whenApnsNotConfigured_RunOnce_ShouldKeepApnsDeliveriesWaitingAndSendExpo()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterExpoAsync(sam.Token);
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));

        var run = await Runner(transports: [Expo]).RunOnceAsync(Ct);

        run.Accepted.ShouldBe(1);
        run.Retried.ShouldBe(1);
        (
            await ScalarAsync(
                "SELECT last_error FROM penny.push_deliveries WHERE provider = 'apns'"
            )
        ).ShouldBe("apns:not-configured");
        At(Noon.AddSeconds(5));
        (await Runner().RunOnceAsync(Ct)).Accepted.ShouldBe(1, "configuring APNs delivers it");
    }

    [Fact]
    public async Task whenExpoRetired_RunOnce_ShouldFinishExpoDeliveriesAndStillSendApns()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterExpoAsync(sam.Token);
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));

        var run = await Runner(expoEnabled: false).RunOnceAsync(Ct);

        run.Accepted.ShouldBe(1);
        run.Failed.ShouldBe(1);
        Expo.Sent.ShouldBeEmpty();
        (
            await ScalarAsync(
                "SELECT last_error FROM penny.push_deliveries WHERE provider = 'expo'"
            )
        ).ShouldBe("expo-retired");
    }

    [Fact]
    public async Task whenStoredPayloadInvalid_RunOnce_ShouldFailPermanentlyWithoutSending()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        await Fixture.SqlAsync(
            """UPDATE penny.push_outbox SET payload = '{"householdId":"../../x","month":"2026-09","eventId":"e"}'""",
            Ct
        );

        (await Runner().RunOnceAsync(Ct)).Failed.ShouldBe(1);

        Apns.Sent.ShouldBeEmpty();
        (await ScalarAsync("SELECT last_error FROM penny.push_deliveries")).ShouldBe(
            "invalid-payload"
        );
    }

    [Fact]
    public async Task whenExpoReceiptsDue_CheckReceipts_ShouldRemoveUnregisteredDevicesAndCloseTickets()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterExpoAsync(sam.Token, "ExponentPushToken[sam_phone]");
        await RegisterExpoAsync(alex.Token, "ExponentPushToken[alex_phone]");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        await CreateExpenseAsync(householdId, sam.Token, Expense(1000, sam.UserId));
        await Runner().RunOnceAsync(Ct);
        var runner = Runner();
        (await runner.CheckReceiptsAsync(Ct)).ShouldBe(0, "receipts wait 15 minutes");
        Receipts.Requests.ShouldBeEmpty();
        var samTicket = (string)
            (
                await ScalarAsync(
                    "SELECT ticket_id FROM penny.push_deliveries WHERE token = 'ExponentPushToken[sam_phone]'"
                )
            )!;
        Receipts.Respond = ids =>
            ids.ToDictionary(
                id => id,
                id =>
                    id == samTicket
                        ? PushReceiptStatus.DeviceNotRegistered
                        : PushReceiptStatus.RateExceeded
            );

        At(Noon + PushDeliveryRunner.ReceiptDelay);
        (await runner.CheckReceiptsAsync(Ct)).ShouldBe(1);

        (await ScalarAsync("SELECT string_agg(token, ',') FROM penny.push_devices")).ShouldBe(
            "ExponentPushToken[alex_phone]"
        );
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_deliveries WHERE receipt_checked_at IS NULL"
            )
        ).ShouldBe(1, "a rate-limited receipt is checked again");
        Receipts.Respond = ids => ids.ToDictionary(id => id, _ => PushReceiptStatus.Ok);
        // The receipt claim counts as the second attempt: a 10-second backoff, as in legacy.
        At(Noon + PushDeliveryRunner.ReceiptDelay + TimeSpan.FromSeconds(10));
        (await runner.CheckReceiptsAsync(Ct)).ShouldBe(1);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_deliveries WHERE receipt_checked_at IS NULL"
            )
        ).ShouldBe(0);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_deliveries WHERE lease_token IS NOT NULL"
            )
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenExpenseWriteFails_CreateExpense_ShouldLeaveNoOutboxMessage()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");

        // Exact shares that do not add up fail inside the write transaction.
        var (status, _) = await OutcomeAsync(
            SendAsync(
                HttpMethod.Post,
                ExpensesPath(householdId),
                alex.Token,
                Expense(1000, alex.UserId, extra: Exact((alex.UserId, 1), (sam.UserId, 1)))
            )
        );

        status.ShouldBe(System.Net.HttpStatusCode.BadRequest);
        (await CountAsync("SELECT count(*) FROM penny.household_expenses")).ShouldBe(0);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox")).ShouldBe(0);
        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0);
    }
}

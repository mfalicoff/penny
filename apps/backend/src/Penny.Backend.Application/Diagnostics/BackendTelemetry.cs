using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Penny.Backend.Application.Diagnostics;

// MAZ-127: the service's own spans and metrics. Everything here is exported only when
// the host configures OpenTelemetry (an OTLP endpoint); without a listener the
// instruments and source cost nothing. Attributes are fixed vocabularies (job names,
// outcomes, failure kinds, exception type names), never ids, text or amounts.
public static class BackendTelemetry
{
    public const string Name = "Penny.Backend";

    public const string PushDeliveryJob = "push.delivery";
    public const string SearchEmbeddingJob = "search.embedding";
    public const string RecurrenceJob = "recurrence";
    public const string ReceiptTextJob = "receipt.text";
    public const string InboundMailJob = "inbound.mail";
    public const string ReceiptCleanupJob = "receipt.cleanup";
    public const string MailDeliveryJob = "mail.delivery";

    public const string JobAttribute = "penny.job";
    public const string ItemsAttribute = "penny.job.items";
    public const string OutcomeAttribute = "penny.outcome";
    public const string MethodAttribute = "penny.auth.method";
    public const string PolicyAttribute = "penny.rate_limit.policy";
    public const string ErrorTypeAttribute = "error.type";
    public const string ReceiptTextStatusAttribute = "penny.receipt_text.status";
    public const string ReceiptTextMethodAttribute = "penny.receipt_text.method";
    public const string InboundMailOutcomeAttribute = "penny.inbound_mail.outcome";

    public const string Success = "success";
    public const string Failure = "failure";

    public static readonly ActivitySource Source = new(Name);
    public static readonly Meter Meter = new(Name);

    // Seconds from "owed" to "picked up": sub-second polling up to a day of
    // recurrence catch-up.
    private static readonly double[] LagBuckets =
    [
        0.5,
        1,
        2,
        5,
        10,
        30,
        60,
        300,
        900,
        3600,
        21600,
        86400,
    ];

    private static readonly Counter<long> SignIns = Meter.CreateCounter<long>(
        "penny.auth.sign_ins",
        "{sign_in}",
        "Sign-in attempts by method (password, oidc, registration) and outcome."
    );

    private static readonly Counter<long> RateLimitRejections = Meter.CreateCounter<long>(
        "penny.rate_limit.rejections",
        "{request}",
        "Requests refused with 429 by rate-limit policy."
    );

    private static readonly Counter<long> LedgerConflicts = Meter.CreateCounter<long>(
        "penny.ledger.conflicts",
        "{conflict}",
        "Personal ledger saves refused with 409 because the revision moved on."
    );

    private static readonly Counter<long> HouseholdJoins = Meter.CreateCounter<long>(
        "penny.household.joins",
        "{join}",
        "Invite-code join attempts by outcome."
    );

    private static readonly Histogram<double> JobLag = Meter.CreateHistogram(
        "penny.job.lag",
        "s",
        "Time from when background work became due to when a worker picked it up.",
        advice: new InstrumentAdvice<double> { HistogramBucketBoundaries = LagBuckets }
    );

    private static readonly Counter<long> JobItems = Meter.CreateCounter<long>(
        "penny.job.items",
        "{item}",
        "Background work items claimed by a worker pass."
    );

    private static readonly Counter<long> JobFailures = Meter.CreateCounter<long>(
        "penny.job.failures",
        "{failure}",
        "Background work items or passes that failed and will be retried."
    );

    // Seconds for one receipt text extraction (MAZ-125): a text PDF takes milliseconds,
    // a multi-page scan at most the configured time bound.
    private static readonly double[] ExtractionBuckets = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

    private static readonly Counter<long> ReceiptTexts = Meter.CreateCounter<long>(
        "penny.receipt_text.results",
        "{receipt}",
        "Receipt text extractions by status (done, failed, unsupported, retry) and method (text, ocr, mixed)."
    );

    private static readonly Histogram<double> ReceiptTextDuration = Meter.CreateHistogram(
        "penny.receipt_text.duration",
        "s",
        "Wall time of one receipt text extraction attempt, by status.",
        advice: new InstrumentAdvice<double> { HistogramBucketBoundaries = ExtractionBuckets }
    );

    private static readonly Counter<long> ClientTelemetryReports = Meter.CreateCounter<long>(
        "penny.client_telemetry.reports",
        "{report}",
        "Client telemetry reports (MAZ-129) by kind (faro, traces, logs) and outcome: accepted, duplicate, invalid, dropped, forwarded, refused, failed."
    );

    private static readonly Counter<long> InboundMailRequests = Meter.CreateCounter<long>(
        "penny.inbound_mail.ingress",
        "{request}",
        "Emailed receipt ingress requests (MAZ-184) by outcome: accepted, duplicate, unknown_address, rate_limited, too_large, invalid, unauthorized, recipients_unauthorized."
    );

    private static readonly Counter<long> InboundMailResults = Meter.CreateCounter<long>(
        "penny.inbound_mail.results",
        "{message}",
        "Inbound messages processed (MAZ-184) by outcome: done, retry, lease_lost or a rejection reason code."
    );

    private static readonly Histogram<double> InboundMailDuration = Meter.CreateHistogram(
        "penny.inbound_mail.duration",
        "s",
        "Wall time of one inbound message conversion and store, by outcome.",
        advice: new InstrumentAdvice<double> { HistogramBucketBoundaries = ExtractionBuckets }
    );

    public const string MailOutcomeAttribute = "penny.mail.outcome";
    public const string MailKindAttribute = "penny.mail.kind";

    private static readonly Counter<long> MailDeliveries = Meter.CreateCounter<long>(
        "penny.mail.deliveries",
        "{message}",
        "Outbox emails (MAZ-124) recorded by a delivery pass, by kind and outcome: sent, deferred (retried later), failed (for good) or dropped (nothing to send any more)."
    );

    // One recorded outbox message; `kind` is a MailKinds value, `outcome` a fixed vocabulary.
    public static void MailDelivered(string kind, string outcome) =>
        MailDeliveries.Add(
            1,
            new KeyValuePair<string, object?>(MailKindAttribute, kind),
            new KeyValuePair<string, object?>(MailOutcomeAttribute, outcome)
        );

    // Backlog gauges (MAZ-184), set by the inbound mail worker pass: messages waiting to be
    // converted and unhandled inbox items across all users. Counts only.
    private static long inboundMailQueue;
    private static long receiptInboxUnhandled;

    private static readonly ObservableGauge<long> InboundMailQueue = Meter.CreateObservableGauge(
        "penny.inbound_mail.queue",
        () => Interlocked.Read(ref inboundMailQueue),
        "{message}",
        "Emailed receipts waiting to be converted (pending or being processed)."
    );

    private static readonly ObservableGauge<long> ReceiptInboxUnhandled =
        Meter.CreateObservableGauge(
            "penny.receipt_inbox.unhandled",
            () => Interlocked.Read(ref receiptInboxUnhandled),
            "{item}",
            "Receipt inbox items not attached yet, across all users."
        );

    public static void InboundMailBacklog(long queue, long unhandled)
    {
        Interlocked.Exchange(ref inboundMailQueue, queue);
        Interlocked.Exchange(ref receiptInboxUnhandled, unhandled);
    }

    public static void InboundMailProcessed(string outcome, TimeSpan duration)
    {
        var tag = new KeyValuePair<string, object?>(InboundMailOutcomeAttribute, outcome);
        InboundMailResults.Add(1, tag);
        InboundMailDuration.Record(Math.Max(0, duration.TotalSeconds), tag);
    }

    // One client telemetry report; `kind` and `outcome` are fixed vocabularies.
    public static void ClientTelemetry(string kind, string outcome) =>
        ClientTelemetryReports.Add(
            1,
            new KeyValuePair<string, object?>("penny.telemetry.kind", kind),
            new KeyValuePair<string, object?>(OutcomeAttribute, outcome)
        );

    // One ingress request; `outcome` is a fixed vocabulary, never an address or content.
    public static void InboundMail(string outcome) =>
        InboundMailRequests.Add(
            1,
            new KeyValuePair<string, object?>(InboundMailOutcomeAttribute, outcome)
        );

    // One extraction attempt. `status` is done, failed, unsupported or retry; `method`
    // is text, ocr or mixed for done results, otherwise null.
    public static void ReceiptTextExtracted(string status, string? method, TimeSpan duration)
    {
        var tags = new TagList { { ReceiptTextStatusAttribute, status } };
        if (method is not null)
            tags.Add(ReceiptTextMethodAttribute, method);
        ReceiptTexts.Add(1, tags);
        ReceiptTextDuration.Record(
            Math.Max(0, duration.TotalSeconds),
            new KeyValuePair<string, object?>(ReceiptTextStatusAttribute, status)
        );
    }

    // `failureKind` is null on success, otherwise the lowercase FailureKind name.
    public static void SignIn(string method, string? failureKind)
    {
        var tags = Outcome(failureKind);
        tags.Add(MethodAttribute, method);
        SignIns.Add(1, tags);
    }

    public static void RateLimitRejected(string policy) =>
        RateLimitRejections.Add(1, new KeyValuePair<string, object?>(PolicyAttribute, policy));

    public static void LedgerConflict() => LedgerConflicts.Add(1);

    public static void HouseholdJoin(string? failureKind) =>
        HouseholdJoins.Add(1, Outcome(failureKind));

    // Starts the span of a worker pass that claimed work. Idle polls start no span
    // (and their claim queries run outside any span, so they are not traced either).
    public static Activity? StartJob(string job, int items)
    {
        JobItems.Add(items, new KeyValuePair<string, object?>(JobAttribute, job));
        var activity = Source.StartActivity(job, ActivityKind.Internal);
        activity?.SetTag(JobAttribute, job);
        activity?.SetTag(ItemsAttribute, items);
        return activity;
    }

    public static void JobPickedUp(string job, TimeSpan lag) =>
        JobLag.Record(
            Math.Max(0, lag.TotalSeconds),
            new KeyValuePair<string, object?>(JobAttribute, job)
        );

    public static void JobFailed(string job, string exceptionType) =>
        JobFailures.Add(
            1,
            new KeyValuePair<string, object?>(JobAttribute, job),
            new KeyValuePair<string, object?>(ErrorTypeAttribute, exceptionType)
        );

    // Marks a span failed with the exception type only (no message or stack trace).
    public static void Failed(Activity? activity, string exceptionType)
    {
        activity?.SetStatus(ActivityStatusCode.Error);
        activity?.SetTag(ErrorTypeAttribute, exceptionType);
    }

    private static TagList Outcome(string? failureKind)
    {
        var tags = new TagList { { OutcomeAttribute, failureKind is null ? Success : Failure } };
        if (failureKind is not null)
            tags.Add(ErrorTypeAttribute, failureKind);
        return tags;
    }
}

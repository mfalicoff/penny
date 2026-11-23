using Penny.Backend.Application.Mail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Mail;

public sealed class MailTemplatesTests
{
    private const string AppUrl = "https://penny.example.test";
    private const string Token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    [Theory]
    [InlineData("en", "Reset your Penny password", "for 24 hours")]
    [InlineData("fr", "Réinitialiser votre mot de passe Penny", "pendant 24 heures")]
    public void whenResetRendered_PasswordReset_ShouldLinkTheAppWithTheCodeInTheFragment(
        string locale,
        string subject,
        string lifetime
    )
    {
        var (title, text) = MailTemplates.PasswordReset(
            locale,
            AppUrl,
            Token,
            TimeSpan.FromHours(24)
        );
        title.ShouldBe(subject);
        text.ShouldContain($"{AppUrl}/reset-password#code={Token}");
        text.ShouldContain(lifetime);
        text.ShouldContain("penny.example.test");
    }

    [Theory]
    [InlineData("en", "Verify your email for Penny", "for 48 hours")]
    [InlineData("fr", "Confirmez votre adresse courriel pour Penny", "pendant 48 heures")]
    public void whenVerificationRendered_EmailVerification_ShouldLinkTheAppWithTheCodeInTheFragment(
        string locale,
        string subject,
        string lifetime
    )
    {
        var (title, text) = MailTemplates.EmailVerification(
            locale,
            AppUrl,
            Token,
            TimeSpan.FromHours(48)
        );
        title.ShouldBe(subject);
        text.ShouldContain($"{AppUrl}/verify-email#code={Token}");
        text.ShouldContain(lifetime);
        text.ShouldContain("penny.example.test");
    }

    [Fact]
    public void whenInviteRendered_HouseholdInvite_ShouldNameTheHouseholdAndFormatTheCode()
    {
        var (subject, text) = MailTemplates.HouseholdInvite(
            "en",
            AppUrl,
            "7F3A9C01B2",
            TimeSpan.FromHours(72),
            "Apartment",
            trip: false,
            "Max"
        );
        subject.ShouldBe("Max invited you to Apartment on Penny");
        text.ShouldContain($"{AppUrl}/join#code=7F3A9C01B2");
        text.ShouldContain("7F3A9 C01B2");
        text.ShouldContain("for 3 days");
        text.ShouldContain("the household \"Apartment\"");
    }

    [Fact]
    public void whenNamesHoldLineBreaks_HouseholdInvite_ShouldKeepEveryNameOnOneLine()
    {
        var (subject, text) = MailTemplates.HouseholdInvite(
            "fr",
            AppUrl,
            "7F3A9C01B2",
            TimeSpan.FromHours(24),
            "Coast\r\nBcc: someone@example.test",
            trip: true,
            null
        );
        subject.ShouldNotContain("\n");
        subject.ShouldStartWith("Invitation au voyage");
        text.ShouldNotContain("\nBcc:");
        text.ShouldContain("pendant 1 jour.");
    }

    [Theory]
    [InlineData(null, "en")]
    [InlineData("fr-CA,fr;q=0.9", "fr")]
    [InlineData("de-DE,fr;q=0.8,en;q=0.5", "fr")]
    [InlineData("en-US,fr;q=0.5", "en")]
    [InlineData("es", "en")]
    public void whenLanguagesPreferred_From_ShouldPickEnglishOrFrench(
        string? header,
        string locale
    ) => MailLocales.From(header).ShouldBe(locale);
}

using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class LegalOptionsTests
{
    private static LegalOptions Read(string? privacyPolicyUrl) =>
        LegalOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    privacyPolicyUrl is null
                        ? []
                        :
                        [
                            new KeyValuePair<string, string?>(
                                "Legal:PrivacyPolicyUrl",
                                privacyPolicyUrl
                            ),
                        ]
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldPublishNoPrivacyPolicy() =>
        Read(null).PrivacyPolicyUrl.ShouldBeNull();

    [Theory]
    [InlineData("https://penny.example.com/privacy", "https://penny.example.com/privacy")]
    [InlineData(
        " https://Example.COM/legal/privacy#data ",
        "https://example.com/legal/privacy#data"
    )]
    [InlineData("http://penny.lan:8080/privacy", "http://penny.lan:8080/privacy")]
    public void whenAbsoluteWebUrlConfigured_Read_ShouldPublishNormalizedUrl(
        string value,
        string expected
    ) => Read(value).PrivacyPolicyUrl.ShouldBe(expected);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/privacy")]
    [InlineData("penny.example.com/privacy")]
    [InlineData("ftp://penny.example.com/privacy")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://user:secret@penny.example.com/privacy")]
    public void whenInvalidUrlConfigured_Read_ShouldFailNamingSettingWithoutValue(string value)
    {
        var error = Should.Throw<InvalidOperationException>(() => Read(value));
        error.Message.ShouldContain(LegalOptions.PrivacyPolicyUrlSetting);
        if (value.Trim().Length > 0)
            error.Message.ShouldNotContain(value.Trim());
    }

    [Fact]
    public void whenUrlTooLong_Read_ShouldFail() =>
        Should.Throw<InvalidOperationException>(() =>
            Read("https://penny.example.com/" + new string('a', 2048))
        );
}

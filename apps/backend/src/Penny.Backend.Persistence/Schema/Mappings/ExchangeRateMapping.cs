using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class ExchangeRateMapping : IEntityTypeConfiguration<ExchangeRate>
{
    public void Configure(EntityTypeBuilder<ExchangeRate> builder)
    {
        builder.ToTable("exchange_rates", table =>
        {
            table.HasCheckConstraint("ck_exchange_rates_currency", "currency ~ '^[A-Z]{3}$'");
            table.HasCheckConstraint("ck_exchange_rates_per_euro", Checks.Rate("per_euro"));
        });
        // One quote per currency and publication; reads go by date.
        builder.HasKey(rate => new { rate.RateDate, rate.Currency });
    }
}

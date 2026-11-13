using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

public sealed record CategoryResponse(
    string Id,
    string Name,
    string Icon,
    string Color,
    string Kind
)
{
    public static CategoryResponse From(Category category) =>
        new(category.Id, category.Name, category.Icon, category.Color, category.Kind);
}

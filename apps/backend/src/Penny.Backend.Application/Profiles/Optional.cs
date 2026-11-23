namespace Penny.Backend.Application.Profiles;

// A PATCH field: absent (no change) or present with a value, which may be null (clear).
public readonly record struct Optional<T>(bool HasValue, T Value)
{
    public static readonly Optional<T> Absent = default;

    public static Optional<T> Of(T value) => new(true, value);
}

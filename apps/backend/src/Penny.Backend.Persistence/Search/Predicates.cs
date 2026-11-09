using System.Linq.Expressions;

namespace Penny.Backend.Persistence.Search;

// Composes EF expression lambdas, so a rule is written once and reused both as
// separate query branches and inside other expressions.
internal static class Predicates
{
    public static Expression<Func<T, bool>> Or<T>(
        Expression<Func<T, bool>> left,
        Expression<Func<T, bool>> right
    ) =>
        Expression.Lambda<Func<T, bool>>(
            Expression.OrElse(left.Body, Body(right, left.Parameters[0])),
            left.Parameters
        );

    public static Expression<Func<T, bool>> Not<T>(Expression<Func<T, bool>> predicate) =>
        Expression.Lambda<Func<T, bool>>(Expression.Not(predicate.Body), predicate.Parameters);

    // The lambda's body with its single parameter replaced by `parameter`.
    public static Expression Body(LambdaExpression lambda, ParameterExpression parameter) =>
        new ParameterReplacer(
            new Dictionary<ParameterExpression, Expression> { [lambda.Parameters[0]] = parameter }
        ).Visit(lambda.Body);
}

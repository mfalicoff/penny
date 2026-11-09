using System.Linq.Expressions;

namespace Penny.Backend.Persistence.Search;

// Replaces lambda parameters with other expressions (expression inlining for EF).
internal sealed class ParameterReplacer(IReadOnlyDictionary<ParameterExpression, Expression> map)
    : ExpressionVisitor
{
    protected override Expression VisitParameter(ParameterExpression node) =>
        map.TryGetValue(node, out var replacement) ? replacement : base.VisitParameter(node);
}

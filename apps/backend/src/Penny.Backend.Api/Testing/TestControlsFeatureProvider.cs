using System.Reflection;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace Penny.Backend.Api.Testing;

// Removes the test control controller from MVC unless test controls are enabled, so
// a normal or Production host has no `/api/test` route at all (it answers 401/404 like
// any unknown route), not merely a guarded one.
public sealed class TestControlsFeatureProvider(bool enabled) : ControllerFeatureProvider
{
    protected override bool IsController(TypeInfo typeInfo) =>
        base.IsController(typeInfo)
        && (enabled || typeInfo.AsType() != typeof(TestControlsController));
}

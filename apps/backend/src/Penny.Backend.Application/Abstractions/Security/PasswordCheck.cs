namespace Penny.Backend.Application.Abstractions.Security;

public enum PasswordCheck
{
    Failed,
    Success,
    SuccessRehashNeeded,
}

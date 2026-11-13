namespace Penny.Backend.Application.Abstractions.Security;

// Implemented with a maintained library; never hand-rolled cryptography.
public interface IPasswordHasher
{
    string Hash(string password);

    // Unusable stored values (missing, empty or not an Identity hash) fail after the same work.
    PasswordCheck Verify(string? storedHash, string password);
}

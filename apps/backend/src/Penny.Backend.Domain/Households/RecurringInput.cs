namespace Penny.Backend.Domain.Households;

// The legacy shared `recurringInput` body: the expense fields without `date`, plus
// `nextDate` and `frequency`. `Template.Date` holds `nextDate`.
public sealed record RecurringInput(ExpenseInput Template, string Frequency)
{
    public DateOnly NextDate => Template.Date;
}

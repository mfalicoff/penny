export const currencyFormat = (value: number, currency: string) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);

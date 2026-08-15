import type { RecurringExpense } from "./moneta-types";

export type PlannedOccurrence = {
  key: string;
  expenseId: string;
  month: string;
  name: string;
  amount: number;
  category: string;
};

export type ScheduledPaymentBreakdown = {
  expenseId: string;
  name: string;
  amountPerOccurrence: number;
  months: string[];
  total: number;
};

export type PlanningCapacity = {
  forecastMonthKeys: string[];
  plannedOccurrences: PlannedOccurrence[];
  scheduledPayments: ScheduledPaymentBreakdown[];
  scheduledTotal: number;
  remainingAfterScheduled: number;
  suggestedMonthlySpending: number;
};

export const monthIndex = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber - 1;
};

export const addMonths = (month: string, count: number) => {
  const index = monthIndex(month) + count;
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
};

export const isDueInMonth = (expense: RecurringExpense, month: string) => {
  if (expense.endMonth && monthIndex(month) > monthIndex(expense.endMonth)) return false;
  if (expense.intervalMonths === 0) return expense.startMonth === month;
  const difference = monthIndex(month) - monthIndex(expense.startMonth);
  return difference >= 0 && difference % Math.max(1, expense.intervalMonths) === 0;
};

export const isPaidInMonth = (expense: RecurringExpense, month: string) => expense.paidMonths?.includes(month) ?? false;

export function calculatePlanningCapacity({
  currentNetWorth,
  recurringExpenses,
  startMonth,
  planningMonths,
}: {
  currentNetWorth: number;
  recurringExpenses: RecurringExpense[];
  startMonth: string;
  planningMonths: number;
}): PlanningCapacity {
  const normalizedPlanningMonths = Math.max(1, Math.floor(planningMonths));
  const forecastMonthKeys = Array.from({ length: normalizedPlanningMonths }, (_, index) => addMonths(startMonth, index));
  const scheduledPayments = recurringExpenses.flatMap((expense) => {
    const months = forecastMonthKeys.filter((month) => isDueInMonth(expense, month) && !isPaidInMonth(expense, month));
    if (months.length === 0) return [];
    const amountPerOccurrence = Number.isFinite(expense.amount) ? Math.max(0, expense.amount) : 0;
    return [{
      expenseId: expense.id,
      name: expense.name,
      amountPerOccurrence,
      months,
      total: amountPerOccurrence * months.length,
    }];
  });
  const plannedOccurrences = recurringExpenses.flatMap((expense) => {
    const amount = Number.isFinite(expense.amount) ? Math.max(0, expense.amount) : 0;
    return forecastMonthKeys
      .filter((month) => isDueInMonth(expense, month) && !isPaidInMonth(expense, month))
      .map((month) => ({
        key: `${expense.id}::${month}`,
        expenseId: expense.id,
        month,
        name: expense.name,
        amount,
        category: expense.category,
      }));
  });
  const scheduledTotal = scheduledPayments.reduce((sum, item) => sum + item.total, 0);
  const remainingAfterScheduled = currentNetWorth - scheduledTotal;

  return {
    forecastMonthKeys,
    plannedOccurrences,
    scheduledPayments,
    scheduledTotal,
    remainingAfterScheduled,
    suggestedMonthlySpending: Math.max(0, remainingAfterScheduled / normalizedPlanningMonths),
  };
}

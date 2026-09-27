import type { LedgerEntry } from './moneta-types';

type Convert = (entry: Pick<LedgerEntry, 'amount' | 'currency'>) => number | null;

export type CategoryBudgetTotal = { category: string; spent: number; limit: number; over: number };

export function calculateOverBudgetCategories(
  entries: LedgerEntry[],
  categories: string[],
  monthlyBudgets: Record<string, number>,
  months: number,
  convert: Convert,
): CategoryBudgetTotal[] {
  return categories.map((category) => {
    const spent = entries
      .filter((entry) => entry.type === 'expense' && !entry.plannedExpenseId && entry.countsTowardMonthlyBudget !== false)
      .reduce((sum, entry) => sum + entryAllocations(entry).filter((allocation) => allocation.category === category)
        .reduce((allocationSum, allocation) => allocationSum + (convert({ amount: allocation.amount, currency: entry.currency }) ?? 0), 0), 0);
    const limit = (monthlyBudgets[category] ?? 0) * months;
    return { category, spent, limit, over: Math.max(0, spent - limit) };
  }).filter((item) => item.over > 0).sort((first, second) => second.over - first.over);
}

function entryAllocations(entry: LedgerEntry) {
  return entry.allocations?.length ? entry.allocations : [{ category: entry.category, amount: entry.amount }];
}

export function summarizeSpending(entries: LedgerEntry[], month: string, convert: Convert) {
  let scheduled = 0;
  let flexible = 0;
  for (const entry of entries) {
    if (entry.type !== 'expense' || !entry.date.startsWith(`${month}-`)) continue;
    const amount = convert(entry) ?? 0;
    if (entry.plannedExpenseId) scheduled += amount;
    else flexible += amount;
  }
  return { scheduled, flexible, amount: scheduled + flexible };
}

export function recommendBudgets(entries: LedgerEntry[], targetMonth: string, convert: Convert) {
  const [year, number] = targetMonth.split('-').map(Number);
  const month = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
  const budgets: Record<string, number> = {};
  let missingRates = false;
  for (const entry of entries) {
    if (entry.type !== 'expense' || !entry.date.startsWith(`${month}-`) || entry.plannedExpenseId || entry.countsTowardMonthlyBudget === false) continue;
    for (const allocation of entry.allocations?.length ? entry.allocations : [entry]) {
      const amount = convert({ amount: allocation.amount, currency: entry.currency });
      if (amount === null) missingRates = true;
      else budgets[allocation.category] = (budgets[allocation.category] ?? 0) + amount;
    }
  }
  for (const category of Object.keys(budgets)) budgets[category] = Math.round(budgets[category] * 100) / 100;
  return { month, budgets, missingRates };
}

export type CategorySort = "manual" | "budget-desc" | "alphabetical" | "spent-desc" | "spent-asc";

export type AssetBalance = {
  id: string;
  name: string;
  amount: number;
  currency: string;
};

export type BudgetState = {
  assets: AssetBalance[];
  displayCurrency: string;
  exchangeRates: Record<string, number>;
  planningStartMonth: string;
  planningEndMonth: string;
  planningMonths?: number;
  monthlyIncome: number;
};

export type LedgerEntry = {
  id: string;
  date: string;
  type: "expense" | "income";
  category: string;
  description: string;
  amount: number;
  currency: string;
  countsTowardMonthlyBudget?: boolean;
  plannedExpenseId?: string;
  plannedExpenseMonth?: string;
  receiptId?: string;
};

export type MonthlyBudgets = Record<string, number>;

export type RecurringExpense = {
  id: string;
  name: string;
  category: string;
  amount: number;
  intervalMonths: number;
  startMonth: string;
  endMonth?: string;
  paidMonths?: string[];
};

export type MonetaSnapshot = {
  version: 2;
  data: BudgetState;
  entries: LedgerEntry[];
  monthlyBudgets: MonthlyBudgets;
  expenseCategories: string[];
  budgetCategories: string[];
  categorySort: CategorySort;
  recurringExpenses: RecurringExpense[];
  insightMonths: number;
};

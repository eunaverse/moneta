export type CategorySort = "manual" | "budget-desc" | "alphabetical" | "spent-desc" | "spent-asc";

export type BudgetState = {
  krwPrimary: number;
  krwSecondary: number;
  krwEmergency: number;
  usdCash: number;
  exchangeRate: number;
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
  currency: "USD" | "KRW";
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
  version: 1;
  data: BudgetState;
  entries: LedgerEntry[];
  monthlyBudgets: MonthlyBudgets;
  expenseCategories: string[];
  budgetCategories: string[];
  categorySort: CategorySort;
  recurringExpenses: RecurringExpense[];
  insightMonths: number;
};

import { addMonths, monthIndex } from "./budget-calculations.ts";
import type { AssetBalance, BudgetState, CategorySort, LedgerAllocation, LedgerEntry, MonetaSnapshot, MonthlyBudgets, RecurringExpense } from "./moneta-types";

export const DEFAULT_EXPENSE_CATEGORIES = ["Housing", "Food", "Transport", "Insurance & Health", "Tuition", "Shopping", "Travel", "Other"];

const LEGACY_SAMPLE_BUDGETS: MonthlyBudgets = {
  Housing: 1_800,
  Food: 650,
  Transport: 400,
  "Insurance & Health": 500,
  Tuition: 100,
  Shopping: 250,
  Travel: 200,
  Other: 100,
};
const LEGACY_SAMPLE_BUDGET_CATEGORIES = ["Housing", "Food", "Transport"];
const CATEGORY_MIGRATION: Record<string, string> = {
  "주거": "Housing", "식비": "Food", "교통": "Transport", "보험·의료": "Insurance & Health",
  "학비": "Tuition", "이주 준비": "Tuition", "쇼핑": "Shopping", "여행·이벤트": "Travel", "기타": "Other",
  "급여": "Salary", "보너스": "Bonus", "투자": "Investment", "환급": "Refund", "기타 수입": "Other income",
};

type LegacyBudgetState = Partial<BudgetState> & {
  krwPrimary?: number;
  krwSecondary?: number;
  krwEmergency?: number;
  usdCash?: number;
  exchangeRate?: number;
};

export type StoredMonetaSnapshot = Partial<Omit<MonetaSnapshot, "version" | "data">> & {
  version?: number;
  data?: LegacyBudgetState;
};

export type StoredMonetaRecord = {
  state: StoredMonetaSnapshot;
  updatedAt: string;
};

type PersistMonetaSnapshot = (state: MonetaSnapshot, expectedUpdatedAt: string) => Promise<StoredMonetaRecord>;

const LEGACY_ASSET_FIELDS = ["krwPrimary", "krwSecondary", "krwEmergency", "usdCash"] as const;

const localMonthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const finiteNonNegative = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const currencyCode = (value: unknown, fallback = "USD") => {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};
const validMonth = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || ""));
const migrateCategory = (value: string) => CATEGORY_MIGRATION[value] || value;

export const needsLegacyAssetMigration = (snapshot: StoredMonetaSnapshot) => {
  const storedData = snapshot.data;
  return Boolean(storedData
    && !Array.isArray(storedData.assets)
    && LEGACY_ASSET_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(storedData, field)));
};

const sanitizeAssets = (assets: unknown, displayCurrency: string): AssetBalance[] => {
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((asset, index) => {
    if (!asset || typeof asset !== "object") return [];
    const candidate = asset as Partial<AssetBalance>;
    const name = String(candidate.name || "").trim();
    if (!name) return [];
    return [{
      id: String(candidate.id || `asset-${index + 1}`),
      name,
      amount: finiteNonNegative(candidate.amount),
      currency: currencyCode(candidate.currency, displayCurrency),
    }];
  });
};

const sanitizeRates = (rates: unknown, displayCurrency: string) => {
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) return {};
  const result: Record<string, number> = {};
  Object.entries(rates as Record<string, unknown>).forEach(([key, value]) => {
    const currency = currencyCode(key, "");
    if (!currency || currency === displayCurrency) return;
    result[currency] = finiteNonNegative(value);
  });
  return result;
};

const sanitizeBudgets = (budgets: unknown) => {
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) return {};
  return Object.fromEntries(Object.entries(budgets as Record<string, unknown>).map(([key, value]) => [migrateCategory(key), finiteNonNegative(value)]));
};

const isUntouchedLegacySample = (budgets: MonthlyBudgets, budgetCategories: string[]) => {
  const keys = Object.keys(budgets);
  const sampleKeys = Object.keys(LEGACY_SAMPLE_BUDGETS);
  return keys.length === sampleKeys.length
    && sampleKeys.every((key) => budgets[key] === LEGACY_SAMPLE_BUDGETS[key])
    && budgetCategories.length === LEGACY_SAMPLE_BUDGET_CATEGORIES.length
    && budgetCategories.every((category, index) => category === LEGACY_SAMPLE_BUDGET_CATEGORIES[index]);
};

const sanitizeAllocations = (value: unknown, entryAmount: unknown): LedgerAllocation[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return undefined;
  const allocations = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Partial<LedgerAllocation>;
    const category = migrateCategory(String(candidate.category || "").trim());
    const description = String(candidate.description || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const amount = finiteNonNegative(candidate.amount);
    return category && description && amount > 0 ? { category, description, amount } : null;
  });
  if (allocations.some((allocation) => allocation === null)) return undefined;
  const validAllocations = allocations as LedgerAllocation[];
  const allocationTotal = validAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  return Math.abs(allocationTotal - finiteNonNegative(entryAmount)) <= 0.009 ? validAllocations : undefined;
};

export function createDefaultSnapshot(currentMonth = localMonthKey()): MonetaSnapshot {
  return {
    version: 2,
    data: {
      assets: [],
      displayCurrency: "USD",
      exchangeRates: {},
      planningStartMonth: currentMonth,
      planningEndMonth: addMonths(currentMonth, 23),
      monthlyIncome: 0,
    },
    entries: [],
    monthlyBudgets: {},
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    budgetCategories: [],
    categorySort: "manual",
    recurringExpenses: [],
    insightMonths: 6,
  };
}

export function normalizeSnapshot(snapshot: StoredMonetaSnapshot, currentMonth = localMonthKey()): MonetaSnapshot {
  const defaults = createDefaultSnapshot(currentMonth);
  const storedData = snapshot.data || {};
  const displayCurrency = currencyCode(storedData.displayCurrency, "USD");
  const legacyPlanningMonths = Math.max(1, Math.floor(Number(storedData.planningMonths) || 24));
  const planningStartMonth = validMonth(storedData.planningStartMonth) ? String(storedData.planningStartMonth) : currentMonth;
  const storedPlanningEndMonth = validMonth(storedData.planningEndMonth) ? String(storedData.planningEndMonth) : "";
  const planningEndMonth = storedPlanningEndMonth && monthIndex(storedPlanningEndMonth) >= monthIndex(planningStartMonth)
    ? storedPlanningEndMonth
    : addMonths(planningStartMonth, legacyPlanningMonths - 1);
  const entries = (Array.isArray(snapshot.entries) ? snapshot.entries : []).map((entry) => {
    const allocations = sanitizeAllocations(entry.allocations, entry.amount);
    return {
      ...entry,
      category: migrateCategory(entry.category),
      currency: currencyCode(entry.currency, displayCurrency),
      allocations,
    };
  }) as LedgerEntry[];
  const hasStoredAssets = Array.isArray(storedData.assets);
  const usesLegacyAssets = needsLegacyAssetMigration(snapshot);
  const isModern = Number(snapshot.version) >= 2 || hasStoredAssets;
  const assets = hasStoredAssets ? sanitizeAssets(storedData.assets, displayCurrency) : usesLegacyAssets ? [
    { id: "legacy-primary-krw", name: "Primary account", amount: finiteNonNegative(storedData.krwPrimary), currency: "KRW" },
    { id: "legacy-secondary-krw", name: "Secondary account", amount: finiteNonNegative(storedData.krwSecondary), currency: "KRW" },
    { id: "legacy-emergency-krw", name: "Emergency fund", amount: finiteNonNegative(storedData.krwEmergency), currency: "KRW" },
    { id: "legacy-usd-cash", name: "Cash", amount: finiteNonNegative(storedData.usdCash), currency: "USD" },
  ].filter((asset) => asset.amount > 0) : [];
  const exchangeRates = sanitizeRates(storedData.exchangeRates, displayCurrency);
  if (usesLegacyAssets
    && !(exchangeRates.KRW > 0)
    && (assets.some((asset) => asset.currency === "KRW") || entries.some((entry) => entry.currency === "KRW"))) {
    exchangeRates.KRW = finiteNonNegative(storedData.exchangeRate);
  }
  const categories = Array.from(new Set((Array.isArray(snapshot.expenseCategories) && snapshot.expenseCategories.length > 0
    ? snapshot.expenseCategories
    : defaults.expenseCategories).map(migrateCategory)));
  let monthlyBudgets = sanitizeBudgets(snapshot.monthlyBudgets);
  let budgetCategories = Array.from(new Set((Array.isArray(snapshot.budgetCategories) ? snapshot.budgetCategories : []).map(migrateCategory))).filter((category) => categories.includes(category));
  if (!isModern && isUntouchedLegacySample(monthlyBudgets, budgetCategories)) {
    monthlyBudgets = {};
    budgetCategories = [];
  }
  const categorySort: CategorySort = snapshot.categorySort && ["manual", "budget-desc", "alphabetical", "spent-desc", "spent-asc"].includes(snapshot.categorySort)
    ? snapshot.categorySort
    : "manual";
  const recurringExpenses = (Array.isArray(snapshot.recurringExpenses) ? snapshot.recurringExpenses : []).map((item) => ({
    ...item,
    category: migrateCategory(item.category),
    amount: finiteNonNegative(item.amount),
    intervalMonths: item.intervalMonths === 0 ? 0 : 1,
    endMonth: item.endMonth || undefined,
    paidMonths: item.paidMonths || [],
  })) as RecurringExpense[];

  return {
    version: 2,
    data: {
      assets,
      displayCurrency,
      exchangeRates,
      planningStartMonth,
      planningEndMonth,
      monthlyIncome: finiteNonNegative(storedData.monthlyIncome),
    },
    entries,
    monthlyBudgets,
    expenseCategories: categories,
    budgetCategories,
    categorySort,
    recurringExpenses,
    insightMonths: Math.max(1, Math.min(24, Number(snapshot.insightMonths) || 6)),
  };
}

export async function migrateLegacyAssetRecord(
  record: StoredMonetaRecord,
  persist: PersistMonetaSnapshot,
): Promise<{ record: StoredMonetaRecord; migrated: boolean }> {
  if (!needsLegacyAssetMigration(record.state)) return { record, migrated: false };
  const migratedState = normalizeSnapshot(record.state);
  const saved = await persist(migratedState, record.updatedAt);
  return { record: saved, migrated: true };
}

export function createDeviceAssetRecovery(
  remote: MonetaSnapshot,
  deviceBackup: MonetaSnapshot,
): MonetaSnapshot | null {
  if (remote.data.assets.length > 0 || deviceBackup.data.assets.length === 0) return null;

  const exchangeRates = { ...remote.data.exchangeRates };
  if (remote.data.displayCurrency === deviceBackup.data.displayCurrency) {
    deviceBackup.data.assets.forEach((asset) => {
      if (asset.currency === remote.data.displayCurrency || exchangeRates[asset.currency] > 0) return;
      const backupRate = deviceBackup.data.exchangeRates[asset.currency];
      if (backupRate > 0) exchangeRates[asset.currency] = backupRate;
    });
  }

  return {
    ...remote,
    data: {
      ...remote.data,
      assets: deviceBackup.data.assets.map((asset) => ({ ...asset })),
      exchangeRates,
    },
  };
}

export function toDisplayAmount(
  amount: number,
  currency: string,
  displayCurrency: string,
  exchangeRates: Record<string, number>,
): number | null {
  if (currency === displayCurrency) return finiteNonNegative(amount);
  const rate = exchangeRates[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return finiteNonNegative(amount) / rate;
}

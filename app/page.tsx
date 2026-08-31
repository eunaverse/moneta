"use client";

/* eslint-disable @next/next/no-img-element -- receipt previews use signed private-storage URLs */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { MonetaAuthGate, type MonetaAccount } from "../components/moneta-auth-gate";
import { addMonths, calculatePlanningCapacity, isDueInMonth, isPaidInMonth, monthIndex } from "../lib/budget-calculations";
import { createReceiptUrls, loadMonetaState, MonetaStateConflictError, removeReceipt, saveMonetaState, subscribeMonetaState, uploadReceipt, type MonetaStateRecord } from "../lib/moneta-repository";
import { createDefaultSnapshot, DEFAULT_EXPENSE_CATEGORIES, migrateLegacyAssetRecord, normalizeSnapshot, toDisplayAmount, type StoredMonetaSnapshot } from "../lib/moneta-state";
import { isE2EMode } from "../lib/e2e-mode";
import type { AssetBalance, BudgetState, CategorySort, LedgerAllocation, LedgerEntry, MonetaSnapshot, MonthlyBudgets, RecurringExpense } from "../lib/moneta-types";
import type { TransactionAiAllocationReviewField, TransactionAiResult, TransactionAiReviewField } from "../lib/transaction-ai";

type View = "overview" | "budget" | "fixed-costs" | "transactions" | "transaction-history" | "categories" | "what-if" | "insights" | "settings";
type FixedCostFilter = "all" | "monthly" | "one-time";
type TransactionTypeFilter = "all" | "income" | "expense";
type TransactionBudgetFilter = "all" | "monthly" | "outside";
type SelectionScope = "budgets" | "fixed-costs" | "transactions" | "categories";
type ItemActionState = {
  scope: SelectionScope;
  id: string;
  label: string;
  noun: string;
  left: number;
  top: number;
};
type SyncStatus = "loading" | "migration" | "saving" | "saved" | "error";
type TransactionAiStatus = "idle" | "loading" | "success" | "error";
type Locale = "en" | "ko";
type AssetEditorDraft = Pick<BudgetState, "assets" | "exchangeRates" | "monthlyIncome">;
type TransactionDraft = {
  date: string;
  type: "expense" | "income";
  category: string;
  description: string;
  amount: number;
  currency: string;
  countsTowardMonthlyBudget: boolean;
  allocations: LedgerAllocation[];
  linksPlannedPayment: boolean;
  plannedPaymentKey: string;
};

const defaultExpenseCategories = DEFAULT_EXPENSE_CATEGORIES;
const incomeCategories = ["Salary", "Bonus", "Investment", "Refund", "Other income"];
const localMonthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const localDateKey = (date = new Date()) => `${localMonthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
const millisecondsUntilNextLocalDay = (date = new Date()) => {
  const nextDay = new Date(date);
  nextDay.setHours(24, 0, 0, 50);
  return Math.max(1_000, nextDay.getTime() - date.getTime());
};

function useCurrentMonth() {
  const [currentMonth, setCurrentMonth] = useState(localMonthKey);

  useEffect(() => {
    let timer = 0;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshMonth, millisecondsUntilNextLocalDay());
    };
    const refreshMonth = () => {
      setCurrentMonth((current) => {
        const next = localMonthKey();
        return current === next ? current : next;
      });
      scheduleRefresh();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshMonth();
    };

    scheduleRefresh();
    window.addEventListener("focus", refreshMonth);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshMonth);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return currentMonth;
}
const initialSnapshot = createDefaultSnapshot(localMonthKey());
const defaultMonthlyBudgets: MonthlyBudgets = initialSnapshot.monthlyBudgets;
const defaultBudgetCategories = initialSnapshot.budgetCategories;
const defaults: BudgetState = initialSnapshot.data;
const fallbackCurrencyCodes = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW", "CNY", "INR", "CHF", "MXN", "BRL", "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "THB", "VND", "PHP", "IDR", "MYR", "AED", "SAR", "ZAR"];
const currencyCodes = (() => {
  try {
    return Array.from(new Set(["USD", ...Intl.supportedValuesOf("currency")])).sort();
  } catch {
    return fallbackCurrencyCodes;
  }
})();
const currencyNames = new Intl.DisplayNames("en", { type: "currency" });
const currencyLabel = (currency: string) => `${currency} · ${currencyNames.of(currency) || currency}`;
const readableMonth = (month: string, locale: Locale) => {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
};
const formatOriginalCurrency = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const entryAllocations = (entry: Pick<LedgerEntry, "type" | "category" | "description" | "amount" | "allocations">): LedgerAllocation[] => entry.type === "expense" && entry.allocations?.length
  ? entry.allocations
  : [{ category: entry.category, description: entry.description, amount: entry.amount }];
const entryCategoryNames = (entry: Pick<LedgerEntry, "type" | "category" | "description" | "amount" | "allocations">) => Array.from(new Set(entryAllocations(entry).map((allocation) => allocation.category).filter(Boolean)));
const primaryAllocationCategory = (allocations: LedgerAllocation[], fallback: string) => allocations.reduce((primary, allocation) => allocation.category && allocation.amount > primary.amount ? allocation : primary, { category: fallback, amount: -1 }).category;
const chartColors = ["#7057e8", "#2fc99a", "#f26b4f", "#f6c850", "#4d9de0", "#b36ae2", "#63c174", "#ef8354", "#8d99ae", "#d45087"];
type NavigationItem = { view: View; label: string; icon: string; legacyLabel?: string };
const navigationItems: NavigationItem[] = [
  { view: "overview", label: "Overview", icon: "◫" },
  { view: "transactions", label: "Transactions", icon: "↕" },
  { view: "budget", label: "Budget", icon: "◎" },
  { view: "what-if", label: "Try a scenario", legacyLabel: "What-if", icon: "◈" },
  { view: "insights", label: "Spending insights", legacyLabel: "Insights", icon: "✦" },
  { view: "settings", label: "Plan setup", legacyLabel: "Settings", icon: "⚙" },
];
const navigationLabels: Record<Locale, Partial<Record<View, string>>> = {
  en: { overview: "Overview", transactions: "Transactions", budget: "Budget", "what-if": "Try a scenario", insights: "Spending insights", settings: "Plan setup" },
  ko: { overview: "오늘", transactions: "거래 내역", budget: "계획", "what-if": "조건 바꿔보기", insights: "지출 분석", settings: "계획 설정" },
};
const viewValues: View[] = ["overview", "budget", "fixed-costs", "transactions", "transaction-history", "categories", "what-if", "insights", "settings"];
const viewFromUrl = () => {
  const value = new URL(window.location.href).searchParams.get("view");
  return value && viewValues.includes(value as View) ? value as View : "overview";
};
const urlForView = (view: View) => {
  const url = new URL(window.location.href);
  if (view === "overview") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  return `${url.pathname}${url.search}${url.hash}`;
};
const RECEIPT_DB = "moneta-receipts";
const RECEIPT_STORE = "images";
const openReceiptDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(RECEIPT_DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(RECEIPT_STORE)) request.result.createObjectStore(RECEIPT_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const readLocalReceipt = async (id: string) => {
  const db = await openReceiptDb();
  const receipt = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(RECEIPT_STORE, "readonly").objectStore(RECEIPT_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return receipt;
};
const summarizeSchedule = (items: RecurringExpense[]) => {
  const names = items.slice(0, 3).map((item) => item.name).join(" · ");
  return `${names}${items.length > 3 ? ` · +${items.length - 3} more` : ""}`;
};

const readLegacySnapshot = (): MonetaSnapshot | null => {
  const keys = ["move-money-budget", "move-money-ledger", "move-money-budget-plan", "move-money-expense-categories", "move-money-budget-categories", "move-money-recurring-expenses"];
  if (!keys.some((key) => window.localStorage.getItem(key))) return null;
  try {
    return normalizeSnapshot({
      version: 1,
      data: JSON.parse(window.localStorage.getItem("move-money-budget") || "null") || defaults,
      entries: JSON.parse(window.localStorage.getItem("move-money-ledger") || "[]"),
      monthlyBudgets: JSON.parse(window.localStorage.getItem("move-money-budget-plan") || "{}"),
      expenseCategories: JSON.parse(window.localStorage.getItem("move-money-expense-categories") || "null") || defaultExpenseCategories,
      budgetCategories: JSON.parse(window.localStorage.getItem("move-money-budget-categories") || "null") || [],
      categorySort: (window.localStorage.getItem("move-money-category-sort") as CategorySort | null) || "manual",
      recurringExpenses: JSON.parse(window.localStorage.getItem("move-money-recurring-expenses") || "[]"),
      insightMonths: Number(window.localStorage.getItem("move-money-insight-months")) || 6,
    } as StoredMonetaSnapshot);
  } catch {
    return null;
  }
};

const formatEditableMoney = (value: number) => value
  ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
  : "";
const parseEditableMoney = (value: string) => Math.max(0, Number(value.replace(/[^\d.]/g, "")) || 0);
const parseSignedEditableMoney = (value: string) => Number(value.replace(/[^\d.-]/g, "")) || 0;

const sanitizeTransactionAmountText = (value: string) => {
  const cleaned = value.replace(/[^\d.]/g, "");
  const decimalIndex = cleaned.indexOf(".");
  if (decimalIndex < 0) return cleaned;
  const whole = cleaned.slice(0, decimalIndex) || "0";
  const fraction = cleaned.slice(decimalIndex + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${fraction}`;
};

function TransactionAmountField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(() => formatEditableMoney(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(formatEditableMoney(value));
  }, [value]);

  return <label>
    <span>Amount</span>
    <input
      type="text"
      inputMode="decimal"
      required
      value={text}
      placeholder="0"
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => {
        const next = sanitizeTransactionAmountText(event.target.value);
        setText(next);
        onChange(parseEditableMoney(next));
      }}
      onBlur={() => {
        focusedRef.current = false;
        setText(formatEditableMoney(parseEditableMoney(text)));
      }}
    />
  </label>;
}

function MoneyInput({ label, value, onChange, unit, step = 1 }: { label: string; value: number; onChange: (value: number) => void; unit: string; step?: number }) {
  return (
    <label className="money-input">
      <span>{label}</span>
      <div><input type="text" inputMode="decimal" data-step={step} value={formatEditableMoney(value)} placeholder="0" onChange={(event) => onChange(parseEditableMoney(event.target.value))} /><i>{unit}</i></div>
    </label>
  );
}

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" /></svg>;
}

function LoadMore({ shown, total, step, onLoad }: { shown: number; total: number; step: number; onLoad: () => void }) {
  if (shown >= total) return null;
  return <button className="load-more" type="button" onClick={onLoad}>Load more <span>+{Math.min(step, total - shown)}</span></button>;
}

function SelectionBar({ count, noun, onDelete, onCancel }: { count: number; noun: string; onDelete: () => void; onCancel: () => void }) {
  return <div className="selection-bar" role="status"><strong>{count} selected</strong><div><button type="button" className="selection-cancel" onClick={onCancel}>Cancel</button><button type="button" className="selection-delete" disabled={count === 0} onClick={onDelete}><TrashIcon /> Delete {noun}</button></div></div>;
}

type CalculationRow = { label: string; value: string; detail?: string; tone?: "subtract" | "result" };

function CalculationValue({ label, value, formula, rows, note, className = "", align = "right" }: { label: string; value: string; formula: string; rows: CalculationRow[]; note?: string; className?: string; align?: "left" | "right" }) {
  const tooltipId = useId();
  return <button type="button" className={`calculation-value ${className} align-${align}`} aria-label={`${label}: ${value}. Show calculation details.`} aria-describedby={tooltipId}>
    <strong>{value}</strong><span className="calculation-badge" aria-hidden="true">i</span>
    <span className="calculation-tooltip" id={tooltipId} role="tooltip">
      <span className="calculation-tooltip-title">{label}</span>
      <code>{formula}</code>
      <span className="calculation-rows">{rows.map((row, index) => <span className={`calculation-row ${row.tone || ""}`} key={`${row.label}-${index}`}><span><b>{row.label}</b>{row.detail && <small>{row.detail}</small>}</span><strong>{row.value}</strong></span>)}</span>
      {note && <small className="calculation-note">{note}</small>}
    </span>
  </button>;
}

function MonetaDashboard({ account }: { account: MonetaAccount }) {
  const currentMonth = useCurrentMonth();
  const [view, setView] = useState<View>("overview");
  const [locale, setLocale] = useState<Locale>("en");
  const [data, setData] = useState<BudgetState>(defaults);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudgets>(defaultMonthlyBudgets);
  const [expenseCategories, setExpenseCategories] = useState(defaultExpenseCategories);
  const [budgetCategories, setBudgetCategories] = useState(defaultBudgetCategories);
  const [budgetCategoryDraft, setBudgetCategoryDraft] = useState("");
  const [categorySort, setCategorySort] = useState<CategorySort>("manual");
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [fixedCostFilter, setFixedCostFilter] = useState<FixedCostFilter>("all");
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("all");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<TransactionTypeFilter>("all");
  const [transactionBudgetFilter, setTransactionBudgetFilter] = useState<TransactionBudgetFilter>("all");
  const [newCategory, setNewCategory] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(localMonthKey);
  const [insightMonths, setInsightMonths] = useState(6);
  const [draft, setDraft] = useState<TransactionDraft>({ date: localDateKey(), type: "expense", category: "Food", description: "", amount: 0, currency: "USD", countsTowardMonthlyBudget: true, allocations: [], linksPlannedPayment: false, plannedPaymentKey: "" });
  const [transactionAiDescription, setTransactionAiDescription] = useState("");
  const [transactionAiStatus, setTransactionAiStatus] = useState<TransactionAiStatus>("idle");
  const [transactionAiMessage, setTransactionAiMessage] = useState("");
  const [transactionAiReviewFields, setTransactionAiReviewFields] = useState<TransactionAiReviewField[]>([]);
  const [transactionAiAllocationReviewFields, setTransactionAiAllocationReviewFields] = useState<TransactionAiAllocationReviewField[][]>([]);
  const [transactionEntryMode, setTransactionEntryMode] = useState<"ai" | "manual">("ai");
  const [recurringDraft, setRecurringDraft] = useState({ name: "Rent", category: "Housing", amount: 0, intervalMonths: 1, startMonth: localMonthKey(), endMonth: "" });
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);
  const [assetDraft, setAssetDraft] = useState<AssetEditorDraft>({ assets: [], exchangeRates: {}, monthlyIncome: 0 });
  const [rateCurrencyDraft, setRateCurrencyDraft] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptInputKey, setReceiptInputKey] = useState(0);
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [activeReceiptUrl, setActiveReceiptUrl] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [transactionDetailEntryId, setTransactionDetailEntryId] = useState<string | null>(null);
  const [selectionScope, setSelectionScope] = useState<SelectionScope | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemActions, setItemActions] = useState<ItemActionState | null>(null);
  const [overviewTransactionLimit, setOverviewTransactionLimit] = useState(3);
  const [activityLimit, setActivityLimit] = useState(4);
  const [transactionLimit, setTransactionLimit] = useState(8);
  const [transactionStatsLimit, setTransactionStatsLimit] = useState(5);
  const [budgetListLimit, setBudgetListLimit] = useState(5);
  const [fixedCostLimit, setFixedCostLimit] = useState(8);
  const [categoryLimit, setCategoryLimit] = useState(8);
  const [overLimitLimit, setOverLimitLimit] = useState(5);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [whatIf, setWhatIf] = useState({ oneTime: 0, monthlyChange: 0 });
  const [undoAction, setUndoAction] = useState<{ message: string; restore: () => void } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [planPeriodSetupOpen, setPlanPeriodSetupOpen] = useState(false);
  const [planPeriodDraft, setPlanPeriodDraft] = useState({ startMonth: "", endMonth: "" });
  const [legacySnapshot, setLegacySnapshot] = useState<MonetaSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [syncMessage, setSyncMessage] = useState("");
  const [remoteConflict, setRemoteConflict] = useState<MonetaStateRecord | null>(null);
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const lastCloudSnapshotJsonRef = useRef<string | null>(null);
  const currentSnapshotRef = useRef<MonetaSnapshot | null>(null);
  const currentSnapshotJsonRef = useRef("");
  const remoteConflictRef = useRef<MonetaStateRecord | null>(null);
  const submittedSnapshotJsonsRef = useRef(new Set<string>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const localeInitializedRef = useRef(false);
  const transactionDetailDialogRef = useRef<HTMLElement>(null);
  const transactionDetailCloseRef = useRef<HTMLButtonElement>(null);
  const transactionDetailOpenerRef = useRef<HTMLButtonElement | null>(null);
  const itemActionMenuRef = useRef<HTMLDivElement>(null);
  const itemActionTriggerRef = useRef<HTMLElement | null>(null);
  const itemLongPressTimerRef = useRef(0);
  const itemLongPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextItemClickRef = useRef(false);

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("moneta-locale");
    const timer = window.setTimeout(() => {
      if (savedLocale === "ko") setLocale("ko");
      localeInitializedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!localeInitializedRef.current) return;
    window.localStorage.setItem("moneta-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  const navLabel = (item: NavigationItem) => navigationLabels[locale][item.view] || item.label;
  const navAccessibleLabel = (item: NavigationItem) => item.legacyLabel ? `${navLabel(item)} · ${item.legacyLabel}` : navLabel(item);
  const money = useMemo(() => new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { style: "currency", currency: data.displayCurrency, maximumFractionDigits: 0 }), [data.displayCurrency, locale]);
  const moneyDetailed = useMemo(() => new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { style: "currency", currency: data.displayCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }), [data.displayCurrency, locale]);

  const currentSnapshot = useMemo<MonetaSnapshot>(() => ({
    version: 2,
    data,
    entries,
    monthlyBudgets,
    expenseCategories,
    budgetCategories,
    categorySort,
    recurringExpenses,
    insightMonths,
  }), [budgetCategories, categorySort, data, entries, expenseCategories, insightMonths, monthlyBudgets, recurringExpenses]);
  const currentSnapshotJson = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot]);
  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
    currentSnapshotJsonRef.current = currentSnapshotJson;
  }, [currentSnapshot, currentSnapshotJson]);

  const applySnapshot = useCallback((snapshot: MonetaSnapshot | StoredMonetaSnapshot) => {
    const normalized = normalizeSnapshot(snapshot);
    setData(normalized.data);
    setEntries(normalized.entries);
    setMonthlyBudgets(normalized.monthlyBudgets);
    setExpenseCategories(normalized.expenseCategories);
    setBudgetCategories(normalized.budgetCategories);
    setCategorySort(normalized.categorySort);
    setRecurringExpenses(normalized.recurringExpenses);
    setInsightMonths(normalized.insightMonths);
    setDraft((current) => ({ ...current, currency: normalized.data.displayCurrency }));
  }, []);

  const registerRemoteConflict = useCallback((record: MonetaStateRecord) => {
    remoteConflictRef.current = record;
    setRemoteConflict(record);
    setSyncStatus("error");
    setSyncMessage("Newer changes were saved from another window.");
  }, []);

  const acceptRemoteRecord = useCallback((record: MonetaStateRecord) => {
    const normalized = normalizeSnapshot(record.state);
    const recordJson = JSON.stringify(normalized);
    const currentUpdatedAt = remoteUpdatedAtRef.current;
    if (currentUpdatedAt && Date.parse(record.updatedAt) <= Date.parse(currentUpdatedAt)) return;

    if (submittedSnapshotJsonsRef.current.has(recordJson)) {
      remoteUpdatedAtRef.current = record.updatedAt;
      lastCloudSnapshotJsonRef.current = recordJson;
      if (currentSnapshotJsonRef.current === recordJson) {
        setSyncStatus("saved");
        setSyncMessage("");
      }
      return;
    }

    const hasLocalChanges = lastCloudSnapshotJsonRef.current !== null
      && currentSnapshotJsonRef.current !== lastCloudSnapshotJsonRef.current;
    if (hasLocalChanges) {
      registerRemoteConflict({ ...record, state: normalized });
      return;
    }

    remoteUpdatedAtRef.current = record.updatedAt;
    lastCloudSnapshotJsonRef.current = recordJson;
    applySnapshot(normalized);
    setSyncStatus("saved");
    setSyncMessage("Updated from another window.");
  }, [applySnapshot, registerRemoteConflict]);

  /* eslint-disable react-hooks/set-state-in-effect -- account hydration is the state boundary */
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setCloudReady(false);
    setPlanPeriodSetupOpen(false);
    setPlanPeriodDraft({ startMonth: "", endMonth: "" });
    setLegacySnapshot(null);
    setSyncStatus("loading");
    setSyncMessage("");
    setRemoteConflict(null);
    remoteConflictRef.current = null;
    remoteUpdatedAtRef.current = null;
    lastCloudSnapshotJsonRef.current = null;
    loadMonetaState(account.session.user.id).then(async (remote) => {
      if (!active) return;
      if (remote) {
        let acceptedRemote: { state: StoredMonetaSnapshot; updatedAt: string } = remote;
        let migrationMessage = "";
        let migrationFailed = false;
        try {
          const migration = await migrateLegacyAssetRecord(remote, (state, expectedUpdatedAt) => (
            saveMonetaState(account.session.user.id, state, expectedUpdatedAt)
          ));
          acceptedRemote = migration.record;
          if (migration.migrated) migrationMessage = "Saved balances were updated to the current format.";
        } catch (error) {
          migrationFailed = true;
          if (error instanceof MonetaStateConflictError) {
            const latest = await loadMonetaState(account.session.user.id).catch(() => null);
            if (latest) acceptedRemote = latest;
          }
          migrationMessage = "Balances loaded, but their saved format could not be updated yet.";
        }
        if (!active) return;
        const normalized = normalizeSnapshot(acceptedRemote.state);
        remoteUpdatedAtRef.current = acceptedRemote.updatedAt;
        lastCloudSnapshotJsonRef.current = JSON.stringify(normalized);
        applySnapshot(normalized);
        setCloudReady(true);
        setSyncStatus(migrationFailed ? "error" : "saved");
        setSyncMessage(migrationMessage);
      } else {
        const legacy = readLegacySnapshot();
        if (legacy) {
          applySnapshot(legacy);
          setLegacySnapshot(legacy);
          setSyncStatus("migration");
        } else {
          applySnapshot(createDefaultSnapshot());
          const forceFirstUse = isE2EMode && new URL(window.location.href).searchParams.get("first-use") === "1";
          if (!isE2EMode || forceFirstUse) {
            setPlanPeriodSetupOpen(true);
            setSyncStatus("loading");
          } else {
            setCloudReady(true);
            setSyncStatus("saving");
          }
        }
      }
      setLoaded(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setSyncStatus("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not load your account data.");
      setLoaded(true);
    });
    return () => { active = false; };
  }, [account.session.user.id, applySnapshot]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded || !cloudReady || remoteConflictRef.current) return;
    if (currentSnapshotJson === lastCloudSnapshotJsonRef.current) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSyncStatus("saving");
      submittedSnapshotJsonsRef.current.add(currentSnapshotJson);
      const save = async () => {
        if (remoteConflictRef.current) throw new MonetaStateConflictError();
        const saved = await saveMonetaState(account.session.user.id, currentSnapshot, remoteUpdatedAtRef.current);
        remoteUpdatedAtRef.current = saved.updatedAt;
        lastCloudSnapshotJsonRef.current = currentSnapshotJson;
      };
      const queued = saveQueueRef.current.catch(() => undefined).then(save);
      saveQueueRef.current = queued;
      queued.then(() => {
        submittedSnapshotJsonsRef.current.delete(currentSnapshotJson);
        if (active && currentSnapshotJsonRef.current === currentSnapshotJson) {
          setSyncStatus("saved");
          setSyncMessage("");
        }
      }).catch(async (error: unknown) => {
        submittedSnapshotJsonsRef.current.delete(currentSnapshotJson);
        if (!active) return;
        if (error instanceof MonetaStateConflictError) {
          const latest = await loadMonetaState(account.session.user.id).catch(() => null);
          if (latest && active) registerRemoteConflict(latest);
          else if (active) {
            setSyncStatus("error");
            setSyncMessage("Newer changes exist. Reload before saving again.");
          }
          return;
        }
        setSyncStatus("error");
        setSyncMessage(error instanceof Error ? error.message : "Changes could not be synced.");
      });
    }, 700);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [account.session.user.id, cloudReady, currentSnapshot, currentSnapshotJson, loaded, registerRemoteConflict]);
  useEffect(() => {
    if (!loaded || !cloudReady) return;
    return subscribeMonetaState(account.session.user.id, acceptRemoteRecord);
  }, [acceptRemoteRecord, account.session.user.id, cloudReady, loaded]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [view]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenuOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);
  useEffect(() => {
    if (!undoAction) return;
    const timer = window.setTimeout(() => setUndoAction(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undoAction]);
  useEffect(() => {
    if (!itemActions) return;
    const focusFrame = window.requestAnimationFrame(() => itemActionMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setItemActions(null);
      const trigger = itemActionTriggerRef.current;
      itemActionTriggerRef.current = null;
      if (trigger) window.requestAnimationFrame(() => trigger.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [itemActions]);
  useEffect(() => () => window.clearTimeout(itemLongPressTimerRef.current), []);
  useEffect(() => {
    if (!loaded || !cloudReady) return;
    let cancelled = false;
    const receiptEntries = entries.filter((entry): entry is LedgerEntry & { receiptId: string } => Boolean(entry.receiptId));
    createReceiptUrls(receiptEntries.map((entry) => entry.receiptId)).then((urls) => {
      if (!cancelled) setReceiptUrls(Object.fromEntries(receiptEntries.flatMap((entry) => urls[entry.receiptId] ? [[entry.id, urls[entry.receiptId]]] : [])));
    }).catch(() => {
      if (!cancelled) setReceiptUrls({});
    });
    return () => { cancelled = true; };
  }, [cloudReady, entries, loaded]);

  const moveLegacyDataToAccount = async () => {
    if (!legacySnapshot) return;
    setSyncStatus("saving");
    setSyncMessage("Moving browser data and receipts…");
    let receiptFailures = 0;
    const pendingSnapshot: MonetaSnapshot = { version: 2, data, entries, monthlyBudgets, expenseCategories, budgetCategories, categorySort, recurringExpenses, insightMonths };
    const migratedEntries: LedgerEntry[] = [];
    for (const entry of pendingSnapshot.entries) {
      if (!entry.receiptId) {
        migratedEntries.push(entry);
        continue;
      }
      if (!("indexedDB" in window)) {
        migratedEntries.push({ ...entry, receiptId: undefined });
        continue;
      }
      try {
        const blob = await readLocalReceipt(entry.receiptId);
        if (!blob) {
          migratedEntries.push({ ...entry, receiptId: undefined });
          continue;
        }
        const file = new File([blob], `${entry.id}.jpg`, { type: blob.type || "image/jpeg" });
        const receiptId = await uploadReceipt(account.session.user.id, entry.id, file);
        migratedEntries.push({ ...entry, receiptId });
      } catch {
        receiptFailures += 1;
        migratedEntries.push({ ...entry, receiptId: undefined });
      }
    }
    const migrated = { ...pendingSnapshot, entries: migratedEntries };
    try {
      const saved = await saveMonetaState(account.session.user.id, migrated, remoteUpdatedAtRef.current);
      remoteUpdatedAtRef.current = saved.updatedAt;
      lastCloudSnapshotJsonRef.current = JSON.stringify(normalizeSnapshot(migrated));
      applySnapshot(migrated);
      setLegacySnapshot(null);
      setCloudReady(true);
      setSyncStatus("saved");
      setSyncMessage(receiptFailures ? `${receiptFailures} receipt photo${receiptFailures === 1 ? "" : "s"} could not be moved. Your financial records are synced.` : "Browser data moved to your account. The local copy was kept as a backup.");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(error instanceof Error ? error.message : "Browser data could not be moved.");
    }
  };

  const startWithEmptyAccount = () => {
    if (!window.confirm("Start without this browser data? You will choose your planning dates next, and the old local copy will remain on this device.")) return;
    const empty = createDefaultSnapshot();
    applySnapshot(empty);
    setLegacySnapshot(null);
    setPlanPeriodDraft({ startMonth: "", endMonth: "" });
    setPlanPeriodSetupOpen(true);
    setSyncStatus("loading");
  };

  const planPeriodEndMinimum = planPeriodDraft.startMonth
    ? monthIndex(planPeriodDraft.startMonth) > monthIndex(currentMonth) ? planPeriodDraft.startMonth : currentMonth
    : "";
  const planPeriodDraftValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(planPeriodDraft.startMonth)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(planPeriodDraft.endMonth)
    && monthIndex(planPeriodDraft.endMonth) >= monthIndex(planPeriodEndMinimum);
  const completePlanPeriodSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!planPeriodDraftValid) return;
    setData((current) => ({
      ...current,
      planningStartMonth: planPeriodDraft.startMonth,
      planningEndMonth: planPeriodDraft.endMonth,
    }));
    setSelectedMonth(planPeriodDraft.startMonth);
    setPlanPeriodSetupOpen(false);
    setCloudReady(true);
    setSyncStatus("saving");
  };

  const useCloudVersion = () => {
    if (!remoteConflict) return;
    const normalized = normalizeSnapshot(remoteConflict.state);
    remoteUpdatedAtRef.current = remoteConflict.updatedAt;
    lastCloudSnapshotJsonRef.current = JSON.stringify(normalized);
    remoteConflictRef.current = null;
    setRemoteConflict(null);
    applySnapshot(normalized);
    setSyncStatus("saved");
    setSyncMessage("Latest cloud changes loaded.");
  };

  const keepMyVersion = async () => {
    if (!remoteConflict || !currentSnapshotRef.current) return;
    const local = currentSnapshotRef.current;
    const localJson = JSON.stringify(local);
    setSyncStatus("saving");
    submittedSnapshotJsonsRef.current.add(localJson);
    try {
      const saved = await saveMonetaState(account.session.user.id, local, remoteConflict.updatedAt);
      remoteUpdatedAtRef.current = saved.updatedAt;
      lastCloudSnapshotJsonRef.current = localJson;
      remoteConflictRef.current = null;
      setRemoteConflict(null);
      setSyncStatus("saved");
      setSyncMessage("This version is now synced.");
    } catch (error) {
      if (error instanceof MonetaStateConflictError) {
        const latest = await loadMonetaState(account.session.user.id).catch(() => null);
        if (latest) registerRemoteConflict(latest);
        else {
          setSyncStatus("error");
          setSyncMessage("The cloud version changed again. Try once more.");
        }
      } else {
        setSyncStatus("error");
        setSyncMessage(error instanceof Error ? error.message : "Changes could not be synced.");
      }
    } finally {
      submittedSnapshotJsonsRef.current.delete(localJson);
    }
  };

  const set = <K extends keyof BudgetState>(key: K, value: BudgetState[K]) => setData((current) => ({ ...current, [key]: value }));
  const requiredAssetDraftCurrencies = Array.from(new Set([...assetDraft.assets.map((asset) => asset.currency), ...entries.map((entry) => entry.currency)]))
    .filter((currency) => currency !== data.displayCurrency)
    .sort();
  const missingAssetDraftRates = requiredAssetDraftCurrencies.filter((currency) => !(assetDraft.exchangeRates[currency] > 0));
  const openAssetEditor = () => {
    setAssetDraft({ assets: data.assets.map((asset) => ({ ...asset })), exchangeRates: { ...data.exchangeRates }, monthlyIncome: data.monthlyIncome });
    setAssetEditorOpen(true);
  };
  const addAsset = () => setAssetDraft((current) => ({
    ...current,
    assets: [...current.assets, { id: crypto.randomUUID ? crypto.randomUUID() : `asset-${Date.now()}`, name: "", amount: 0, currency: data.displayCurrency }],
  }));
  const updateAsset = (id: string, updates: Partial<AssetBalance>) => setAssetDraft((current) => ({
    ...current,
    assets: current.assets.map((asset) => asset.id === id ? { ...asset, ...updates } : asset),
  }));
  const removeAsset = (id: string) => setAssetDraft((current) => ({ ...current, assets: current.assets.filter((asset) => asset.id !== id) }));
  const saveAssetEditor = () => {
    if (missingAssetDraftRates.length > 0 || assetDraft.assets.some((asset) => !asset.name.trim())) return;
    setData((current) => ({
      ...current,
      assets: assetDraft.assets.map((asset) => ({ ...asset, name: asset.name.trim() })),
      exchangeRates: { ...assetDraft.exchangeRates },
      monthlyIncome: assetDraft.monthlyIncome,
    }));
    setAssetEditorOpen(false);
  };
  const changeDisplayCurrency = (nextCurrency: string) => {
    if (nextCurrency === data.displayCurrency) return;
    const hasMoney = data.assets.some((asset) => asset.amount > 0)
      || entries.some((entry) => entry.amount > 0)
      || Object.values(monthlyBudgets).some((amount) => amount > 0)
      || recurringExpenses.some((item) => item.amount > 0)
      || data.monthlyIncome > 0;
    if (!hasMoney) {
      setData((current) => ({ ...current, displayCurrency: nextCurrency, exchangeRates: {} }));
      setDraft((current) => ({ ...current, currency: nextCurrency }));
      setWhatIf({ oneTime: 0, monthlyChange: 0 });
      return;
    }
    const unitsOfNextPerCurrent = data.exchangeRates[nextCurrency];
    if (!(unitsOfNextPerCurrent > 0)) {
      window.alert(`Add a positive ${nextCurrency} per ${data.displayCurrency} exchange rate before changing the primary currency.`);
      return;
    }
    const nextRates: Record<string, number> = {};
    const knownCurrencies = new Set([...Object.keys(data.exchangeRates), data.displayCurrency]);
    knownCurrencies.forEach((currency) => {
      if (currency === nextCurrency) return;
      const unitsPerCurrent = currency === data.displayCurrency ? 1 : data.exchangeRates[currency];
      if (unitsPerCurrent > 0) nextRates[currency] = unitsPerCurrent / unitsOfNextPerCurrent;
    });
    setData((current) => ({
      ...current,
      displayCurrency: nextCurrency,
      exchangeRates: nextRates,
      monthlyIncome: current.monthlyIncome * unitsOfNextPerCurrent,
    }));
    setMonthlyBudgets((current) => Object.fromEntries(Object.entries(current).map(([category, amount]) => [category, amount * unitsOfNextPerCurrent])));
    setRecurringExpenses((current) => current.map((item) => ({ ...item, amount: item.amount * unitsOfNextPerCurrent })));
    setWhatIf((current) => ({ oneTime: current.oneTime * unitsOfNextPerCurrent, monthlyChange: current.monthlyChange * unitsOfNextPerCurrent }));
    setDraft((current) => ({ ...current, currency: current.currency === data.displayCurrency ? nextCurrency : current.currency }));
  };
  const addExchangeRateCurrency = () => {
    if (!rateCurrencyDraft || rateCurrencyDraft === data.displayCurrency) return;
    setData((current) => ({ ...current, exchangeRates: { ...current.exchangeRates, [rateCurrencyDraft]: current.exchangeRates[rateCurrencyDraft] || 0 } }));
    setRateCurrencyDraft("");
  };
  const toDisplay = useCallback((entry: Pick<LedgerEntry, "amount" | "currency">) => toDisplayAmount(entry.amount, entry.currency, data.displayCurrency, data.exchangeRates) ?? 0, [data.displayCurrency, data.exchangeRates]);
  const categoryAmountInDisplayCurrency = useCallback((entry: LedgerEntry, category: string) => entryAllocations(entry)
    .filter((allocation) => allocation.category === category)
    .reduce((sum, allocation) => sum + (toDisplayAmount(allocation.amount, entry.currency, data.displayCurrency, data.exchangeRates) ?? 0), 0), [data.displayCurrency, data.exchangeRates]);
  const currenciesInUse = Array.from(new Set([...data.assets.map((asset) => asset.currency), ...entries.map((entry) => entry.currency)]));
  const missingExchangeRateCurrencies = currenciesInUse.filter((currency) => currency !== data.displayCurrency && !(data.exchangeRates[currency] > 0));
  const draftNeedsExchangeRate = draft.currency !== data.displayCurrency && !(data.exchangeRates[draft.currency] > 0);
  const result = useMemo(() => {
    const startingAssets = data.assets.reduce((sum, asset) => sum + (toDisplayAmount(asset.amount, asset.currency, data.displayCurrency, data.exchangeRates) ?? 0), 0);
    const ledgerNet = entries.reduce((sum, entry) => sum + (entry.type === "income" ? toDisplay(entry) : -toDisplay(entry)), 0);
    return { startingAssets, ledgerNet, total: startingAssets + ledgerNet };
  }, [data.assets, data.displayCurrency, data.exchangeRates, entries, toDisplay]);
  const startingAssets = result.startingAssets;
  const allTimeIncome = entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + toDisplay(entry), 0);
  const allTimeExpense = entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + toDisplay(entry), 0);
  const totalMoneyAvailable = startingAssets + allTimeIncome;
  const wealthRemainingPercent = totalMoneyAvailable > 0 ? Math.max(0, Math.min(100, result.total / totalMoneyAvailable * 100)) : 0;
  const isPlanUnconfigured = startingAssets <= 0 && data.monthlyIncome <= 0 && entries.length === 0 && recurringExpenses.length === 0;

  const monthEntries = entries.filter((entry) => entry.date.startsWith(selectedMonth)).sort((a, b) => b.date.localeCompare(a.date));
  const monthlyIncomeTotal = monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + toDisplay(entry), 0);
  const monthlyExpenseTotal = monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + toDisplay(entry), 0);
  const activeBudgetCategories = budgetCategories.filter((category) => expenseCategories.includes(category));
  const availableBudgetCategories = expenseCategories.filter((category) => !activeBudgetCategories.includes(category));
  const monthlyBudgetTotal = activeBudgetCategories.reduce((sum, category) => sum + (monthlyBudgets[category] || 0), 0);
  const hasCategoryBudgetData = activeBudgetCategories.length > 0;
  const hasCategoryBudgetLimits = monthlyBudgetTotal > 0;
  const forecastStartMonth = monthIndex(currentMonth) > monthIndex(data.planningStartMonth) ? currentMonth : data.planningStartMonth;
  const planningCapacity = calculatePlanningCapacity({ currentNetWorth: result.total, recurringExpenses, reservationStartMonth: data.planningStartMonth, startMonth: forecastStartMonth, endMonth: data.planningEndMonth });
  const remainingPlanningMonths = planningCapacity.remainingMonths;
  const planningPeriodLabel = `${data.planningStartMonth}–${data.planningEndMonth}`;
  const planningEndLabel = readableMonth(data.planningEndMonth, locale);
  const planningFormula = remainingPlanningMonths > 0
    ? `max($0, (${moneyDetailed.format(result.total)} − ${moneyDetailed.format(planningCapacity.scheduledTotal)}) ÷ ${remainingPlanningMonths})`
    : "Plan ended — choose a new end month";
  const { plannedOccurrences } = planningCapacity;
  const selectedMonthlyFixedItems = recurringExpenses.filter((item) => item.intervalMonths > 0 && isDueInMonth(item, selectedMonth));
  const fixedMonthlyTotal = selectedMonthlyFixedItems.reduce((sum, item) => sum + item.amount, 0);
  const selectedOneTimeItems = recurringExpenses.filter((item) => item.intervalMonths === 0 && isDueInMonth(item, selectedMonth));
  const selectedOneTimeTotal = selectedOneTimeItems.reduce((sum, item) => sum + item.amount, 0);
  const scheduledItems = recurringExpenses.filter((item) => isDueInMonth(item, selectedMonth) && !isPaidInMonth(item, selectedMonth));
  const scheduledThisMonthTotal = scheduledItems.reduce((sum, item) => sum + item.amount, 0);
  const monthlyFlexibleBudgetForSelectedMonth = monthlyBudgetTotal;
  const spentByCategory = Object.fromEntries(expenseCategories.map((category) => [category, monthEntries.filter((entry) => entry.type === "expense" && entry.countsTowardMonthlyBudget !== false).reduce((sum, entry) => sum + categoryAmountInDisplayCurrency(entry, category), 0)])) as Record<string, number>;
  const monthlyBudgetExpenseTotal = activeBudgetCategories.filter((category) => (monthlyBudgets[category] || 0) > 0).reduce((sum, category) => sum + (spentByCategory[category] || 0), 0);
  const monthlyUnbudgetedExpenseTotal = activeBudgetCategories.filter((category) => (monthlyBudgets[category] || 0) <= 0).reduce((sum, category) => sum + (spentByCategory[category] || 0), 0);
  const categoriesNeedingLimits = activeBudgetCategories.filter((category) => (monthlyBudgets[category] || 0) <= 0);
  const budgetAvailable = monthlyBudgetTotal - monthlyBudgetExpenseTotal;
  const displayedBudgetCategories = [...activeBudgetCategories].sort((first, second) => {
    const originalOrder = activeBudgetCategories.indexOf(first) - activeBudgetCategories.indexOf(second);
    if (categorySort === "budget-desc") return (monthlyBudgets[second] || 0) - (monthlyBudgets[first] || 0) || originalOrder;
    if (categorySort === "alphabetical") return first.localeCompare(second);
    if (categorySort === "spent-desc") return (spentByCategory[second] || 0) - (spentByCategory[first] || 0) || originalOrder;
    if (categorySort === "spent-asc") return (spentByCategory[first] || 0) - (spentByCategory[second] || 0) || originalOrder;
    return originalOrder;
  });
  let budgetDonutCursor = 0;
  const budgetCategoryStats = activeBudgetCategories.map((category) => ({ category, amount: monthlyBudgets[category] || 0, color: chartColors[Math.max(0, expenseCategories.indexOf(category)) % chartColors.length] })).filter((item) => item.amount > 0).sort((first, second) => second.amount - first.amount);
  const budgetDonutGradient = monthlyBudgetTotal > 0 ? `conic-gradient(${budgetCategoryStats.map((item) => { const start = budgetDonutCursor; budgetDonutCursor += item.amount / monthlyBudgetTotal * 100; return `${item.color} ${start}% ${budgetDonutCursor}%`; }).join(", ")})` : "conic-gradient(#e8e5ef 0 100%)";
  const editingEntry = editingEntryId ? entries.find((entry) => entry.id === editingEntryId) : undefined;
  const editingPlannedOccurrence = editingEntry?.plannedExpenseId && editingEntry.plannedExpenseMonth
    ? (() => {
        const expense = recurringExpenses.find((item) => item.id === editingEntry.plannedExpenseId);
        return expense ? { key: `${expense.id}::${editingEntry.plannedExpenseMonth}`, expenseId: expense.id, month: editingEntry.plannedExpenseMonth!, name: expense.name, amount: expense.amount, category: expense.category } : null;
      })()
    : null;
  const selectablePlannedOccurrences = editingPlannedOccurrence && !plannedOccurrences.some((item) => item.key === editingPlannedOccurrence.key) ? [editingPlannedOccurrence, ...plannedOccurrences] : plannedOccurrences;
  const currentScheduledItems = recurringExpenses.filter((item) => isDueInMonth(item, currentMonth) && !isPaidInMonth(item, currentMonth));
  const currentScheduledTotal = currentScheduledItems.reduce((sum, item) => sum + item.amount, 0);
  const overdueScheduledPayments = planningCapacity.scheduledPayments.filter((item) => item.overdueMonths.length > 0);
  const overdueScheduledCount = overdueScheduledPayments.reduce((sum, item) => sum + item.overdueMonths.length, 0);
  const overdueScheduledTotal = overdueScheduledPayments.reduce((sum, item) => sum + item.amountPerOccurrence * item.overdueMonths.length, 0);
  const overdueScheduledNames = overdueScheduledPayments.map((item) => item.name);
  const overdueScheduledSummary = `${overdueScheduledNames.slice(0, 3).join(" · ")}${overdueScheduledNames.length > 3 ? ` · +${overdueScheduledNames.length - 3} more` : ""}`;
  const monthlyLivingBudget = monthlyBudgetTotal;
  const monthlyLivingMoneyAvailable = planningCapacity.suggestedMonthlySpending;
  const monthlyBudgetAbovePlanSafe = Math.max(0, monthlyLivingBudget - monthlyLivingMoneyAvailable);
  const scheduledCapacityRows: CalculationRow[] = planningCapacity.scheduledPayments.length > 0
    ? planningCapacity.scheduledPayments.map((item) => ({
        label: `${item.name}${item.overdueMonths.length > 0 ? " · OVERDUE" : ""}`,
        value: `−${moneyDetailed.format(item.total)}`,
        detail: `${moneyDetailed.format(item.amountPerOccurrence)} × ${item.months.length} unpaid ${item.months.length === 1 ? "payment" : "payments"}${item.overdueMonths.length > 0 ? ` · ${item.overdueMonths.length} overdue` : ""} · ${item.months[0]}${item.months.length > 1 ? `–${item.months[item.months.length - 1]}` : ""}`,
        tone: "subtract" as const,
      }))
    : [{ label: "Scheduled payments", value: moneyDetailed.format(0), detail: "No unpaid payments in this forecast" }];
  const capacityCalculationRows: CalculationRow[] = [
    { label: "Current net worth", value: moneyDetailed.format(result.total) },
    ...scheduledCapacityRows,
    { label: "Total reserved", value: `−${moneyDetailed.format(planningCapacity.scheduledTotal)}`, tone: "subtract" },
    { label: "Left after reservations", value: moneyDetailed.format(planningCapacity.remainingAfterScheduled) },
    { label: "Plan period", value: planningPeriodLabel },
    { label: "Remaining period", value: remainingPlanningMonths > 0 ? `${forecastStartMonth}–${data.planningEndMonth}` : "Plan ended" },
    { label: "Forecast length", value: `÷ ${remainingPlanningMonths} months` },
    { label: "Suggested per month", value: moneyDetailed.format(monthlyLivingMoneyAvailable), tone: "result" },
  ];
  const budgetCalculationRows: CalculationRow[] = [
    ...activeBudgetCategories.map((category) => ({ label: category, value: moneyDetailed.format(monthlyBudgets[category] || 0) })),
    { label: "Monthly budget", value: moneyDetailed.format(monthlyBudgetTotal), tone: "result" },
  ];
  const spentCalculationRows: CalculationRow[] = [
    ...activeBudgetCategories.filter((category) => (spentByCategory[category] || 0) > 0).map((category) => ({ label: category, value: moneyDetailed.format(spentByCategory[category] || 0) })),
    { label: "Spent from category limits", value: moneyDetailed.format(monthlyBudgetExpenseTotal), tone: "result" },
  ];
  const budgetAvailableCalculationRows: CalculationRow[] = [
    { label: "Monthly budget", value: moneyDetailed.format(monthlyBudgetTotal) },
    { label: "Spent from category limits", value: `−${moneyDetailed.format(monthlyBudgetExpenseTotal)}`, tone: "subtract" },
    { label: budgetAvailable < 0 ? "Over budget" : "Left", value: moneyDetailed.format(Math.abs(budgetAvailable)), tone: "result" },
  ];
  const monthlyCategoryStats = expenseCategories.map((category, index) => ({ category, amount: monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + categoryAmountInDisplayCurrency(entry, category), 0), color: chartColors[index % chartColors.length] })).filter((item) => item.amount > 0).sort((first, second) => second.amount - first.amount);
  let monthlyDonutCursor = 0;
  const monthlyDonutGradient = monthlyExpenseTotal > 0 ? `conic-gradient(${monthlyCategoryStats.map((item) => { const start = monthlyDonutCursor; monthlyDonutCursor += item.amount / monthlyExpenseTotal * 100; return `${item.color} ${start}% ${monthlyDonutCursor}%`; }).join(", ")})` : "conic-gradient(#e8e5ef 0 100%)";
  const insightPeriodMonths = Math.max(1, Math.min(24, insightMonths));
  const insightMonthKeys = Array.from({ length: insightPeriodMonths }, (_, index) => addMonths(selectedMonth, index - insightPeriodMonths + 1));
  const insightEntries = entries.filter((entry) => insightMonthKeys.includes(entry.date.slice(0, 7)));
  const insightExpenseEntries = insightEntries.filter((entry) => entry.type === "expense");
  const hasInsightSpending = insightExpenseEntries.length > 0;
  const insightExpenseTotal = insightExpenseEntries.reduce((sum, entry) => sum + toDisplay(entry), 0);
  const insightSpentByCategory = Object.fromEntries(expenseCategories.map((category) => [category, insightExpenseEntries.reduce((sum, entry) => sum + categoryAmountInDisplayCurrency(entry, category), 0)])) as Record<string, number>;
  const insightBudgetSpentByCategory = Object.fromEntries(expenseCategories.map((category) => [category, insightExpenseEntries.filter((entry) => entry.countsTowardMonthlyBudget !== false).reduce((sum, entry) => sum + categoryAmountInDisplayCurrency(entry, category), 0)])) as Record<string, number>;
  const categoryStats = expenseCategories.map((category, index) => ({ category, amount: insightSpentByCategory[category] || 0, color: chartColors[index % chartColors.length] })).filter((item) => item.amount > 0).sort((first, second) => second.amount - first.amount);
  const topCategory = categoryStats[0];
  const topCategoryPercent = topCategory && insightExpenseTotal > 0 ? topCategory.amount / insightExpenseTotal * 100 : 0;
  const overBudgetCategories = activeBudgetCategories.map((category) => {
    const spent = insightBudgetSpentByCategory[category] || 0;
    const limit = (monthlyBudgets[category] || 0) * insightPeriodMonths;
    return { category, spent, limit, over: Math.max(0, spent - limit) };
  }).filter((item) => item.over > 0).sort((first, second) => second.over - first.over);
  const totalOverBudget = overBudgetCategories.reduce((sum, item) => sum + item.over, 0);
  const maxCategoryOverage = Math.max(1, ...overBudgetCategories.map((item) => item.over));
  const suggestedMonthlyBudget = monthlyLivingMoneyAvailable;
  const spendingTrend = insightMonthKeys.map((month) => ({
    month,
    amount: entries.filter((entry) => entry.type === "expense" && entry.date.startsWith(month)).reduce((sum, entry) => sum + toDisplay(entry), 0),
  }));
  const trendMax = Math.max(monthlyBudgetTotal, ...spendingTrend.map((item) => item.amount), 1);
  const insightMonthlyAdjustment = totalOverBudget > 0 ? totalOverBudget / insightPeriodMonths : Math.max(0, monthlyBudgetTotal - (insightExpenseTotal / insightPeriodMonths));
  const scenarioMonths = remainingPlanningMonths;
  const scenarioMonthlySpend = Math.max(0, monthlyBudgetTotal + whatIf.monthlyChange);
  const scenarioBaselineFlexibleTotal = monthlyBudgetTotal * scenarioMonths;
  const scenarioFlexibleTotal = scenarioMonthlySpend * scenarioMonths;
  const scenarioMonthlyChangeTotal = scenarioFlexibleTotal - scenarioBaselineFlexibleTotal;
  const scenarioBaselineEnding = result.total - planningCapacity.scheduledTotal - scenarioBaselineFlexibleTotal;
  const scenarioEnding = result.total - planningCapacity.scheduledTotal - whatIf.oneTime - scenarioFlexibleTotal;
  const scenarioDifference = scenarioEnding - scenarioBaselineEnding;
  const scenarioAverageScheduled = scenarioMonths > 0 ? planningCapacity.scheduledTotal / scenarioMonths : 0;
  const scenarioStatus = scenarioMonths === 0 ? "plan-ended" : scenarioEnding < 0 ? "not-recommended" : scenarioEnding < Math.max((scenarioMonthlySpend + scenarioAverageScheduled) * 3, result.total * 0.1) ? "tight" : "safe";
  const fixedCostsForSelectedMonth = recurringExpenses.filter((item) => isDueInMonth(item, selectedMonth));
  const filteredFixedCosts = fixedCostsForSelectedMonth.filter((item) => fixedCostFilter === "all" || (fixedCostFilter === "monthly" ? item.intervalMonths > 0 : item.intervalMonths === 0));
  const visibleFixedCosts = filteredFixedCosts.slice(0, fixedCostLimit);
  const transactionFilterCategories = Array.from(new Set([...expenseCategories, ...incomeCategories]));
  const filteredMonthEntries = monthEntries.filter((entry) => {
    if (transactionCategoryFilter !== "all" && !entryCategoryNames(entry).includes(transactionCategoryFilter)) return false;
    if (transactionTypeFilter !== "all" && entry.type !== transactionTypeFilter) return false;
    if (transactionBudgetFilter === "monthly" && (entry.type !== "expense" || entry.countsTowardMonthlyBudget === false)) return false;
    if (transactionBudgetFilter === "outside" && (entry.type !== "expense" || entry.countsTowardMonthlyBudget !== false)) return false;
    return true;
  });
  const visibleMonthEntries = filteredMonthEntries.slice(0, transactionLimit);
  const recentEntries = [...entries].sort((first, second) => second.date.localeCompare(first.date));
  const transactionDetailEntry = transactionDetailEntryId ? entries.find((entry) => entry.id === transactionDetailEntryId) : undefined;
  const transactionDetailItems = transactionDetailEntry ? entryAllocations(transactionDetailEntry) : [];
  const transactionDetailHasAllocations = Boolean(transactionDetailEntry?.allocations?.length);
  const transactionDetailCategories = transactionDetailEntry ? entryCategoryNames(transactionDetailEntry) : [];
  const transactionDetailItemsTotal = transactionDetailItems.reduce((sum, allocation) => sum + allocation.amount, 0);
  const transactionDetailCategoryTotals = Array.from(transactionDetailItems.reduce((totals, item) => {
    const category = item.category || transactionDetailEntry?.category || "Uncategorized";
    const current = totals.get(category);
    totals.set(category, {
      category,
      itemCount: (current?.itemCount || 0) + 1,
      amount: Math.round(((current?.amount || 0) + item.amount) * 100) / 100,
    });
    return totals;
  }, new Map<string, { category: string; itemCount: number; amount: number }>()).values());
  const transactionDetailDifference = transactionDetailEntry ? Math.round((transactionDetailEntry.amount - transactionDetailItemsTotal) * 100) / 100 : 0;
  const transactionDetailTotalMatches = Math.abs(transactionDetailDifference) <= 0.009;
  const receiptAllocationTotal = draft.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const receiptAllocationDifference = Math.round((draft.amount - receiptAllocationTotal) * 100) / 100;
  const receiptAllocationTotalMatches = Math.abs(receiptAllocationDifference) <= 0.009;
  const receiptAllocationRowsComplete = draft.allocations.every((allocation) => allocation.description.trim() && allocation.category && allocation.amount > 0);
  const receiptAllocationReviewPending = transactionAiAllocationReviewFields.some((fields) => fields.length > 0);
  const missingReceiptAllocationReview = draft.allocations.length === 0 && transactionAiReviewFields.includes("allocations");
  const receiptAllocationsNeedAttention = missingReceiptAllocationReview || (draft.allocations.length > 0 && (!receiptAllocationRowsComplete || !receiptAllocationTotalMatches || receiptAllocationReviewPending));
  const transactionReviewLabels = [
    ...transactionAiReviewFields.filter((field) => field !== "allocations"),
    ...(receiptAllocationsNeedAttention ? ["receipt items"] : []),
  ];
  const clearTransactionAiReviewField = (field: TransactionAiReviewField) => {
    setTransactionAiReviewFields((current) => current.filter((item) => item !== field));
  };
  const updateReceiptAllocation = (index: number, field: TransactionAiAllocationReviewField, value: string | number) => {
    setDraft((current) => {
      const allocations = current.allocations.map((allocation, allocationIndex) => allocationIndex === index ? { ...allocation, [field]: value } : allocation);
      return { ...current, allocations, category: primaryAllocationCategory(allocations, current.category) };
    });
    setTransactionAiAllocationReviewFields((current) => current.map((fields, allocationIndex) => allocationIndex === index ? fields.filter((item) => item !== field) : fields));
  };
  const addReceiptAllocation = () => {
    setDraft((current) => ({ ...current, allocations: [...current.allocations, { category: "", description: "", amount: 0 }] }));
    setTransactionAiAllocationReviewFields((current) => [...current, ["category", "description", "amount"]]);
  };
  const removeReceiptAllocation = (index: number) => {
    setDraft((current) => {
      const allocations = current.allocations.filter((_, allocationIndex) => allocationIndex !== index);
      return { ...current, allocations, category: primaryAllocationCategory(allocations, current.category) };
    });
    setTransactionAiAllocationReviewFields((current) => current.filter((_, allocationIndex) => allocationIndex !== index));
  };
  const analyzeTransactionDraft = async () => {
    if (!transactionAiDescription.trim() && !receiptFile) return;
    if (receiptFile && !["image/jpeg", "image/png", "image/webp"].includes(receiptFile.type)) {
      setTransactionAiStatus("error");
      setTransactionAiMessage("AI can read JPG, PNG, or WEBP images. You can still attach this image and enter the transaction manually.");
      return;
    }
    if (receiptFile && receiptFile.size > 5 * 1024 * 1024) {
      setTransactionAiStatus("error");
      setTransactionAiMessage("The AI image must be 5 MB or smaller. You can still attach images up to 10 MB.");
      return;
    }

    setTransactionAiStatus("loading");
    setTransactionAiMessage("");
    const form = new FormData();
    if (transactionAiDescription.trim()) form.set("description", transactionAiDescription.trim());
    if (receiptFile) form.set("image", receiptFile);
    form.set("today", localDateKey());
    form.set("expenseCategories", JSON.stringify(expenseCategories));
    form.set("incomeCategories", JSON.stringify(incomeCategories));
    form.set("currencies", JSON.stringify(currencyCodes));

    try {
      const response = await fetch("/api/transactions/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${account.session.access_token}` },
        body: form,
      });
      const payload = await response.json() as TransactionAiResult | { error?: string };
      if (!response.ok || !("draft" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "AI could not create a transaction draft.");

      const result = payload as TransactionAiResult;
      const nextType = result.draft.type || "expense";
      const allowedCategories = nextType === "expense" ? expenseCategories : incomeCategories;
      const nextCategory = result.draft.category && allowedCategories.includes(result.draft.category)
        ? result.draft.category
        : allowedCategories[0];
      const allocations = nextType === "expense" ? result.draft.allocations.map((allocation) => ({
        category: allocation.category && expenseCategories.includes(allocation.category) ? allocation.category : "",
        description: allocation.description || "",
        amount: allocation.amount || 0,
      })) : [];
      setDraft({
        date: result.draft.date || "",
        type: nextType,
        category: nextCategory,
        description: result.draft.description || "",
        amount: result.draft.amount || 0,
        currency: result.draft.currency || data.displayCurrency,
        countsTowardMonthlyBudget: result.draft.countsTowardMonthlyBudget ?? nextCategory !== "Tuition",
        allocations,
        linksPlannedPayment: false,
        plannedPaymentKey: "",
      });
      if (result.draft.date) setSelectedMonth(result.draft.date.slice(0, 7));
      setTransactionAiReviewFields(result.needsReview);
      setTransactionAiAllocationReviewFields(result.allocationNeedsReview || allocations.map(() => []));
      setTransactionAiStatus("success");
    } catch (error) {
      setTransactionAiStatus("error");
      setTransactionAiMessage(error instanceof Error ? error.message : "AI analysis is temporarily unavailable. Try again.");
    }
  };
  const addEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.description.trim() || draft.amount <= 0 || draftNeedsExchangeRate || receiptAllocationsNeedAttention) return;
    const previousEntry = editingEntryId ? entries.find((entry) => entry.id === editingEntryId) : undefined;
    const previousEntries = entries;
    const previousSchedule = recurringExpenses;
    const previousMonthlyBudgets = monthlyBudgets;
    const previousBudgetCategories = budgetCategories;
    const id = previousEntry?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
    const [plannedExpenseId, plannedExpenseMonth] = draft.plannedPaymentKey.split("::");
    if (draft.linksPlannedPayment && (!plannedExpenseId || !plannedExpenseMonth)) return;
    const entry: LedgerEntry = {
      id,
      date: draft.date,
      type: draft.type,
      category: draft.category,
      description: draft.description.trim(),
      amount: draft.amount,
      currency: draft.currency,
      countsTowardMonthlyBudget: draft.type === "expense" ? draft.countsTowardMonthlyBudget : undefined,
      allocations: draft.type === "expense" && draft.allocations.length > 0 ? draft.allocations.map((allocation) => ({ ...allocation, description: allocation.description.trim() })) : undefined,
      plannedExpenseId: draft.type === "expense" && draft.linksPlannedPayment && plannedExpenseId ? plannedExpenseId : undefined,
      plannedExpenseMonth: draft.type === "expense" && draft.linksPlannedPayment && plannedExpenseMonth ? plannedExpenseMonth : undefined,
      receiptId: draft.type === "expense" ? previousEntry?.receiptId : undefined,
    };
    const autoAddedBudgetCategories = entry.type === "expense" && entry.countsTowardMonthlyBudget !== false
      ? entryCategoryNames(entry).filter((category) => expenseCategories.includes(category) && !budgetCategories.includes(category))
      : [];
    if (draft.type === "expense" && receiptFile) {
      try {
        entry.receiptId = await uploadReceipt(account.session.user.id, id, receiptFile, previousEntry?.receiptId);
      } catch {
        setReceiptError("The transaction was saved, but the photo could not be uploaded.");
      }
    }
    if (draft.type === "income" && previousEntry?.receiptId) void removeReceipt(previousEntry.receiptId).catch(() => undefined);
    if (previousEntry?.plannedExpenseId || entry.plannedExpenseId) {
      setRecurringExpenses((current) => current.map((item) => {
        let paidMonths = item.paidMonths || [];
        if (item.id === previousEntry?.plannedExpenseId && previousEntry.plannedExpenseMonth) paidMonths = paidMonths.filter((month) => month !== previousEntry.plannedExpenseMonth);
        if (item.id === entry.plannedExpenseId && entry.plannedExpenseMonth) paidMonths = Array.from(new Set([...paidMonths, entry.plannedExpenseMonth]));
        return { ...item, paidMonths };
      }));
    }
    setEntries((current) => previousEntry ? current.map((item) => item.id === previousEntry.id ? entry : item) : [entry, ...current]);
    if (autoAddedBudgetCategories.length > 0) {
      setBudgetCategories((current) => [...current, ...autoAddedBudgetCategories.filter((category) => !current.includes(category))]);
      setMonthlyBudgets((current) => {
        const next = { ...current };
        autoAddedBudgetCategories.forEach((category) => { if (!(category in next)) next[category] = 0; });
        return next;
      });
    }
    setSelectedMonth(entry.date.slice(0, 7));
    setDraft((current) => ({ ...current, description: "", amount: 0, allocations: [], linksPlannedPayment: false, plannedPaymentKey: "" }));
    setTransactionAiDescription("");
    setTransactionAiStatus("idle");
    setTransactionAiMessage("");
    setTransactionAiReviewFields([]);
    setTransactionAiAllocationReviewFields([]);
    setTransactionEntryMode("ai");
    setEditingEntryId(null);
    setReceiptFile(null);
    setReceiptInputKey((current) => current + 1);
    setUndoAction({
      message: `${previousEntry ? "Transaction updated" : "Transaction added"}.${autoAddedBudgetCategories.length > 0 ? ` ${autoAddedBudgetCategories.join(" · ")} added to Budget.` : ""}`,
      restore: () => {
        setEntries(previousEntries);
        setRecurringExpenses(previousSchedule);
        setMonthlyBudgets(previousMonthlyBudgets);
        setBudgetCategories(previousBudgetCategories);
      },
    });
  };
  const chooseReceipt = (file?: File) => {
    setReceiptError("");
    setTransactionAiStatus("idle");
    setTransactionAiMessage("");
    if (!file) { setReceiptFile(null); return; }
    if (!file.type.startsWith("image/")) { setReceiptError("Choose an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setReceiptError("The photo must be 10 MB or smaller."); return; }
    setReceiptFile(file);
  };
  const editEntry = (entry: LedgerEntry) => {
    setEditingEntryId(entry.id);
    setTransactionEntryMode("manual");
    setDraft({
      date: entry.date,
      type: entry.type,
      category: entry.category,
      description: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      countsTowardMonthlyBudget: entry.countsTowardMonthlyBudget !== false,
      allocations: entry.allocations || [],
      linksPlannedPayment: Boolean(entry.plannedExpenseId && entry.plannedExpenseMonth),
      plannedPaymentKey: entry.plannedExpenseId && entry.plannedExpenseMonth ? `${entry.plannedExpenseId}::${entry.plannedExpenseMonth}` : "",
    });
    setReceiptFile(null);
    setReceiptError("");
    setTransactionAiDescription("");
    setTransactionAiStatus("idle");
    setTransactionAiMessage("");
    setTransactionAiReviewFields([]);
    setTransactionAiAllocationReviewFields((entry.allocations || []).map(() => []));
    setSelectedMonth(entry.date.slice(0, 7));
    setSelectionScope(null);
    setSelectedItems([]);
    navigate("transactions");
  };
  const cancelEntryEdit = () => {
    setEditingEntryId(null);
    setTransactionEntryMode("ai");
    setDraft({ date: localDateKey(), type: "expense", category: expenseCategories[0], description: "", amount: 0, currency: data.displayCurrency, countsTowardMonthlyBudget: true, allocations: [], linksPlannedPayment: false, plannedPaymentKey: "" });
    setReceiptFile(null);
    setReceiptError("");
    setTransactionAiDescription("");
    setTransactionAiStatus("idle");
    setTransactionAiMessage("");
    setTransactionAiReviewFields([]);
    setTransactionAiAllocationReviewFields([]);
    setReceiptInputKey((current) => current + 1);
  };
  const cancelSelection = () => {
    setSelectionScope(null);
    setSelectedItems([]);
  };
  const toggleSelectionMode = (scope: SelectionScope) => {
    if (selectionScope === scope) cancelSelection();
    else {
      setSelectionScope(scope);
      setSelectedItems([]);
    }
  };
  const toggleSelectedItem = (item: string) => setSelectedItems((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  const closeItemActions = (restoreFocus = true) => {
    setItemActions(null);
    window.clearTimeout(itemLongPressTimerRef.current);
    itemLongPressOriginRef.current = null;
    suppressNextItemClickRef.current = false;
    if (restoreFocus && itemActionTriggerRef.current) {
      const trigger = itemActionTriggerRef.current;
      window.requestAnimationFrame(() => trigger.focus());
    }
    itemActionTriggerRef.current = null;
  };
  const openItemActions = (scope: SelectionScope, id: string, label: string, noun: string, clientX: number, clientY: number, trigger: HTMLElement) => {
    const menuWidth = 224;
    const menuHeight = 150;
    itemActionTriggerRef.current = trigger;
    setItemActions({
      scope,
      id,
      label,
      noun,
      left: Math.max(12, Math.min(clientX, window.innerWidth - menuWidth - 12)),
      top: Math.max(12, Math.min(clientY, window.innerHeight - menuHeight - 12)),
    });
  };
  const handleItemContextMenu = (event: React.MouseEvent<HTMLElement>, scope: SelectionScope, id: string, label: string, noun: string) => {
    event.preventDefault();
    openItemActions(scope, id, label, noun, event.clientX, event.clientY, event.currentTarget);
  };
  const beginItemLongPress = (event: React.PointerEvent<HTMLElement>, scope: SelectionScope, id: string, label: string, noun: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    window.clearTimeout(itemLongPressTimerRef.current);
    itemLongPressOriginRef.current = { x: event.clientX, y: event.clientY };
    const trigger = event.currentTarget;
    itemLongPressTimerRef.current = window.setTimeout(() => {
      suppressNextItemClickRef.current = true;
      openItemActions(scope, id, label, noun, event.clientX, event.clientY, trigger);
    }, 550);
  };
  const moveItemLongPress = (event: React.PointerEvent<HTMLElement>) => {
    const origin = itemLongPressOriginRef.current;
    if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 10) return;
    window.clearTimeout(itemLongPressTimerRef.current);
    itemLongPressOriginRef.current = null;
  };
  const endItemLongPress = () => {
    window.clearTimeout(itemLongPressTimerRef.current);
    itemLongPressOriginRef.current = null;
  };
  const deleteItems = (scope: SelectionScope, selected: string[], confirmDelete: boolean) => {
    if (selected.length === 0) return;
    if (scope === "categories" && expenseCategories.length - selected.length < 1) {
      window.alert("Keep at least one category.");
      return;
    }
    const scopeLabel = scope === "budgets" ? "selected budgets" : scope === "fixed-costs" ? "selected fixed costs" : scope === "transactions" ? "selected transactions" : "selected categories";
    const categoryRecordsWillMove = scope === "categories" && (recurringExpenses.some((item) => selected.includes(item.category)) || entries.some((entry) => entry.type === "expense" && entryCategoryNames(entry).some((category) => selected.includes(category))));
    if (confirmDelete && !window.confirm(`Delete ${selected.length} ${scopeLabel}?${categoryRecordsWillMove ? " Existing records will move to a remaining category." : ""}`)) return;
    const snapshot = {
      entries,
      recurringExpenses,
      expenseCategories,
      monthlyBudgets,
      budgetCategories,
    };
    const singularLabel = scope === "budgets" ? "Budget" : scope === "fixed-costs" ? "Scheduled payment" : scope === "transactions" ? "Transaction" : "Category";
    setUndoAction({
      message: selected.length === 1 ? `${singularLabel} deleted.` : `${selected.length} ${scopeLabel} deleted.`,
      restore: () => {
        setEntries(snapshot.entries);
        setRecurringExpenses(snapshot.recurringExpenses);
        setExpenseCategories(snapshot.expenseCategories);
        setMonthlyBudgets(snapshot.monthlyBudgets);
        setBudgetCategories(snapshot.budgetCategories);
      },
    });
    if (scope === "budgets") setBudgetCategories((current) => current.filter((item) => !selected.includes(item)));
    if (scope === "fixed-costs") {
      setRecurringExpenses((current) => current.filter((item) => !selected.includes(item.id)));
      if (editingRecurringId && selected.includes(editingRecurringId)) chooseRecurringPreset("recurring");
    }
    if (scope === "transactions") {
      const removedEntries = entries.filter((entry) => selected.includes(entry.id));
      setEntries((current) => current.filter((entry) => !selected.includes(entry.id)));
      setRecurringExpenses((current) => current.map((item) => ({ ...item, paidMonths: (item.paidMonths || []).filter((month) => !removedEntries.some((entry) => entry.plannedExpenseId === item.id && entry.plannedExpenseMonth === month)) })));
      if (editingEntryId && selected.includes(editingEntryId)) cancelEntryEdit();
    }
    if (scope === "categories") {
      const remaining = expenseCategories.filter((category) => !selected.includes(category));
      const replacement = remaining.find((category) => category === "Other") || remaining[0];
      setExpenseCategories(remaining);
      setMonthlyBudgets((current) => {
        const next = { ...current };
        selected.forEach((category) => delete next[category]);
        return next;
      });
      setBudgetCategories((current) => current.filter((category) => !selected.includes(category)));
      setEntries((current) => current.map((entry) => {
        if (entry.type !== "expense") return entry;
        const allocations = entry.allocations?.map((allocation) => selected.includes(allocation.category) ? { ...allocation, category: replacement } : allocation);
        return {
          ...entry,
          category: selected.includes(entry.category) ? replacement : entry.category,
          allocations,
        };
      }));
      setRecurringExpenses((current) => current.map((item) => selected.includes(item.category) ? { ...item, category: replacement } : item));
      setDraft((current) => current.type === "expense" ? {
        ...current,
        category: selected.includes(current.category) ? replacement : current.category,
        allocations: current.allocations.map((allocation) => selected.includes(allocation.category) ? { ...allocation, category: replacement } : allocation),
        countsTowardMonthlyBudget: selected.includes(current.category) ? replacement !== "Tuition" : current.countsTowardMonthlyBudget,
      } : current);
      setRecurringDraft((current) => selected.includes(current.category) ? { ...current, category: replacement } : current);
    }
    cancelSelection();
  };
  const deleteSelectedItems = (scope: SelectionScope) => {
    if (selectionScope !== scope) return;
    deleteItems(scope, selectedItems, true);
  };
  const deleteContextItem = () => {
    if (!itemActions) return;
    const { scope, id } = itemActions;
    closeItemActions(false);
    deleteItems(scope, [id], scope === "categories");
  };
  const addCategory = (event: React.FormEvent) => {
    event.preventDefault();
    const category = newCategory.trim();
    if (!category || expenseCategories.includes(category)) return;
    setExpenseCategories((current) => [...current, category]);
    setMonthlyBudgets((current) => ({ ...current, [category]: 0 }));
    setDraft((current) => current.type === "expense" && current.allocations.length === 0 ? { ...current, category, countsTowardMonthlyBudget: category !== "Tuition" } : current);
    setRecurringDraft((current) => ({ ...current, category }));
    setNewCategory("");
  };
  const addBudgetCategory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!budgetCategoryDraft || budgetCategories.includes(budgetCategoryDraft)) return;
    setBudgetCategories((current) => [...current, budgetCategoryDraft]);
    setBudgetCategoryDraft("");
  };
  const renameCategory = (category: string, nextName: string) => {
    const name = nextName.trim();
    if (!name || name === category || expenseCategories.includes(name)) return;
    setExpenseCategories((current) => current.map((item) => item === category ? name : item));
    setMonthlyBudgets((current) => {
      const next = { ...current, [name]: current[category] || 0 };
      delete next[category];
      return next;
    });
    setEntries((current) => current.map((entry) => ({
      ...entry,
      category: entry.category === category ? name : entry.category,
      allocations: entry.allocations?.map((allocation) => allocation.category === category ? { ...allocation, category: name } : allocation),
    })));
    setRecurringExpenses((current) => current.map((item) => item.category === category ? { ...item, category: name } : item));
    setBudgetCategories((current) => current.map((item) => item === category ? name : item));
    setDraft((current) => ({
      ...current,
      category: current.category === category ? name : current.category,
      allocations: current.allocations.map((allocation) => allocation.category === category ? { ...allocation, category: name } : allocation),
    }));
    setRecurringDraft((current) => current.category === category ? { ...current, category: name } : current);
  };
  const moveCategory = (index: number, direction: -1 | 1) => {
    setExpenseCategories((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const chooseRecurringPreset = (preset: "recurring" | "one-time") => {
    setEditingRecurringId(null);
    if (preset === "recurring") {
      setRecurringDraft({ name: "Recurring payment", category: expenseCategories.includes("Housing") ? "Housing" : expenseCategories[0], amount: 0, intervalMonths: 1, startMonth: localMonthKey(), endMonth: "" });
    } else {
      setRecurringDraft({ name: "One-time payment", category: expenseCategories.includes("Other") ? "Other" : expenseCategories[0], amount: 0, intervalMonths: 0, startMonth: localMonthKey(), endMonth: "" });
    }
  };
  const editRecurringExpense = (expense: RecurringExpense) => {
    setEditingRecurringId(expense.id);
    setRecurringDraft({ ...expense, endMonth: expense.endMonth || "" });
  };
  const addRecurringExpense = (event: React.FormEvent) => {
    event.preventDefault();
    if (!recurringDraft.name.trim() || recurringDraft.amount <= 0 || !recurringDraft.startMonth) return;
    if (recurringDraft.endMonth && monthIndex(recurringDraft.endMonth) < monthIndex(recurringDraft.startMonth)) return;
    const expense: RecurringExpense = {
      ...recurringDraft,
      name: recurringDraft.name.trim(),
      intervalMonths: recurringDraft.intervalMonths === 0 ? 0 : 1,
      endMonth: recurringDraft.intervalMonths === 0 ? undefined : recurringDraft.endMonth || undefined,
      id: editingRecurringId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`),
    };
    setRecurringExpenses((current) => editingRecurringId ? current.map((item) => item.id === editingRecurringId ? expense : item) : [...current, expense]);
    setEditingRecurringId(null);
    setRecurringDraft((current) => ({ ...current, name: current.intervalMonths === 0 ? "One-time payment" : "Recurring payment", amount: 0 }));
  };

  const resetVisibleLists = () => {
    setOverviewTransactionLimit(3);
    setActivityLimit(4);
    setTransactionLimit(8);
    setTransactionStatsLimit(5);
    setBudgetListLimit(5);
    setFixedCostLimit(8);
    setCategoryLimit(8);
    setOverLimitLimit(5);
  };
  const chooseMonth = (month: string) => {
    setSelectedMonth(month);
    setActivityLimit(4);
    setTransactionLimit(8);
    setTransactionStatsLimit(5);
    setFixedCostLimit(8);
  };
  const openTransactionDetail = (entry: LedgerEntry, opener: HTMLButtonElement) => {
    if (selectionScope === "transactions") return;
    transactionDetailOpenerRef.current = opener;
    setTransactionDetailEntryId(entry.id);
  };
  const closeTransactionDetail = useCallback((restoreFocus = true) => {
    setTransactionDetailEntryId(null);
    const opener = transactionDetailOpenerRef.current;
    transactionDetailOpenerRef.current = null;
    if (restoreFocus && opener) window.requestAnimationFrame(() => opener.focus());
  }, []);
  useEffect(() => {
    if (!transactionDetailEntry) return;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => transactionDetailCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTransactionDetail();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = transactionDetailDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeTransactionDetail, transactionDetailEntry]);
  const navigate = (next: View) => {
    if (next !== view) {
      const currentState = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
      window.history.pushState({ ...currentState, monetaView: next }, "", urlForView(next));
    }
    setView(next);
    setMobileMenuOpen(false);
    cancelSelection();
    resetVisibleLists();
  };
  useEffect(() => {
    const restoreHistoryView = () => {
      setView(viewFromUrl());
      setMobileMenuOpen(false);
      setSelectionScope(null);
      setSelectedItems([]);
      setOverviewTransactionLimit(3);
      setActivityLimit(4);
      setTransactionLimit(8);
      setTransactionStatsLimit(5);
      setBudgetListLimit(5);
      setFixedCostLimit(8);
      setCategoryLimit(8);
      setOverLimitLimit(5);
    };
    const initialView = viewFromUrl();
    const currentState = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.replaceState({ ...currentState, monetaView: initialView }, "", urlForView(initialView));
    const initialViewTimer = window.setTimeout(() => setView(initialView), 0);
    window.addEventListener("popstate", restoreHistoryView);
    return () => {
      window.clearTimeout(initialViewTimer);
      window.removeEventListener("popstate", restoreHistoryView);
    };
  }, []);
  const isNavigationActive = (itemView: View) => view === itemView
    || (itemView === "transactions" && view === "transaction-history")
    || (itemView === "budget" && view === "fixed-costs")
    || (itemView === "settings" && view === "categories");
  const goToAddTransaction = () => {
    navigate("transactions");
    window.setTimeout(() => document.querySelector(".transaction-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const exportBackup = () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      data,
      entries,
      monthlyBudgets,
      expenseCategories,
      budgetCategories,
      categorySort,
      recurringExpenses,
      insightMonths,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `moneta-backup-${localDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const renderTransactionRow = (entry: LedgerEntry) => {
    const selecting = selectionScope === "transactions";
    const categoryLabel = entryCategoryNames(entry).join(" · ");
    return <div className={`transaction-row ${selecting ? "selecting" : ""}`} key={entry.id}>
      {selecting && <label className="row-check"><input type="checkbox" checked={selectedItems.includes(entry.id)} onChange={() => toggleSelectedItem(entry.id)} /><span aria-hidden="true">✓</span><b className="sr-only">Select {entry.description}</b></label>}
      <button type="button" className="transaction-row-open" aria-label={`View details for ${entry.description}`} disabled={selecting} onContextMenu={(event) => handleItemContextMenu(event, "transactions", entry.id, entry.description, "transaction")} onPointerDown={(event) => beginItemLongPress(event, "transactions", entry.id, entry.description, "transaction")} onPointerMove={moveItemLongPress} onPointerUp={endItemLongPress} onPointerCancel={endItemLongPress} onPointerLeave={endItemLongPress} onClick={(event) => { if (suppressNextItemClickRef.current) { suppressNextItemClickRef.current = false; return; } openTransactionDetail(entry, event.currentTarget); }}>
        <i className={entry.type}>{categoryLabel[0]}</i>
        <span className="transaction-entry-copy"><strong title={entry.description}>{entry.description}</strong><span title={`${entry.date.slice(5).replace("-", "/")} · ${categoryLabel}`}>{entry.date.slice(5).replace("-", "/")} · {categoryLabel}{entry.receiptId ? " · Receipt" : ""}{entry.plannedExpenseMonth ? ` · Plan ${entry.plannedExpenseMonth} paid` : ""}</span>{entry.type === "expense" && <small className={entry.countsTowardMonthlyBudget !== false ? "budget-status included" : "budget-status excluded"}>{entry.countsTowardMonthlyBudget !== false ? "Monthly budget" : "Outside budget"}</small>}</span>
        <b className={`transaction-amount ${entry.type}`}>{entry.type === "income" ? "+" : "−"}{formatOriginalCurrency(entry.amount, entry.currency)}{entry.currency !== data.displayCurrency && <small>{money.format(toDisplay(entry))}</small>}</b>
      </button>
      {receiptUrls[entry.id] ? <button type="button" className="receipt-thumb" aria-label={`View receipt for ${entry.description}`} onClick={() => setActiveReceiptUrl(receiptUrls[entry.id])}><img src={receiptUrls[entry.id]} alt="" /></button> : <span className="receipt-placeholder" />}
      <div className="row-actions"><button type="button" className="row-edit" aria-label={`Edit ${entry.description}`} onClick={() => editEntry(entry)}>Edit</button><button type="button" className="row-more" aria-label={`More actions for ${entry.description}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openItemActions("transactions", entry.id, entry.description, "transaction", rect.right, rect.bottom, event.currentTarget); }}>⋯</button></div>
    </div>;
  };
  const syncLabel = syncStatus === "loading" ? "Loading account" : syncStatus === "migration" ? "Move device data" : syncStatus === "saving" ? "Syncing changes" : syncStatus === "error" ? "Sync needs attention" : "Synced to account";
  const currentNavigationItem = navigationItems.find((item) => isNavigationActive(item.view));
  if (!loaded) return <main className="auth-shell"><section className="auth-card loading"><div className="auth-mark">M</div><h1>Loading your workspace…</h1><p>{account.session.user.email}</p></section></main>;
  if (planPeriodSetupOpen) return <main className="auth-shell plan-period-setup-shell"><section className="auth-card plan-period-setup-card">
    <div className="auth-brand"><div className="auth-mark">M</div><strong>MONETA</strong></div>
    <span>FIRST PLAN SETUP</span>
    <h1>Choose your planning dates</h1>
    <p>Pick the first month and the month your current money needs to last through. Moneta will not assume a two-year plan for you.</p>
    <form className="plan-period-setup-form" onSubmit={completePlanPeriodSetup}>
      <label><span>START MONTH</span><strong>When does this plan begin?</strong><input aria-label="Plan start month" required type="month" value={planPeriodDraft.startMonth} onChange={(event) => { const startMonth = event.target.value; const endMinimum = startMonth && monthIndex(startMonth) > monthIndex(currentMonth) ? startMonth : currentMonth; setPlanPeriodDraft((current) => ({ startMonth, endMonth: current.endMonth && monthIndex(current.endMonth) < monthIndex(endMinimum) ? "" : current.endMonth })); }} /></label>
      <label><span>USE MONEY THROUGH</span><strong>When should the money last until?</strong><input aria-label="Plan end month" required type="month" disabled={!planPeriodDraft.startMonth} min={planPeriodEndMinimum || undefined} value={planPeriodDraft.endMonth} onChange={(event) => setPlanPeriodDraft((current) => ({ ...current, endMonth: event.target.value }))} /></label>
      <button type="submit" disabled={!planPeriodDraftValid}>Start my plan</button>
    </form>
    <small>You can change both months later in Plan setup.</small>
  </section></main>;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="logo" onClick={() => navigate("overview")}><span>M</span><strong>MONETA</strong></button>
        <nav>
          {navigationItems.map((item) => <button key={item.view} aria-label={navAccessibleLabel(item)} className={isNavigationActive(item.view) ? "active" : ""} onClick={() => navigate(item.view)}><i>{item.icon}</i><span className="nav-label">{navLabel(item)}</span>{item.legacyLabel && <span className="sr-only legacy-nav-label">{item.legacyLabel}</span>}</button>)}
        </nav>
        <div className={`local-status ${syncStatus}`} title={syncMessage || syncLabel}><i /> {syncLabel}</div>
      </aside>

      {mobileMenuOpen && <>
        <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />
        <aside id="mobile-navigation" className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Main navigation">
          <div className="mobile-drawer-heading">
            <button className="logo" onClick={() => navigate("overview")}><span>M</span><strong>MONETA</strong></button>
            <button className="mobile-menu-button open" type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}><i /><i /><i /></button>
          </div>
          <nav>
            {navigationItems.map((item) => {
              const active = isNavigationActive(item.view);
              return <button key={item.view} aria-label={navAccessibleLabel(item)} className={active ? "active" : ""} onClick={() => navigate(item.view)}><i>{item.icon}</i><span className="nav-label">{navLabel(item)}</span>{item.legacyLabel && <span className="sr-only legacy-nav-label">{item.legacyLabel}</span>}{active && <b>{locale === "ko" ? "현재" : "Current"}</b>}</button>;
            })}
          </nav>
          <div className={`local-status ${syncStatus}`} title={syncMessage || syncLabel}><i /> {syncLabel}</div>
        </aside>
      </>}

      <section className="workspace">
        <header className="mobile-header"><button className="mobile-menu-button" type="button" aria-label="Open menu" aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" onClick={() => setMobileMenuOpen(true)}><i /><i /><i /></button><button className="logo" onClick={() => navigate("overview")}><span>M</span><strong>MONETA</strong></button><strong className="mobile-current-page">{currentNavigationItem ? navLabel(currentNavigationItem) : ""}</strong></header>

        {legacySnapshot && <article className="migration-banner"><div><span>DEVICE DATA FOUND</span><strong>Move this browser&apos;s Moneta data to your account?</strong><small>Transactions, budgets, schedules, and receipt photos will become available on your other devices. The local copy stays as a backup.</small></div><div><button type="button" className="migration-primary" disabled={syncStatus === "saving"} onClick={moveLegacyDataToAccount}>{syncStatus === "saving" ? "Moving…" : "Move to my account"}</button><button type="button" disabled={syncStatus === "saving"} onClick={startWithEmptyAccount}>Start clean</button></div></article>}
        {remoteConflict && <div className="sync-error sync-conflict" role="alert"><div><strong>Newer changes found</strong><span>Choose the cloud copy or keep the changes on this screen.</span></div><div className="sync-conflict-actions"><button type="button" onClick={useCloudVersion}>Use cloud</button><button type="button" className="conflict-keep" disabled={syncStatus === "saving"} onClick={() => void keepMyVersion()}>{syncStatus === "saving" ? "Saving…" : "Keep mine"}</button></div></div>}
        {syncStatus === "error" && !remoteConflict && <div className="sync-error" role="alert"><strong>Sync paused</strong><span>{syncMessage || "Check the database connection and try again."}</span></div>}
        {syncStatus === "saved" && syncMessage && <div className="sync-note" role="status">{syncMessage}<button type="button" aria-label="Dismiss" onClick={() => setSyncMessage("")}>×</button></div>}

        {view === "overview" && <div className="page overview-page">
          <div className="page-title overview-title"><div><h1>{locale === "ko" ? "내 돈을 계획한 날짜까지." : "Make your money last."}</h1></div>{!isPlanUnconfigured && <button className="primary-action" onClick={goToAddTransaction}>{locale === "ko" ? "거래 추가" : "Add transaction"} <b>＋</b></button>}</div>
          <section className={`overview-plan-anchor ${isPlanUnconfigured ? "empty" : ""}`} aria-labelledby="overview-plan-anchor-title">
            <div><span>SAFE MONTHLY SPEND</span><h2 id="overview-plan-anchor-title">{isPlanUnconfigured ? "Add money to calculate" : money.format(monthlyLivingMoneyAvailable)}</h2><p>{isPlanUnconfigured ? "Start with the balances you have now. Moneta will reserve planned bills before calculating this amount." : `Available each month after unpaid scheduled payments through ${planningEndLabel}.`}</p></div>
            <div className="overview-plan-period"><span>PLAN THROUGH</span><strong>{planningEndLabel}</strong><button type="button" aria-label={isPlanUnconfigured ? "Edit assets" : "Review plan"} onClick={isPlanUnconfigured ? openAssetEditor : () => navigate("budget")}>{isPlanUnconfigured ? "Add assets & income" : "Review plan"} →</button></div>
          </section>
          {isPlanUnconfigured && <section className="setup-guide" aria-labelledby="setup-guide-title"><div className="setup-guide-intro"><h2 id="setup-guide-title">Set up your plan</h2></div><ol><li><button type="button" onClick={openAssetEditor}><b>1</b><span><strong>Add assets &amp; income</strong></span><i>→</i></button></li><li><button type="button" onClick={() => navigate("settings")}><b>2</b><span><strong>Review plan dates</strong></span><i>→</i></button></li><li><button type="button" onClick={() => navigate("fixed-costs")}><b>3</b><span><strong>Add scheduled payments</strong></span><i>→</i></button></li><li><button type="button" onClick={goToAddTransaction}><b>4</b><span><strong>Record a transaction</strong></span><i>→</i></button></li></ol></section>}
          {!isPlanUnconfigured && <article className={`wealth-overview-card ${totalMoneyAvailable <= 0 ? "empty" : ""}`}>
            <div className="wealth-overview-heading"><div><span>CURRENT NET WORTH</span><strong>{money.format(result.total)}</strong><small>{data.assets.length} {data.assets.length === 1 ? "asset" : "assets"} · displayed in {data.displayCurrency}</small></div><button onClick={openAssetEditor}>Edit assets</button></div>
            {missingExchangeRateCurrencies.length > 0 && <button type="button" className="exchange-rate-warning" onClick={openAssetEditor}>Add exchange rates for {missingExchangeRateCurrencies.join(", ")} before trusting totals.</button>}
            <div className={`wealth-track ${totalMoneyAvailable <= 0 ? "empty" : ""}`} aria-label={totalMoneyAvailable <= 0 ? "Add assets to calculate how much money remains" : `${Math.round(wealthRemainingPercent)} percent of total money remains`}><i style={{ width: `${wealthRemainingPercent}%` }} /></div>
            <div className="wealth-overview-values"><div><span>Remaining</span><strong>{money.format(result.total)}</strong></div><div><span>Spent</span><strong>{money.format(allTimeExpense)}</strong></div><div><span>Total</span><strong>{money.format(totalMoneyAvailable)}</strong></div></div>
            <details className="wealth-details"><summary>Accounts & calculation <span>⌄</span></summary><div><p>Starting assets + recorded income − actual expenses</p><div className="asset-snapshot">{data.assets.length === 0 ? <div className="asset-snapshot-empty"><span>NO ASSETS YET</span><strong>Add only the balances you actually have.</strong></div> : data.assets.map((asset) => { const converted = toDisplayAmount(asset.amount, asset.currency, data.displayCurrency, data.exchangeRates); return <div key={asset.id}><span>{asset.name}</span><strong>{formatOriginalCurrency(asset.amount, asset.currency)}</strong>{asset.currency !== data.displayCurrency && <small>{converted === null ? "Exchange rate needed" : money.format(converted)}</small>}</div>; })}</div></div></details>
          </article>}
          {overdueScheduledPayments.length > 0 && <div className="scheduled-strip overview-scheduled overdue-scheduled" role="status"><div><span>OVERDUE THROUGH {addMonths(currentMonth, -1)}</span><strong title={overdueScheduledNames.join(" · ")}>{overdueScheduledSummary}</strong></div><b>{money.format(overdueScheduledTotal)}</b><small>{overdueScheduledCount} unpaid {overdueScheduledCount === 1 ? "payment remains" : "payments remain"} reserved until linked to a transaction.</small></div>}
          {currentScheduledItems.length > 0 && <div className="scheduled-strip overview-scheduled"><div><span>DUE THIS MONTH · {currentMonth}</span><strong title={currentScheduledItems.map((item) => item.name).join(" · ")}>{summarizeSchedule(currentScheduledItems)}</strong></div><b>{money.format(currentScheduledTotal)}</b><small>Reserved already · link this schedule when recording the payment.</small></div>}
          {hasCategoryBudgetData && <article className={`month-card overview-budget-card ${!hasCategoryBudgetLimits ? "empty" : ""}`}><div className="card-heading"><div><span>{selectedMonth}</span><h2>This month&apos;s category budgets</h2></div><button onClick={() => navigate("budget")}>Edit budgets</button></div>{!hasCategoryBudgetLimits ? <div className="overview-budget-empty tracked"><strong>{categoriesNeedingLimits.length === 1 ? "1 category tracked automatically" : `${categoriesNeedingLimits.length} categories tracked automatically`}</strong><span>{moneyDetailed.format(monthlyUnbudgetedExpenseTotal)} spent this month. Set a monthly limit before Moneta labels the spending over budget.</span></div> : <><div className="budget-remaining"><span>CATEGORY BUDGET REMAINING</span><strong className={budgetAvailable < 0 ? "danger-text" : "success-text"}>{money.format(budgetAvailable)}</strong></div>{monthlyBudgetAbovePlanSafe > 0 && <p className="plan-budget-warning" role="status">Your category budget is {money.format(monthlyBudgetAbovePlanSafe)}/month above the safe monthly spend.</p>}<div className="stacked-track"><i className="actual" style={{ width: `${Math.min(100, monthlyBudgetExpenseTotal / monthlyFlexibleBudgetForSelectedMonth * 100)}%` }} /></div><div className="budget-breakdown two"><div><i className="budget-dot" /><span>Monthly category limits</span><strong>{money.format(monthlyFlexibleBudgetForSelectedMonth)}</strong></div><div><i className="actual-dot" /><span>Spent from category limits</span><strong>{money.format(monthlyBudgetExpenseTotal)}</strong></div></div>{categoriesNeedingLimits.length > 0 && <p className="unlimited-budget-note">{moneyDetailed.format(monthlyUnbudgetedExpenseTotal)} is tracked without a limit.</p>}<p className="clarity-note">This balance only includes expenses in categories with a monthly limit. Other expenses still reduce your net worth.</p></>}</article>}
          <article className="overview-transaction-preview">
            <div className="card-heading"><div><span>RECENT ACTIVITY</span><h2>Transactions</h2></div>{entries.length > 0 && <button type="button" onClick={() => navigate("transaction-history")}>View all →</button>}</div>
            {entries.length === 0 ? <div className="preview-empty"><strong>No transactions</strong><button type="button" onClick={goToAddTransaction}>Add transaction</button></div> : recentEntries.slice(0, overviewTransactionLimit).map((entry) => { const categoryLabel = entryCategoryNames(entry).join(" · "); return <button type="button" className="overview-transaction-row" aria-label={`View details for ${entry.description}`} key={entry.id} onContextMenu={(event) => handleItemContextMenu(event, "transactions", entry.id, entry.description, "transaction")} onPointerDown={(event) => beginItemLongPress(event, "transactions", entry.id, entry.description, "transaction")} onPointerMove={moveItemLongPress} onPointerUp={endItemLongPress} onPointerCancel={endItemLongPress} onPointerLeave={endItemLongPress} onClick={(event) => { if (suppressNextItemClickRef.current) { suppressNextItemClickRef.current = false; return; } openTransactionDetail(entry, event.currentTarget); }}><i className={entry.type}>{categoryLabel[0]}</i><span><strong title={entry.description}>{entry.description}</strong><small title={`${entry.date} · ${categoryLabel}`}>{entry.date} · {categoryLabel}</small></span><b className={entry.type}>{entry.type === "income" ? "+" : "−"}{formatOriginalCurrency(entry.amount, entry.currency)}{entry.currency !== data.displayCurrency && <small>{money.format(toDisplay(entry))}</small>}</b></button>; })}
            <LoadMore shown={overviewTransactionLimit} total={recentEntries.length} step={3} onLoad={() => setOverviewTransactionLimit((current) => current + 3)} />
          </article>
        </div>}

        {view === "transactions" && <div className="page">
          <div className="page-title compact"><div><h1>{locale === "ko" ? "거래 내역" : "Transactions"}</h1></div><label className="month-picker"><span>VIEW MONTH</span><input type="month" value={selectedMonth} onChange={(event) => chooseMonth(event.target.value)} /></label></div>
          <div className="transaction-layout">
            <form className="transaction-form" onSubmit={addEntry}>
              <div className="card-heading"><div><span>{editingEntryId ? "EDIT ENTRY" : "NEW ENTRY"}</span><h2>{editingEntryId ? "Edit transaction" : "Add a transaction"}</h2></div></div>
              {!editingEntryId && <div className="transaction-entry-method wide" role="group" aria-label="Entry method">
                <button type="button" className={transactionEntryMode === "ai" ? "active" : ""} aria-pressed={transactionEntryMode === "ai"} onClick={() => setTransactionEntryMode("ai")}><span>✦</span><strong>Describe with AI</strong></button>
                <button type="button" className={transactionEntryMode === "manual" ? "active" : ""} aria-pressed={transactionEntryMode === "manual"} onClick={() => setTransactionEntryMode("manual")}><span>＋</span><strong>Enter manually</strong></button>
              </div>}
              {!editingEntryId && transactionEntryMode === "ai" && <section className="transaction-ai-assistant wide" aria-labelledby="transaction-ai-title">
                <div className="transaction-ai-heading"><div><h3 id="transaction-ai-title">{locale === "ko" ? "설명하거나 사진 첨부" : "Describe or upload"}</h3></div><i aria-hidden="true">✦</i></div>
                <label className="transaction-ai-description"><span>{locale === "ko" ? "무엇을 결제했나요?" : "Describe this transaction"}</span><textarea aria-label="Describe this transaction" rows={3} value={transactionAiDescription} placeholder={locale === "ko" ? "예: 어제 Target에서 장보기 42.18달러" : "e.g. Yesterday I bought groceries at Target for $42.18"} onChange={(event) => { setTransactionAiDescription(event.target.value); setTransactionAiStatus("idle"); setTransactionAiMessage(""); }} /></label>
                <label className="receipt-upload"><span>{locale === "ko" ? "영수증 · 선택" : "Receipt · optional"}</span><input key={receiptInputKey} type="file" accept="image/*" onChange={(event) => chooseReceipt(event.target.files?.[0])} /><div><i>▣</i><strong>{receiptFile ? receiptFile.name : locale === "ko" ? "이미지 선택" : "Choose image"}</strong><small>{locale === "ko" ? "AI: JPG, PNG, WEBP · 5 MB" : "AI: JPG, PNG, WEBP · 5 MB"}</small></div></label>
                {receiptError && <p className="receipt-error">{receiptError}</p>}
                <div className="transaction-ai-actions"><small>{locale === "ko" ? "OpenAI로 전송됩니다. 저장 전 확인하세요." : "Sent to OpenAI. Review before saving."}</small><button type="button" disabled={transactionAiStatus === "loading" || (!transactionAiDescription.trim() && !receiptFile)} onClick={() => void analyzeTransactionDraft()}>{transactionAiStatus === "loading" ? "Creating draft…" : "Create AI draft"} <b>→</b></button></div>
                {transactionAiStatus === "loading" && <div className="transaction-ai-status loading" role="status">Reading the transaction evidence…</div>}
                {transactionAiStatus === "success" && <div className={`transaction-ai-status success ${transactionReviewLabels.length > 0 ? "review" : ""}`} role="status">{transactionReviewLabels.length > 0 ? `AI draft ready. Check: ${transactionReviewLabels.join(", ")} before saving.` : "AI draft ready. Review every field before saving."}</div>}
                {transactionAiStatus === "error" && <div className="transaction-ai-status error" role="alert">{transactionAiMessage || "AI analysis is temporarily unavailable. Try again."}</div>}
              </section>}
              {(editingEntryId || transactionEntryMode === "manual" || transactionAiStatus === "success") && <fieldset className="transaction-review-fields wide">
              <legend className="sr-only">Transaction details</legend>
              <div className="type-tabs">
                <button type="button" className={draft.type === "expense" ? "active expense" : ""} onClick={() => { clearTransactionAiReviewField("type"); setDraft((current) => ({ ...current, type: "expense", category: primaryAllocationCategory(current.allocations, expenseCategories[0]), countsTowardMonthlyBudget: true, linksPlannedPayment: false, plannedPaymentKey: "" })); }}>Expense</button>
                <button type="button" className={draft.type === "income" ? "active income" : ""} onClick={() => { clearTransactionAiReviewField("type"); clearTransactionAiReviewField("countsTowardMonthlyBudget"); clearTransactionAiReviewField("allocations"); setTransactionAiAllocationReviewFields([]); setDraft((current) => ({ ...current, type: "income", category: incomeCategories[0], allocations: [], linksPlannedPayment: false, plannedPaymentKey: "" })); setReceiptFile(null); setReceiptInputKey((current) => current + 1); }}>Income</button>
              </div>
              <label><span>Date</span><input type="date" required value={draft.date} onChange={(event) => { clearTransactionAiReviewField("date"); setDraft((current) => ({ ...current, date: event.target.value })); }} /></label>
              {draft.allocations.length === 0 && <label><span>Category</span><select value={draft.category} onChange={(event) => { clearTransactionAiReviewField("category"); const category = event.target.value; setDraft((current) => ({ ...current, category, countsTowardMonthlyBudget: current.type === "expense" ? category !== "Tuition" : current.countsTowardMonthlyBudget })); }}>{(draft.type === "expense" ? expenseCategories : incomeCategories).map((category) => <option key={category}>{category}</option>)}</select></label>}
              <label className="wide"><span>Description</span><input required placeholder="e.g. Grocery run" value={draft.description} onChange={(event) => { clearTransactionAiReviewField("description"); setDraft((current) => ({ ...current, description: event.target.value })); }} /></label>
              <TransactionAmountField value={draft.amount} onChange={(amount) => { clearTransactionAiReviewField("amount"); setDraft((current) => ({ ...current, amount })); }} />
              <label><span>Currency</span><select value={draft.currency} onChange={(event) => { clearTransactionAiReviewField("currency"); setDraft((current) => ({ ...current, currency: event.target.value })); }}>{currencyCodes.map((currency) => <option key={currency} value={currency}>{currencyLabel(currency)}</option>)}</select></label>
              {draft.type === "expense" && missingReceiptAllocationReview && <section className="receipt-allocation-empty wide" aria-label="Receipt items need review"><div><span>RECEIPT ITEMS NEED REVIEW</span><strong>AI could not produce a complete category split</strong><small>Add the readable items yourself, or keep this as one category when the receipt is not itemized.</small></div><div><button type="button" onClick={addReceiptAllocation}>Add receipt items</button><button type="button" className="secondary" onClick={() => clearTransactionAiReviewField("allocations")}>Use one category</button></div></section>}
              {draft.type === "expense" && draft.allocations.length > 0 && <fieldset className="receipt-allocation-editor wide" aria-label="Receipt category split">
                <legend className="sr-only">Receipt category split</legend>
                <div className="receipt-allocation-heading"><div><span>RECEIPT CATEGORY SPLIT</span><strong>{draft.allocations.length} {draft.allocations.length === 1 ? "item" : "items"} across {entryCategoryNames({ ...draft, type: "expense" }).length} {entryCategoryNames({ ...draft, type: "expense" }).length === 1 ? "category" : "categories"}</strong><small>Review what AI read. Each item updates its category totals without creating another transaction.</small></div><button type="button" onClick={addReceiptAllocation}>Add item</button></div>
                <div className="receipt-allocation-list">{draft.allocations.map((allocation, index) => <article className="receipt-allocation-row" key={index}>
                  <label><span>ITEM</span><input aria-label={`Receipt item ${index + 1} description`} value={allocation.description} onChange={(event) => updateReceiptAllocation(index, "description", event.target.value)} /></label>
                  <label><span>CATEGORY</span><select aria-label={`Receipt item ${index + 1} category`} value={allocation.category} onChange={(event) => updateReceiptAllocation(index, "category", event.target.value)}><option value="">Choose category</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
                  <label><span>AMOUNT</span><input aria-label={`Receipt item ${index + 1} amount`} type="text" inputMode="decimal" value={formatEditableMoney(allocation.amount)} placeholder="0" onChange={(event) => updateReceiptAllocation(index, "amount", parseEditableMoney(event.target.value))} /></label>
                  <button type="button" aria-label={`Remove receipt item ${index + 1}`} onClick={() => removeReceiptAllocation(index)}>×</button>
                </article>)}</div>
                <div className={`receipt-allocation-balance ${receiptAllocationsNeedAttention ? "warning" : "matched"}`} role="status"><span>{receiptAllocationTotalMatches ? `Split total ${formatOriginalCurrency(receiptAllocationTotal, draft.currency)} matches receipt total ${formatOriginalCurrency(draft.amount, draft.currency)}` : receiptAllocationDifference > 0 ? `${formatOriginalCurrency(receiptAllocationDifference, draft.currency)} unassigned` : `${formatOriginalCurrency(Math.abs(receiptAllocationDifference), draft.currency)} over receipt total`}</span><strong>{formatOriginalCurrency(receiptAllocationTotal, draft.currency)} / {formatOriginalCurrency(draft.amount, draft.currency)}</strong></div>
              </fieldset>}
              {draftNeedsExchangeRate && <p className="receipt-error wide" role="alert">Add a positive {draft.currency} per {data.displayCurrency} exchange rate in Plan setup or Assets before saving.</p>}
              {draft.type === "expense" && <label className="budget-impact wide"><input type="checkbox" aria-label="Count toward monthly budget" checked={draft.countsTowardMonthlyBudget} onChange={(event) => { clearTransactionAiReviewField("countsTowardMonthlyBudget"); setDraft((current) => ({ ...current, countsTowardMonthlyBudget: event.target.checked, linksPlannedPayment: event.target.checked ? false : current.linksPlannedPayment, plannedPaymentKey: event.target.checked ? "" : current.plannedPaymentKey })); }} /><span aria-hidden="true"><i /></span><div><strong>Subtract from this month&apos;s category budgets?</strong><small>{draft.countsTowardMonthlyBudget ? "Yes · counts against this month's category limits" : "No · does not reduce category limits"}</small></div></label>}
              {draft.type === "expense" && draft.allocations.length === 0 && selectablePlannedOccurrences.length > 0 && <label className="budget-impact scheduled-cost-toggle wide"><input type="checkbox" aria-label="Link to a scheduled cost" checked={draft.linksPlannedPayment} onChange={(event) => setDraft((current) => ({ ...current, linksPlannedPayment: event.target.checked, countsTowardMonthlyBudget: event.target.checked ? false : current.countsTowardMonthlyBudget, plannedPaymentKey: event.target.checked ? current.plannedPaymentKey : "" }))} /><span aria-hidden="true"><i /></span><div><strong>Match a scheduled payment?</strong><small>{draft.linksPlannedPayment ? "Yes · prevents reserving it twice" : "No · record as additional spending"}</small></div></label>}
              {draft.type === "expense" && draft.linksPlannedPayment && <label className="wide"><span>Scheduled payment</span><select required value={draft.plannedPaymentKey} onChange={(event) => { const occurrence = selectablePlannedOccurrences.find((item) => item.key === event.target.value); setDraft((current) => ({ ...current, plannedPaymentKey: event.target.value, countsTowardMonthlyBudget: false, ...(occurrence ? { category: occurrence.category, description: current.description || occurrence.name, amount: current.amount || occurrence.amount } : {}) })); }}><option value="">Select a scheduled payment</option>{selectablePlannedOccurrences.map((item) => <option key={item.key} value={item.key}>{item.month} · {item.name} · {money.format(item.amount)}</option>)}</select></label>}
              {draft.type === "expense" && (editingEntryId || transactionEntryMode === "manual") && <label className="receipt-upload wide"><span>{locale === "ko" ? "영수증 · 선택" : "Receipt · optional"}</span><input key={receiptInputKey} type="file" accept="image/*" onChange={(event) => chooseReceipt(event.target.files?.[0])} /><div><i>▣</i><strong>{receiptFile ? receiptFile.name : locale === "ko" ? "이미지 선택" : "Choose image"}</strong><small>{locale === "ko" ? "이미지 · 최대 10 MB" : "Image · max 10 MB"}</small></div></label>}
              {(editingEntryId || transactionEntryMode === "manual") && receiptError && <p className="receipt-error wide">{receiptError}</p>}
              <div className="form-actions transaction-form-actions"><button className="submit-button" type="submit" disabled={draftNeedsExchangeRate || transactionAiStatus === "loading" || transactionReviewLabels.length > 0 || receiptAllocationsNeedAttention}>{editingEntryId ? "Save changes" : "Save transaction"} <b>{editingEntryId ? "✓" : "＋"}</b></button>{editingEntryId && <button className="cancel-button" type="button" onClick={cancelEntryEdit}>Cancel</button>}</div>
              </fieldset>}
            </form>
            <article className="transaction-list">
              <div className="card-heading"><div><span>{selectedMonth.replace("-", " · ")}</span><h2>Actual activity</h2></div><div className="activity-heading-actions"><b>{monthEntries.length} entries</b>{monthEntries.length > 1 && <button type="button" className={selectionScope === "transactions" ? "active" : ""} onClick={() => toggleSelectionMode("transactions")}>{selectionScope === "transactions" ? "Cancel" : "Select multiple"}</button>}{monthEntries.length > 0 && <button type="button" onClick={() => navigate("transaction-history")}>View all →</button>}</div></div>
              {selectionScope === "transactions" && <SelectionBar count={selectedItems.length} noun="transactions" onDelete={() => deleteSelectedItems("transactions")} onCancel={cancelSelection} />}
              {monthEntries.length === 0 ? <div className="empty-state"><i>↕</i><strong>No transactions</strong></div> : monthEntries.slice(0, activityLimit).map(renderTransactionRow)}
              <LoadMore shown={activityLimit} total={monthEntries.length} step={4} onLoad={() => setActivityLimit((current) => current + 4)} />
            </article>
          </div>
          {monthEntries.length > 0 && <div className="transaction-summary three compact-summary"><article><span>Income</span><strong className="success-text">+{money.format(monthlyIncomeTotal)}</strong></article><article><span>Spent</span><strong className="danger-text">−{money.format(monthlyExpenseTotal)}</strong></article><article><span>Net</span><strong>{money.format(monthlyIncomeTotal - monthlyExpenseTotal)}</strong></article></div>}
          {scheduledItems.length > 0 && <div className="scheduled-strip"><div><span>UPCOMING · {selectedMonth}</span><strong title={scheduledItems.map((item) => item.name).join(" · ")}>{summarizeSchedule(scheduledItems)}</strong></div><b>{money.format(scheduledThisMonthTotal)}</b><small>Link this payment when you record the transaction.</small></div>}
        </div>}

        {view === "transaction-history" && <div className="page transaction-history-page">
          <div className="page-title compact"><div><span>ACTUAL ACTIVITY</span><h1>Transactions</h1></div><div className="transaction-history-controls"><label className="month-picker"><span>VIEW MONTH</span><input type="month" value={selectedMonth} onChange={(event) => chooseMonth(event.target.value)} /></label><button className="secondary-action" type="button" onClick={() => navigate("transactions")}>← Transactions</button></div></div>
          <div className="transaction-summary"><article><span>Income</span><strong className="success-text">+{money.format(monthlyIncomeTotal)}</strong></article><article><span>Spent</span><strong className="danger-text">−{money.format(monthlyExpenseTotal)}</strong></article><article><span>Net</span><strong className={monthlyIncomeTotal - monthlyExpenseTotal < 0 ? "danger-text" : "success-text"}>{money.format(monthlyIncomeTotal - monthlyExpenseTotal)}</strong></article></div>
          <article className="transaction-spending-card"><div className="card-heading"><div><span>{selectedMonth.replace("-", " · ")}</span><h2>Spending by category</h2></div><strong>{money.format(monthlyExpenseTotal)}</strong></div><div className="transaction-spending-layout"><div className="transaction-donut" style={{ background: monthlyDonutGradient }}><div><strong>{money.format(monthlyExpenseTotal)}</strong><span>SPENT</span></div></div><div className="transaction-category-bars">{monthlyCategoryStats.length === 0 ? <span className="visual-empty">No spending this month</span> : monthlyCategoryStats.slice(0, transactionStatsLimit).map((item) => <div key={item.category}><span><i style={{ background: item.color }} />{item.category}</span><div><i style={{ width: `${item.amount / monthlyExpenseTotal * 100}%`, background: item.color }} /></div><strong>{money.format(item.amount)}<small>{Math.round(item.amount / monthlyExpenseTotal * 100)}%</small></strong></div>)}<LoadMore shown={transactionStatsLimit} total={monthlyCategoryStats.length} step={5} onLoad={() => setTransactionStatsLimit((current) => current + 5)} /></div></div></article>
          <div className="transaction-filter-bar">
            <label><span>CATEGORY</span><select value={transactionCategoryFilter} onChange={(event) => { setTransactionCategoryFilter(event.target.value); setTransactionLimit(8); cancelSelection(); }}><option value="all">All categories</option>{transactionFilterCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label><span>ACTIVITY</span><select value={transactionTypeFilter} onChange={(event) => { const next = event.target.value as TransactionTypeFilter; setTransactionTypeFilter(next); if (next === "income") setTransactionBudgetFilter("all"); setTransactionLimit(8); cancelSelection(); }}><option value="all">Income + spent</option><option value="income">Income</option><option value="expense">Spent</option></select></label>
            <label><span>BUDGET</span><select value={transactionBudgetFilter} onChange={(event) => { const next = event.target.value as TransactionBudgetFilter; setTransactionBudgetFilter(next); if (next !== "all") setTransactionTypeFilter("expense"); setTransactionLimit(8); cancelSelection(); }}><option value="all">All budget types</option><option value="monthly">Monthly budget</option><option value="outside">Outside budget</option></select></label>
            <div className="transaction-filter-result"><strong>{filteredMonthEntries.length}</strong><span>of {monthEntries.length}</span>{(transactionCategoryFilter !== "all" || transactionTypeFilter !== "all" || transactionBudgetFilter !== "all") && <button type="button" onClick={() => { setTransactionCategoryFilter("all"); setTransactionTypeFilter("all"); setTransactionBudgetFilter("all"); setTransactionLimit(8); cancelSelection(); }}>Clear</button>}</div>
          </div>
          <article className="transaction-list transaction-history-list">
            <div className="card-heading"><div><span>{selectedMonth.replace("-", " · ")}</span><h2>All activity</h2></div><div className="list-heading-actions"><b>{filteredMonthEntries.length} entries</b>{filteredMonthEntries.length > 1 && <button type="button" className={selectionScope === "transactions" ? "active" : ""} onClick={() => toggleSelectionMode("transactions")}>{selectionScope === "transactions" ? "Cancel" : "Select multiple"}</button>}</div></div>
            {selectionScope === "transactions" && <SelectionBar count={selectedItems.length} noun="transactions" onDelete={() => deleteSelectedItems("transactions")} onCancel={cancelSelection} />}
            {visibleMonthEntries.length === 0 ? <div className="empty-state"><i>↕</i><strong>No matching transactions</strong><span>Change the filters or choose another month.</span></div> : visibleMonthEntries.map(renderTransactionRow)}
            <LoadMore shown={transactionLimit} total={filteredMonthEntries.length} step={8} onLoad={() => setTransactionLimit((current) => current + 8)} />
          </article>
        </div>}

        {view === "budget" && <div className="page">
          <div className="page-title compact"><div><h1>{locale === "ko" ? "계획" : "Budget"}</h1></div><div className="budget-page-controls"><label className="month-picker"><span>VIEW MONTH</span><input type="month" value={selectedMonth} onChange={(event) => chooseMonth(event.target.value)} /></label><button className="secondary-action" type="button" onClick={() => navigate("fixed-costs")}>Scheduled payments</button></div></div>
          <section className="budget-capacity-section">
            <div className="budget-capacity-copy"><span>SAFE MONTHLY SPEND</span><h2>Available after planned bills</h2><div className="capacity-plan-facts"><div><span>AVAILABLE AFTER BILLS</span><strong>{money.format(planningCapacity.availableToSpread)}</strong></div><div><span>PLAN PERIOD</span><strong>{planningPeriodLabel}</strong></div><div><span>MONTHS LEFT</span><strong>{remainingPlanningMonths} · through {data.planningEndMonth}</strong></div></div></div>
            <CalculationValue className="capacity-number" label="Plan-safe monthly spend" value={money.format(monthlyLivingMoneyAvailable)} formula={planningFormula} rows={capacityCalculationRows} note="Every unpaid monthly and one-time payment is reserved through its end month. Paid linked payments are already reflected in net worth and are not reserved again. Future income is not assumed." />
            <button type="button" onClick={() => navigate("settings")}>{remainingPlanningMonths > 0 ? `${remainingPlanningMonths} months left · Edit` : "Choose new period"}</button>
          </section>
          <section className={`budget-month-section ${!hasCategoryBudgetLimits ? "empty" : ""}`}>
            <div className="budget-month-heading"><div><span>{selectedMonth}</span><h2>Monthly category budget</h2></div>{hasCategoryBudgetLimits && <CalculationValue className={`month-heading-number ${budgetAvailable < 0 ? "danger-text" : "success-text"}`} label={`${selectedMonth} category budget balance`} value={`${budgetAvailable < 0 ? "Over" : "Left"} ${money.format(Math.abs(budgetAvailable))}`} formula={`${moneyDetailed.format(monthlyBudgetTotal)} − ${moneyDetailed.format(monthlyBudgetExpenseTotal)} = ${moneyDetailed.format(budgetAvailable)}`} rows={budgetAvailableCalculationRows} />}</div>
            {!hasCategoryBudgetData ? <div className="budget-month-empty"><strong>No category budgets</strong></div> : !hasCategoryBudgetLimits ? <div className="budget-month-empty tracked"><strong>Set {categoriesNeedingLimits.length === 1 ? "1 category limit" : `${categoriesNeedingLimits.length} category limits`}</strong><span>{moneyDetailed.format(monthlyUnbudgetedExpenseTotal)} spent without limits.</span></div> : <><div className="budget-month-values"><div><span>Category budgets</span><CalculationValue label={`${selectedMonth} monthly category budget`} value={money.format(monthlyLivingBudget)} formula="sum of active category budgets" rows={budgetCalculationRows} align="left" /></div><div><span>Spent from category limits</span><CalculationValue label={`${selectedMonth} spending from category limits`} value={money.format(monthlyBudgetExpenseTotal)} formula="sum of saved expenses in categories with a limit" rows={spentCalculationRows} align="left" /></div><div className={budgetAvailable < 0 ? "warning" : "positive"}><span>{budgetAvailable < 0 ? "Over budget" : "Remaining"}</span><CalculationValue label={`${selectedMonth} category budget balance`} value={money.format(Math.abs(budgetAvailable))} formula={`${moneyDetailed.format(monthlyBudgetTotal)} − ${moneyDetailed.format(monthlyBudgetExpenseTotal)} = ${moneyDetailed.format(budgetAvailable)}`} rows={budgetAvailableCalculationRows} /></div></div>{categoriesNeedingLimits.length > 0 && <p className="unlimited-budget-note" role="status">{moneyDetailed.format(monthlyUnbudgetedExpenseTotal)} is tracked in {categoriesNeedingLimits.length} {categoriesNeedingLimits.length === 1 ? "category" : "categories"} without a limit.</p>}{monthlyBudgetAbovePlanSafe > 0 && <p className="plan-budget-warning" role="status">This category budget is {money.format(monthlyBudgetAbovePlanSafe)}/month above your safe monthly spend.</p>}<div className="stacked-track"><i className={budgetAvailable < 0 ? "over" : "actual"} style={{ width: `${Math.min(100, monthlyBudgetExpenseTotal / monthlyBudgetTotal * 100)}%` }} /></div></>}
          </section>
          <article className="category-budget">
            <div className="card-heading category-heading">
              <div><span>THIS MONTH</span><h2>Category budgets</h2></div>
              {displayedBudgetCategories.length > 0 && <div className="category-heading-actions">
                <label><span>SORT BY</span><select value={categorySort} onChange={(event) => { setCategorySort(event.target.value as CategorySort); setBudgetListLimit(5); cancelSelection(); }}><option value="manual">Custom order</option><option value="budget-desc">Budget · high to low</option><option value="alphabetical">Alphabetical</option><option value="spent-desc">Most spent</option><option value="spent-asc">Least spent</option></select></label>
                <CalculationValue label="Expected monthly budgets" value={money.format(monthlyBudgetTotal)} formula="sum of active category budgets" rows={budgetCalculationRows} />
                {displayedBudgetCategories.length > 1 && <button type="button" className={`list-select ${selectionScope === "budgets" ? "active" : ""}`} onClick={() => toggleSelectionMode("budgets")}>{selectionScope === "budgets" ? "Cancel" : "Select multiple"}</button>}
              </div>}
            </div>
            <form className="budget-category-add" onSubmit={addBudgetCategory}><select aria-label="Category to add to budgets" value={budgetCategoryDraft} onChange={(event) => setBudgetCategoryDraft(event.target.value)}><option value="">Select a category</option>{availableBudgetCategories.map((category) => <option key={category}>{category}</option>)}</select><button disabled={!budgetCategoryDraft}>Add budget</button></form>
            {selectionScope === "budgets" && <SelectionBar count={selectedItems.length} noun="budgets" onDelete={() => deleteSelectedItems("budgets")} onCancel={cancelSelection} />}
            {displayedBudgetCategories.length === 0 ? <div className="category-budget-empty"><strong>No category budgets</strong></div> : <div className={`budget-mix-layout ${!hasCategoryBudgetLimits ? "limits-unset" : ""}`}>
              {hasCategoryBudgetLimits && <div className="budget-donut-panel"><div className="budget-donut" style={{ background: budgetDonutGradient }}><div><strong>{money.format(monthlyBudgetTotal)}</strong><span>TOTAL</span></div></div><div className="budget-donut-legend">{budgetCategoryStats.slice(0, budgetListLimit).map((item) => <div key={item.category}><i style={{ background: item.color }} /><span>{item.category}</span><strong>{Math.round(item.amount / monthlyBudgetTotal * 100)}%</strong></div>)}<LoadMore shown={budgetListLimit} total={budgetCategoryStats.length} step={5} onLoad={() => setBudgetListLimit((current) => current + 5)} /></div></div>}
              <div className="budget-category-list">{displayedBudgetCategories.length === 0 ? <div className="budget-empty"><strong>No expected budgets</strong><span>Select a category above to add one.</span></div> : displayedBudgetCategories.slice(0, budgetListLimit).map((category) => {
                const budget = monthlyBudgets[category] || 0;
                const spent = spentByCategory[category] || 0;
                const hasLimit = budget > 0;
                const percent = hasLimit ? spent / budget * 100 : 0;
                const balance = budget - spent;
                return <div className={`category-row budget-category-row ${hasLimit && balance < 0 ? "over-budget" : ""} ${!hasLimit ? "needs-limit" : ""} ${selectionScope === "budgets" ? "selecting" : ""}`} key={category} onContextMenu={(event) => handleItemContextMenu(event, "budgets", category, category, "budget")}><div className="budget-category-copy" onPointerDown={(event) => beginItemLongPress(event, "budgets", category, category, "budget")} onPointerMove={moveItemLongPress} onPointerUp={endItemLongPress} onPointerCancel={endItemLongPress} onPointerLeave={endItemLongPress}><strong title={category}>{category}</strong><span>{hasLimit ? `${money.format(spent)} / ${money.format(budget)}` : `${moneyDetailed.format(spent)} spent`}</span></div><div className={`category-track ${!hasLimit ? "no-limit" : ""}`} aria-label={hasLimit ? `${category} is ${Math.round(percent)} percent used` : `${category} has no monthly limit`}><i className={percent > 100 ? "over" : ""} style={{ width: `${Math.min(100, percent)}%` }} /></div><strong className={`budget-category-balance ${!hasLimit ? "unset" : balance < 0 ? "over" : "left"}`}><small>{!hasLimit ? "SET LIMIT" : balance < 0 ? "OVER" : "LEFT"}</small>{hasLimit ? money.format(Math.abs(balance)) : "—"}</strong><label className="budget-amount-input"><span>Budget</span><div><i>{data.displayCurrency}</i><input aria-label={`${category} expected monthly budget`} type="text" inputMode="decimal" value={formatEditableMoney(budget)} placeholder="0" onChange={(event) => setMonthlyBudgets((current) => ({ ...current, [category]: parseEditableMoney(event.target.value) }))} /></div></label><button type="button" className="item-more budget-row-more" aria-label={`More actions for ${category}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openItemActions("budgets", category, category, "budget", rect.right, rect.bottom, event.currentTarget); }}>⋯</button>{selectionScope === "budgets" && <label className="row-check budget-row-check"><input type="checkbox" checked={selectedItems.includes(category)} onChange={() => toggleSelectedItem(category)} /><span aria-hidden="true">✓</span><b className="sr-only">Select {category}</b></label>}</div>;
              })}<LoadMore shown={budgetListLimit} total={displayedBudgetCategories.length} step={5} onLoad={() => setBudgetListLimit((current) => current + 5)} /></div>
            </div>}
          </article>

        </div>}

        {view === "fixed-costs" && <div className="page fixed-costs-page">
          <div className="page-title compact"><div><span>BUDGET · PAYMENT SCHEDULE</span><h1>Scheduled payments</h1></div><div className="fixed-cost-page-controls"><label className="month-picker"><span>VIEW MONTH</span><input type="month" value={selectedMonth} onChange={(event) => chooseMonth(event.target.value)} /></label><button className="secondary-action" type="button" onClick={() => navigate("budget")}>← Budget</button></div></div>
          <div className="fixed-cost-summary"><article><span>EVERY MONTH</span><strong>{money.format(fixedMonthlyTotal)}</strong><small>{selectedMonthlyFixedItems.length} items in {selectedMonth}</small></article><article><span>ONE-TIME</span><strong>{money.format(selectedOneTimeTotal)}</strong><small>{selectedOneTimeItems.length} items in {selectedMonth}</small></article></div>
          <article className="recurring-card recurring-manager">
            <div className="card-heading"><div><span>ADD PAYMENT</span><h2>{editingRecurringId ? "Edit scheduled payment" : "Create a scheduled payment"}</h2></div></div>
            <form className="recurring-form" onSubmit={addRecurringExpense}>
              <div className="preset-tabs"><button type="button" className={recurringDraft.intervalMonths > 0 ? "active" : ""} onClick={() => chooseRecurringPreset("recurring")}>Every month</button><button type="button" className={recurringDraft.intervalMonths === 0 ? "active" : ""} onClick={() => chooseRecurringPreset("one-time")}>One-time</button></div>
              {recurringDraft.category === "Tuition" && <aside className="tuition-helper"><div><span>TUITION ESTIMATE</span><strong>Check your school&apos;s official estimate</strong><p>Confirm the term, program, residency status, fees, and credit hours with your school. Then enter the expected payment below.</p></div><small>{recurringDraft.intervalMonths === 0 ? "Add the exact payment month." : "Choose the first charge month and an optional end month."}</small></aside>}
              <label><span>Name</span><input required value={recurringDraft.name} placeholder="e.g. Rent" onChange={(event) => setRecurringDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>Category</span><select value={recurringDraft.category} onChange={(event) => setRecurringDraft((current) => ({ ...current, category: event.target.value }))}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>Amount</span><div className="amount-field">{data.displayCurrency} <input required type="text" inputMode="decimal" value={formatEditableMoney(recurringDraft.amount)} placeholder="0" onChange={(event) => setRecurringDraft((current) => ({ ...current, amount: parseEditableMoney(event.target.value) }))} /></div></label>
              <label><span>{recurringDraft.intervalMonths === 0 ? "Payment month" : "First charge month"}</span><input required type="month" value={recurringDraft.startMonth} onChange={(event) => setRecurringDraft((current) => ({ ...current, startMonth: event.target.value }))} /></label>
              {recurringDraft.intervalMonths > 0 && <label><span>End month · optional</span><input type="month" min={recurringDraft.startMonth} value={recurringDraft.endMonth} onChange={(event) => setRecurringDraft((current) => ({ ...current, endMonth: event.target.value }))} /></label>}
              <div className="reserve-preview"><span>{recurringDraft.intervalMonths === 0 ? "ONE-TIME" : "EVERY MONTH"}</span><strong>{money.format(recurringDraft.amount)}</strong></div>
              <div className="form-actions"><button className="submit-button" type="submit">{editingRecurringId ? "Save changes" : recurringDraft.intervalMonths === 0 ? "Add one-time payment" : "Add monthly payment"} <b>{editingRecurringId ? "✓" : "＋"}</b></button>{editingRecurringId && <button className="cancel-button" type="button" onClick={() => chooseRecurringPreset("recurring")}>Cancel</button>}</div>
            </form>
          </article>
          <div className="fixed-cost-toolbar"><div className="filter-tabs" role="group" aria-label="Filter scheduled payments"><button type="button" className={fixedCostFilter === "all" ? "active" : ""} onClick={() => { setFixedCostFilter("all"); setFixedCostLimit(8); cancelSelection(); }}>All</button><button type="button" className={fixedCostFilter === "monthly" ? "active" : ""} onClick={() => { setFixedCostFilter("monthly"); setFixedCostLimit(8); cancelSelection(); }}>Monthly</button><button type="button" className={fixedCostFilter === "one-time" ? "active" : ""} onClick={() => { setFixedCostFilter("one-time"); setFixedCostLimit(8); cancelSelection(); }}>One-time</button></div><div className="list-heading-actions"><strong>{filteredFixedCosts.length} payments</strong>{filteredFixedCosts.length > 1 && <button type="button" className={selectionScope === "fixed-costs" ? "active" : ""} onClick={() => toggleSelectionMode("fixed-costs")}>{selectionScope === "fixed-costs" ? "Cancel" : "Select multiple"}</button>}</div></div>
          {selectionScope === "fixed-costs" && <SelectionBar count={selectedItems.length} noun="fixed costs" onDelete={() => deleteSelectedItems("fixed-costs")} onCancel={cancelSelection} />}
          <article className="fixed-cost-full-list recurring-list">{visibleFixedCosts.length === 0 ? <div className="recurring-empty"><i>↻</i><strong>No matching costs</strong><span>Create a scheduled payment using the form above.</span></div> : visibleFixedCosts.map((item) => {
            return <div className={`recurring-row ${selectionScope === "fixed-costs" ? "selecting" : ""}`} key={item.id} onContextMenu={(event) => handleItemContextMenu(event, "fixed-costs", item.id, item.name, "scheduled payment")}>{selectionScope === "fixed-costs" && <label className="row-check"><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => toggleSelectedItem(item.id)} /><span aria-hidden="true">✓</span><b className="sr-only">Select {item.name}</b></label>}<i>{item.intervalMonths === 0 ? "1×" : "M"}</i><div className="recurring-copy" onPointerDown={(event) => beginItemLongPress(event, "fixed-costs", item.id, item.name, "scheduled payment")} onPointerMove={moveItemLongPress} onPointerUp={endItemLongPress} onPointerCancel={endItemLongPress} onPointerLeave={endItemLongPress}><strong title={item.name}>{item.name}</strong><span title={`${item.category} · ${item.intervalMonths === 0 ? `Due ${selectedMonth}` : `${selectedMonth} · Active ${item.startMonth}${item.endMonth ? `–${item.endMonth}` : "+"}`}`}>{item.category} · {item.intervalMonths === 0 ? `Due ${selectedMonth}` : `${selectedMonth} · Active ${item.startMonth}${item.endMonth ? `–${item.endMonth}` : "+"}`}</span></div><div className="recurring-amount"><strong>{money.format(item.amount)}</strong><span>{item.intervalMonths === 0 ? "ONE-TIME" : "MONTHLY"}</span></div><div className="recurring-actions"><button type="button" aria-label={`Edit ${item.name}`} onClick={() => editRecurringExpense(item)}>Edit</button><button type="button" className="item-more" aria-label={`More actions for ${item.name}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openItemActions("fixed-costs", item.id, item.name, "scheduled payment", rect.right, rect.bottom, event.currentTarget); }}>⋯</button></div></div>;
          })}</article>
          <LoadMore shown={fixedCostLimit} total={filteredFixedCosts.length} step={8} onLoad={() => setFixedCostLimit((current) => current + 8)} />
        </div>}

        {view === "categories" && <div className="page categories-page">
          <div className="page-title compact"><div><span>SETTINGS · ORGANIZE</span><h1>Categories</h1><p>Edit a name directly in its field, then press Enter or click outside to save.</p></div><div className="category-title-actions"><button className="secondary-action" type="button" onClick={() => navigate("settings")}>← Settings</button><strong className="category-count">{expenseCategories.length}</strong><button type="button" className={`list-select ${selectionScope === "categories" ? "active" : ""}`} onClick={() => toggleSelectionMode("categories")}>{selectionScope === "categories" ? "Cancel" : "Select multiple"}</button></div></div>
          {selectionScope === "categories" && <SelectionBar count={selectedItems.length} noun="categories" onDelete={() => deleteSelectedItems("categories")} onCancel={cancelSelection} />}
          <div className="category-manager-grid">
            {expenseCategories.slice(0, categoryLimit).map((category, index) => {
              return <article className="category-manager-row" key={category} onContextMenu={(event) => handleItemContextMenu(event, "categories", category, category, "category")} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("input, button, label")) beginItemLongPress(event, "categories", category, category, "category"); }} onPointerMove={moveItemLongPress} onPointerUp={endItemLongPress} onPointerCancel={endItemLongPress} onPointerLeave={endItemLongPress}>
                <i style={{ background: chartColors[index % chartColors.length] }} />
                <label><span>NAME · EDITABLE</span><input defaultValue={category} aria-label={`Rename ${category}`} onBlur={(event) => renameCategory(category, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
                <div className="category-manager-actions"><button disabled={index === 0} aria-label={`Move ${category} up`} onClick={() => moveCategory(index, -1)}>↑</button><button disabled={index === expenseCategories.length - 1} aria-label={`Move ${category} down`} onClick={() => moveCategory(index, 1)}>↓</button><button type="button" className="item-more" aria-label={`More actions for ${category}`} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openItemActions("categories", category, category, "category", rect.right, rect.bottom, event.currentTarget); }}>⋯</button>{selectionScope === "categories" && <label className="row-check"><input type="checkbox" checked={selectedItems.includes(category)} onChange={() => toggleSelectedItem(category)} /><span aria-hidden="true">✓</span><b className="sr-only">Select {category}</b></label>}</div>
              </article>;
            })}
            <form className="category-create-card" onSubmit={addCategory}><i>＋</i><input value={newCategory} aria-label="New category name" placeholder="New category" onChange={(event) => setNewCategory(event.target.value)} /><button>Add</button></form>
          </div>
          <LoadMore shown={categoryLimit} total={expenseCategories.length} step={8} onLoad={() => setCategoryLimit((current) => current + 8)} />
        </div>}

        {view === "what-if" && <div className="page what-if-page">
          <div className="page-title compact"><div><h1 aria-label={`${locale === "ko" ? "조건 바꿔보기" : "Try a scenario"} · What-if`}>{locale === "ko" ? "조건 바꿔보기" : "Try a scenario"}</h1></div><button className="secondary-action" type="button" onClick={() => setWhatIf({ oneTime: 0, monthlyChange: 0 })}>Reset</button></div>
          <div className="what-if-layout">
            <article className="what-if-controls">
              <div className="card-heading"><div><span>SCENARIO</span><h2>Adjust the plan</h2></div><i>◈</i></div>
              <MoneyInput label="One-time purchase" value={whatIf.oneTime} onChange={(value) => setWhatIf((current) => ({ ...current, oneTime: value }))} unit={data.displayCurrency} step={100} />
              <label className="money-input"><span>Monthly spending change</span><div><input type="text" inputMode="decimal" value={formatEditableMoney(whatIf.monthlyChange)} placeholder="0" onChange={(event) => setWhatIf((current) => ({ ...current, monthlyChange: parseSignedEditableMoney(event.target.value) }))} /><i>{data.displayCurrency}</i></div><small>Negative = save more</small></label>
              <div className={`scenario-mobile-verdict ${scenarioStatus}`} role="status"><span>LIVE RESULT</span><strong>{scenarioStatus === "safe" ? "SAFE" : scenarioStatus === "tight" ? "TIGHT" : scenarioStatus === "plan-ended" ? "PLAN ENDED" : "NOT RECOMMENDED"}</strong><small>{scenarioMonths > 0 ? `${money.format(scenarioEnding)} estimated at plan end` : "Choose a new period in Plan setup"}</small></div>
              <div className={`scenario-period ${scenarioMonths === 0 ? "ended" : ""}`}><span>PLAN END DATE</span><strong>{data.planningEndMonth}</strong><small>{scenarioMonths > 0 ? `${scenarioMonths} months` : "Plan ended"}</small></div>
            </article>
            <article className={`scenario-result ${scenarioStatus}`}>
              <div className="scenario-status"><span>{scenarioStatus === "safe" ? "SAFE" : scenarioStatus === "tight" ? "TIGHT" : scenarioStatus === "plan-ended" ? "PLAN ENDED" : "NOT RECOMMENDED"}</span><i>{scenarioStatus === "safe" ? "✓" : scenarioStatus === "tight" ? "!" : scenarioStatus === "plan-ended" ? "◷" : "×"}</i></div>
              <div><span>ESTIMATED BALANCE AT PLAN END · {data.planningEndMonth}</span><strong>{scenarioMonths > 0 ? money.format(scenarioEnding) : "—"}</strong>{scenarioMonths > 0 && <small className={scenarioDifference < 0 ? "danger-text" : "success-text"}>{scenarioDifference >= 0 ? "+" : ""}{money.format(scenarioDifference)} vs current plan</small>}</div>
              <div className="scenario-bars"><div><span>Current plan</span><i><b style={{ width: `${Math.max(0, Math.min(100, scenarioBaselineEnding / Math.max(result.total, 1) * 100))}%` }} /></i><strong>{money.format(scenarioBaselineEnding)}</strong></div><div><span>What-if</span><i><b style={{ width: `${Math.max(0, Math.min(100, scenarioEnding / Math.max(result.total, 1) * 100))}%` }} /></i><strong>{money.format(scenarioEnding)}</strong></div></div>
              <div className="scenario-breakdown" aria-label="What-if calculation breakdown"><div><span>Current net worth</span><strong>{money.format(result.total)}</strong></div><div><span>Unpaid scheduled payments through {data.planningEndMonth}</span><strong>−{money.format(planningCapacity.scheduledTotal)}</strong></div><div><span>Monthly category budget · {money.format(monthlyBudgetTotal)} × {scenarioMonths} months</span><strong>−{money.format(scenarioBaselineFlexibleTotal)}</strong></div>{whatIf.oneTime > 0 && <div><span>What-if one-time purchase</span><strong>−{money.format(whatIf.oneTime)}</strong></div>}{scenarioMonthlyChangeTotal !== 0 && <div><span>What-if monthly change · {money.format(Math.abs(scenarioMonthlySpend - monthlyBudgetTotal))} × {scenarioMonths}</span><strong>{scenarioMonthlyChangeTotal > 0 ? "−" : "+"}{money.format(Math.abs(scenarioMonthlyChangeTotal))}</strong></div>}<div className="result"><span>Estimated balance at plan end</span><strong>{scenarioMonths > 0 ? money.format(scenarioEnding) : "—"}</strong></div></div>
              <p className="scenario-note">Excludes future income, returns, and rate changes.</p>
            </article>
            <button className="scenario-apply" type="button" disabled={whatIf.oneTime <= 0 || scenarioMonths === 0} onClick={() => { setRecurringDraft({ name: "What-if purchase", category: expenseCategories.includes("Other") ? "Other" : expenseCategories[0], amount: whatIf.oneTime, intervalMonths: 0, startMonth: currentMonth, endMonth: "" }); setEditingRecurringId(null); navigate("fixed-costs"); }}>Prepare as one-time payment →</button>
          </div>
        </div>}

        {view === "settings" && <div className="page settings-page">
          <div className="page-title compact"><div><h1 aria-label={`${locale === "ko" ? "계획 설정" : "Plan setup"} · Settings`}>{locale === "ko" ? "계획 설정" : "Plan setup"}</h1></div><span className="settings-save-note">● Changes save automatically</span></div>
          <section className="settings-section plan-foundation-section" aria-labelledby="plan-foundation-heading">
            <div className="settings-section-heading"><h2 id="plan-foundation-heading">Plan inputs</h2></div>
            <div className="settings-grid settings-surface-grid plan-foundation-grid">
            <article><div className="settings-icon">$</div><div><span>ASSETS</span><h2>Balances & income</h2><p>{money.format(result.total)} current net worth</p></div><button type="button" onClick={openAssetEditor}>Edit →</button></article>
            <article><div className="settings-icon">◇</div><div><span>CATEGORIES</span><h2>Spending categories</h2><p>{expenseCategories.length} categories</p></div><button type="button" onClick={() => navigate("categories")}>Manage →</button></article>
            <article className="settings-inline planning-period-setting"><div className="settings-icon">◷</div><div><span>FIXED PLAN PERIOD</span><h2>When should this money last?</h2><p>{remainingPlanningMonths > 0 ? `${remainingPlanningMonths} months remain in ${planningPeriodLabel}.` : `The plan ending ${data.planningEndMonth} has finished.`}</p></div><div className="planning-period-inputs"><label><span>START</span><input aria-label="Planning start month" type="month" required value={data.planningStartMonth} onChange={(event) => { const planningStartMonth = event.target.value; if (!planningStartMonth) return; setData((current) => ({ ...current, planningStartMonth, planningEndMonth: monthIndex(current.planningEndMonth) < monthIndex(planningStartMonth) ? planningStartMonth : current.planningEndMonth })); }} /></label><label><span>USE THROUGH</span><input aria-label="Planning end month" type="month" required min={monthIndex(data.planningStartMonth) > monthIndex(currentMonth) ? data.planningStartMonth : currentMonth} value={data.planningEndMonth} onChange={(event) => { if (event.target.value) set("planningEndMonth", event.target.value); }} /></label></div></article>
            </div>
          </section>
          <section className="settings-section preference-settings-section" aria-labelledby="preference-settings-heading">
            <div className="settings-section-heading"><h2 id="preference-settings-heading">Preferences &amp; account</h2></div>
            <div className="settings-surface-grid preference-settings-grid">
            <article className="settings-inline currency-setting"><div className="settings-icon">¤</div><div><span>PRIMARY CURRENCY</span><h2>Display &amp; plan currency</h2><p>Plans convert. Assets and transactions keep their original currency.</p></div><label><span className="sr-only">Primary display currency</span><select aria-label="Primary display currency" value={data.displayCurrency} onChange={(event) => changeDisplayCurrency(event.target.value)}>{currencyCodes.map((currency) => <option key={currency} value={currency}>{currencyLabel(currency)}</option>)}</select></label></article>
            <article className="settings-data exchange-rate-settings"><div className="settings-icon">⇄</div><div><span>EXCHANGE RATES</span><h2>Conversion rates</h2><p>Set foreign units per 1 {data.displayCurrency}.</p>{missingExchangeRateCurrencies.length > 0 && <p className="danger-text">Required now: {missingExchangeRateCurrencies.join(", ")}</p>}</div><div className="exchange-rate-editor">{Object.keys(data.exchangeRates).sort().map((currency) => { const rateInUse = currenciesInUse.includes(currency); return <label key={currency}><span>{currency} per {data.displayCurrency}</span><input aria-label={`${currency} per ${data.displayCurrency}`} type="text" inputMode="decimal" value={formatEditableMoney(data.exchangeRates[currency])} placeholder="0" onChange={(event) => setData((current) => ({ ...current, exchangeRates: { ...current.exchangeRates, [currency]: parseEditableMoney(event.target.value) } }))} /><button type="button" disabled={rateInUse} title={rateInUse ? "Remove assets and transactions in this currency first" : undefined} aria-label={`Remove ${currency} exchange rate`} onClick={() => setData((current) => { const exchangeRates = { ...current.exchangeRates }; delete exchangeRates[currency]; return { ...current, exchangeRates }; })}>×</button></label>; })}<div className="exchange-rate-add"><select aria-label="Exchange rate currency" value={rateCurrencyDraft} onChange={(event) => setRateCurrencyDraft(event.target.value)}><option value="">Choose a currency</option>{currencyCodes.filter((currency) => currency !== data.displayCurrency && !(currency in data.exchangeRates)).map((currency) => <option key={currency} value={currency}>{currencyLabel(currency)}</option>)}</select><button type="button" disabled={!rateCurrencyDraft} onClick={addExchangeRateCurrency}>Add rate</button></div></div></article>
            <article className="settings-language"><div className="settings-icon">文</div><div><span>LANGUAGE</span><h2>Navigation language</h2><p>{locale === "ko" ? "내비게이션과 핵심 안내만 한국어로 표시되며 세부 도구는 영어입니다." : "Navigation and key page guidance only. Detailed tools remain in English."}</p></div><div className="language-options" role="group" aria-label="Interface language"><button type="button" aria-pressed={locale === "en"} className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>English</button><button type="button" aria-pressed={locale === "ko"} className={locale === "ko" ? "active" : ""} onClick={() => setLocale("ko")}>한국어 · 부분 지원</button></div></article>
            <article className="settings-data"><div className="settings-icon">↓</div><div><span>BACKUP</span><h2>Download your data</h2><p>Portable JSON copy.</p></div><div><button type="button" onClick={exportBackup}>Download backup</button></div></article>
            <article className="settings-account"><div className="settings-icon">◉</div><div><span>ACCOUNT</span><h2>{account.session.user.email}</h2><p className={syncStatus === "error" ? "danger-text" : "success-text"}>{syncLabel}</p></div><button type="button" onClick={() => void account.signOut()}>Sign out</button></article>
            </div>
          </section>
        </div>}

        {view === "insights" && <div className="page insights-page">
          <div className="page-title compact"><div><h1 aria-label={`${locale === "ko" ? "지출 분석" : "Spending insights"} · Insights`}>{locale === "ko" ? "지출 분석" : "Spending insights"}</h1></div><div className="insight-range-controls"><label className="month-picker"><span>ANALYSIS THROUGH</span><input aria-label="Analysis through month" type="month" value={selectedMonth} onChange={(event) => { chooseMonth(event.target.value); setOverLimitLimit(5); }} /></label><label className="month-picker"><span>LOOKBACK</span><div><input aria-label="Analysis lookback months" type="number" min="1" max="24" value={insightMonths || ""} onChange={(event) => { setInsightMonths(Math.max(0, Math.min(24, Number(event.target.value) || 0))); setOverLimitLimit(5); }} onBlur={() => { if (insightMonths < 1) setInsightMonths(6); }} /> months</div></label></div></div>
          {!hasInsightSpending ? <>
            <article className="insight-action-card insights-empty-state">
              <div><div className="insight-plan-kicker"><span>SAFE MONTHLY SPEND</span><small>CURRENT PLAN TARGET</small><small>AS OF {currentMonth}</small></div><CalculationValue className="insight-target-number" label="Safe monthly spend" value={money.format(suggestedMonthlyBudget)} formula={planningFormula} rows={capacityCalculationRows} note={`Live plan as of ${currentMonth}. The analysis range above does not change this target.`} align="left" /><small>{remainingPlanningMonths > 0 ? `${money.format(planningCapacity.availableToSpread)} available through ${data.planningEndMonth} ÷ ${remainingPlanningMonths} months` : "Choose a new period in Plan setup."}</small></div>
              <div className="insights-empty-copy"><strong>No spending yet</strong><button type="button" onClick={goToAddTransaction}>Add transaction</button></div>
            </article>
            <section className="insights-preview" aria-labelledby="insights-preview-title">
              <div className="insights-preview-heading"><div><h2 id="insights-preview-title">After your first expense</h2></div></div>
              <div className="insights-preview-layout">
                <article className="insights-preview-trend"><div><strong>Spending trend</strong></div><div className="insights-preview-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div></article>
                <div className="insights-preview-signals"><article><strong>Top category</strong></article><article><strong>Budget alerts</strong></article></div>
              </div>
            </section>
          </> : <>
            <article className="insight-action-card">
              <div><div className="insight-plan-kicker"><span>SAFE MONTHLY SPEND</span><small>CURRENT PLAN TARGET</small><small>AS OF {currentMonth}</small></div><CalculationValue className="insight-target-number" label="Safe monthly spend" value={money.format(suggestedMonthlyBudget)} formula={planningFormula} rows={capacityCalculationRows} note={`Live plan as of ${currentMonth}. The analysis range above does not change this target.`} align="left" /><small>{remainingPlanningMonths > 0 ? `${money.format(planningCapacity.availableToSpread)} available through ${data.planningEndMonth} ÷ ${remainingPlanningMonths} months` : "Choose a new period in Plan setup."}</small></div>
              <div className={`insight-action-copy ${totalOverBudget > 0 ? "warning" : "positive"}`}><i>{totalOverBudget > 0 ? "↓" : "✓"}</i><div><strong>{totalOverBudget > 0 ? `Reduce by ${money.format(insightMonthlyAdjustment)}` : `Category budget remaining: ${money.format(insightMonthlyAdjustment)}`}</strong><span>{totalOverBudget > 0 ? `${overBudgetCategories[0]?.category || "Spending"} drove the largest overage in this period.` : `${topCategory?.category || "Spending"} was your largest category. Keep the next month within the category budget.`}</span></div></div>
            </article>
            <div className="visual-insights-grid single"><article className="trend-card"><div className="card-heading"><div><span>{insightPeriodMonths} MONTHS</span><h2>Spending trend</h2></div><strong>{money.format(monthlyBudgetTotal)}<small>/ month category budget</small></strong></div><div className="trend-scroll"><div className={`trend-bars ${insightPeriodMonths > 12 ? "compact" : ""}`} style={{ gridTemplateColumns: `repeat(${insightPeriodMonths}, minmax(0, 1fr))` }}>{spendingTrend.map((item, index) => <div key={item.month} title={`${item.month} · ${money.format(item.amount)}`} aria-label={`${item.month}, ${money.format(item.amount)}`}>{insightPeriodMonths <= 12 && <span>{money.format(item.amount)}</span>}<i style={{ height: `${Math.max(3, item.amount / trendMax * 100)}%` }} className={item.amount > monthlyBudgetTotal ? "over" : ""} /><b>{insightPeriodMonths > 12 ? (index % 3 === 0 || index === spendingTrend.length - 1 ? item.month.slice(2).replace("-", "·") : "") : insightPeriodMonths > 6 ? item.month.slice(2).replace("-", "·") : item.month.slice(5)}</b></div>)}</div></div></article></div>
            <div className="insight-kpis two"><article><span>TOP CATEGORY</span><strong>{topCategory?.category || "—"}</strong><small>{topCategory ? `${money.format(topCategory.amount)} · ${Math.round(topCategoryPercent)}%` : "No spending"}</small></article><article className={totalOverBudget > 0 ? "warning" : "positive"}><span>OVER LIMIT</span><strong>{money.format(totalOverBudget)}</strong><small>{overBudgetCategories.length} categories</small></article></div>
            <article className="over-limit-panel"><div className="card-heading"><div><span>PERIOD LIMITS</span><h2>Over by category</h2></div><strong>{money.format(totalOverBudget)}</strong></div>{overBudgetCategories.length === 0 ? <div className="visual-empty">No category exceeded its expected budget in this period.</div> : overBudgetCategories.slice(0, overLimitLimit).map((item) => <div className="over-limit-row" key={item.category}><span>{item.category}<small>{money.format(item.spent)} / {money.format(item.limit)}</small></span><div><i style={{ width: `${item.over / maxCategoryOverage * 100}%` }} /></div><strong>+{money.format(item.over)}</strong></div>)}<LoadMore shown={overLimitLimit} total={overBudgetCategories.length} step={5} onLoad={() => setOverLimitLimit((current) => current + 5)} /></article>
          </>}
        </div>}
      </section>
      {itemActions && <div className="item-context-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeItemActions(); }}>
        <div ref={itemActionMenuRef} className="item-context-menu" role="menu" aria-label={`Actions for ${itemActions.label}`} style={{ left: itemActions.left, top: itemActions.top }}>
          <div><span>{itemActions.noun.toUpperCase()}</span><strong title={itemActions.label}>{itemActions.label}</strong></div>
          <button type="button" className="item-context-delete" role="menuitem" onClick={deleteContextItem}><TrashIcon /> Delete {itemActions.noun}</button>
          <button type="button" className="item-context-cancel" role="menuitem" onClick={() => closeItemActions()}>Cancel</button>
        </div>
      </div>}
      {undoAction && <div className="undo-toast" role="status"><span>{undoAction.message}</span><button type="button" onClick={() => { undoAction.restore(); setUndoAction(null); }}>Undo</button><button className="undo-close" type="button" aria-label="Dismiss" onClick={() => setUndoAction(null)}>×</button></div>}
      {transactionDetailEntry && <div className="modal-backdrop transaction-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTransactionDetail(); }}>
        <section ref={transactionDetailDialogRef} className="transaction-detail-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title" aria-describedby="transaction-detail-summary" tabIndex={-1}>
          <div className="modal-heading transaction-detail-heading"><div><span>{transactionDetailHasAllocations ? "ITEMIZED RECEIPT" : "TRANSACTION DETAIL"}</span><h2 id="transaction-detail-title">{transactionDetailEntry.description}</h2><p id="transaction-detail-summary">{transactionDetailEntry.type === "income" ? "Saved income" : transactionDetailEntry.countsTowardMonthlyBudget !== false ? "Saved expense · counted in monthly category budgets" : "Saved expense · outside monthly category budgets"}</p></div><button ref={transactionDetailCloseRef} type="button" aria-label="Close transaction details" onClick={() => closeTransactionDetail()}>×</button></div>
          <div className="transaction-detail-facts">
            <div><span>DATE</span><strong>{transactionDetailEntry.date}</strong></div>
            <div><span>CURRENCY</span><strong>{transactionDetailEntry.currency}</strong></div>
            <div><span>{transactionDetailHasAllocations ? "RECEIPT TOTAL" : "TRANSACTION TOTAL"}</span><strong>{formatOriginalCurrency(transactionDetailEntry.amount, transactionDetailEntry.currency)}</strong></div>
            <div><span>CATEGORIES</span><strong>{transactionDetailCategories.join(" · ") || "Uncategorized"}</strong></div>
          </div>
          <section className="transaction-detail-items" aria-labelledby="transaction-detail-items-title">
            <div className="transaction-detail-section-heading"><div><span>{transactionDetailHasAllocations ? "RECEIPT ITEMS" : "SUMMARY ITEM"}</span><h3 id="transaction-detail-items-title">{transactionDetailHasAllocations ? `${transactionDetailItems.length} item${transactionDetailItems.length === 1 ? "" : "s"}` : "Saved transaction summary"}</h3></div><strong>{transactionDetailCategories.length} {transactionDetailCategories.length === 1 ? "category" : "categories"}</strong></div>
            <div className="transaction-detail-item-list" role="list">{transactionDetailItems.map((item, index) => <article className="transaction-detail-item" role="listitem" key={`${item.description}-${index}`}><div><span>ITEM {index + 1}</span><strong>{item.description || transactionDetailEntry.description}</strong></div><span title={item.category || transactionDetailEntry.category || "Uncategorized"}>{item.category || transactionDetailEntry.category || "Uncategorized"}</span><strong>{formatOriginalCurrency(item.amount, transactionDetailEntry.currency)}</strong></article>)}</div>
          </section>
          <section className="transaction-detail-category-totals" aria-labelledby="transaction-detail-category-totals-title">
            <div className="transaction-detail-section-heading"><div><span>CATEGORY BREAKDOWN</span><h3 id="transaction-detail-category-totals-title">Category totals</h3></div></div>
            <div className="transaction-detail-category-total-list" role="list">{transactionDetailCategoryTotals.map((total) => <article className="transaction-detail-category-total" role="listitem" key={total.category}><div><strong>{total.category}</strong><small>{total.itemCount} {total.itemCount === 1 ? "item" : "items"}</small></div><strong>{formatOriginalCurrency(total.amount, transactionDetailEntry.currency)}</strong></article>)}</div>
          </section>
          <section className={`transaction-detail-reconciliation ${transactionDetailTotalMatches ? "matched" : "warning"}`} aria-label="Transaction total reconciliation">
            <div><span>{transactionDetailHasAllocations ? "Item total" : "Summary total"}</span><strong>{formatOriginalCurrency(transactionDetailItemsTotal, transactionDetailEntry.currency)}</strong></div>
            <div><span>{transactionDetailHasAllocations ? "Receipt total" : "Transaction total"}</span><strong>{formatOriginalCurrency(transactionDetailEntry.amount, transactionDetailEntry.currency)}</strong></div>
            <p>{transactionDetailTotalMatches
              ? `${transactionDetailHasAllocations ? "Item" : "Summary"} total ${formatOriginalCurrency(transactionDetailItemsTotal, transactionDetailEntry.currency)} matches ${transactionDetailHasAllocations ? "receipt" : "transaction"} total ${formatOriginalCurrency(transactionDetailEntry.amount, transactionDetailEntry.currency)}.`
              : transactionDetailDifference > 0
                ? `${formatOriginalCurrency(transactionDetailDifference, transactionDetailEntry.currency)} of the ${transactionDetailHasAllocations ? "receipt" : "transaction"} total is not included in the item summary.`
                : `The item summary is ${formatOriginalCurrency(Math.abs(transactionDetailDifference), transactionDetailEntry.currency)} over the ${transactionDetailHasAllocations ? "receipt" : "transaction"} total.`}</p>
          </section>
          <div className="transaction-detail-actions"><button type="button" className="transaction-detail-edit" onClick={() => { closeTransactionDetail(false); editEntry(transactionDetailEntry); }}>Edit transaction</button></div>
        </section>
      </div>}
      {assetEditorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssetEditorOpen(false); }}><section className="asset-editor" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title"><div className="modal-heading"><div><span>CURRENT MONEY</span><h2 id="asset-editor-title">Edit assets &amp; rates</h2><p>Add only balances you actually hold. Foreign balances are converted with the rates you enter.</p></div><button aria-label="Close asset editor" onClick={() => setAssetEditorOpen(false)}>×</button></div><div className="asset-editor-list">{assetDraft.assets.map((asset, index) => <article className="asset-editor-row" key={asset.id}><label><span>NAME</span><input aria-label={`Asset ${index + 1} name`} value={asset.name} placeholder="e.g. Checking" onChange={(event) => updateAsset(asset.id, { name: event.target.value })} /></label><label><span>AMOUNT</span><input aria-label={`Asset ${index + 1} amount`} type="text" inputMode="decimal" value={formatEditableMoney(asset.amount)} placeholder="0" onChange={(event) => updateAsset(asset.id, { amount: parseEditableMoney(event.target.value) })} /></label><label><span>CURRENCY</span><select aria-label={`Asset ${index + 1} currency`} value={asset.currency} onChange={(event) => updateAsset(asset.id, { currency: event.target.value })}>{currencyCodes.map((currency) => <option key={currency} value={currency}>{currencyLabel(currency)}</option>)}</select></label><button type="button" aria-label={`Remove asset ${index + 1}`} onClick={() => removeAsset(asset.id)}>×</button></article>)}<button className="add-asset-button" type="button" onClick={addAsset}>＋ Add asset</button></div>{requiredAssetDraftCurrencies.length > 0 && <section className="asset-rate-section"><div><span>EXCHANGE RATES</span><p>Units of foreign currency per 1 {data.displayCurrency}</p></div><div>{requiredAssetDraftCurrencies.map((currency) => <label key={currency}><span>{currency} per {data.displayCurrency}</span><input aria-label={`${currency} per ${data.displayCurrency}`} type="text" inputMode="decimal" value={formatEditableMoney(assetDraft.exchangeRates[currency] || 0)} placeholder="0" onChange={(event) => setAssetDraft((current) => ({ ...current, exchangeRates: { ...current.exchangeRates, [currency]: parseEditableMoney(event.target.value) } }))} /></label>)}</div></section>}{missingAssetDraftRates.map((currency) => <p className="asset-rate-warning" role="alert" key={currency}>Add a positive exchange rate for {currency}</p>)}<div className="asset-income"><MoneyInput label="Monthly net income" value={assetDraft.monthlyIncome} onChange={(monthlyIncome) => setAssetDraft((current) => ({ ...current, monthlyIncome }))} unit={data.displayCurrency} step={100} /></div><button className="modal-done" disabled={missingAssetDraftRates.length > 0 || assetDraft.assets.some((asset) => !asset.name.trim())} onClick={saveAssetEditor}>Save balances</button></section></div>}
      {activeReceiptUrl && <div className="receipt-viewer" role="dialog" aria-modal="true" aria-label="Receipt photo"><button aria-label="Close receipt photo" onClick={() => setActiveReceiptUrl(null)}>×</button><img src={activeReceiptUrl} alt="Attached receipt" /></div>}
    </main>
  );
}

export default function Home() {
  return <MonetaAuthGate>{(account) => <MonetaDashboard account={account} />}</MonetaAuthGate>;
}

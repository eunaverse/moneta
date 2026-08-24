import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSnapshot,
  migrateLegacyAssetRecord,
  normalizeSnapshot,
  toDisplayAmount,
} from "../lib/moneta-state.ts";

const legacyData = {
  krwPrimary: 0,
  krwSecondary: 0,
  krwEmergency: 0,
  usdCash: 0,
  exchangeRate: 1_400,
  planningStartMonth: "2026-08",
  planningEndMonth: "2028-07",
  monthlyIncome: 0,
};

const legacySnapshot = (overrides = {}) => ({
  version: 1,
  data: legacyData,
  entries: [],
  monthlyBudgets: {},
  expenseCategories: ["Housing", "Food", "Transport", "Other"],
  budgetCategories: [],
  categorySort: "manual",
  recurringExpenses: [],
  insightMonths: 6,
  ...overrides,
});

test("new accounts default to USD without sample balances or category budgets", () => {
  const snapshot = createDefaultSnapshot("2026-08");

  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.data.displayCurrency, "USD");
  assert.deepEqual(snapshot.data.assets, []);
  assert.deepEqual(snapshot.data.exchangeRates, {});
  assert.deepEqual(snapshot.monthlyBudgets, {});
  assert.deepEqual(snapshot.budgetCategories, []);
});

test("normalization preserves explicit v2 database values without merging samples", () => {
  const normalized = normalizeSnapshot({
    version: 2,
    data: {
      assets: [],
      displayCurrency: "EUR",
      exchangeRates: { USD: 1.08 },
      planningStartMonth: "2026-08",
      planningEndMonth: "2027-08",
      monthlyIncome: 0,
    },
    entries: [],
    monthlyBudgets: { Rent: 1_234 },
    expenseCategories: ["Rent"],
    budgetCategories: [],
    categorySort: "manual",
    recurringExpenses: [],
    insightMonths: 12,
  }, "2026-08");

  assert.equal(normalized.data.displayCurrency, "EUR");
  assert.deepEqual(normalized.data.assets, []);
  assert.deepEqual(normalized.monthlyBudgets, { Rent: 1_234 });
  assert.deepEqual(normalized.budgetCategories, []);
});

test("recovers legacy assets from a mixed v2 snapshot without dropping transactions or budgets", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    version: 2,
    data: {
      ...legacyData,
      krwPrimary: 1_400_000,
      usdCash: 500,
    },
    entries: [{
      id: "saved-expense",
      date: "2026-08-20",
      type: "expense",
      category: "Food",
      description: "Groceries",
      amount: 70,
      currency: "USD",
    }],
    monthlyBudgets: { Food: 650 },
    budgetCategories: ["Food"],
  }), "2026-08");

  assert.deepEqual(
    normalized.data.assets.map(({ name, amount, currency }) => ({ name, amount, currency })),
    [
      { name: "Primary account", amount: 1_400_000, currency: "KRW" },
      { name: "Cash", amount: 500, currency: "USD" },
    ],
  );
  assert.equal(normalized.data.exchangeRates.KRW, 1_400);
  assert.equal(normalized.entries.length, 1);
  assert.deepEqual(normalized.monthlyBudgets, { Food: 650 });
  assert.deepEqual(normalized.budgetCategories, ["Food"]);
});

test("keeps an explicit modern empty asset list authoritative over stale legacy fields", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    version: 2,
    data: {
      ...legacyData,
      assets: [],
      krwPrimary: 1_400_000,
      displayCurrency: "USD",
      exchangeRates: {},
    },
  }), "2026-08");

  assert.deepEqual(normalized.data.assets, []);
  assert.deepEqual(normalized.data.exchangeRates, {});
});

test("persists a legacy asset record once as a modern snapshot without changing transactions or budgets", async () => {
  const stored = legacySnapshot({
    version: 2,
    data: {
      ...legacyData,
      krwPrimary: 1_400_000,
      usdCash: 500,
    },
    entries: [{
      id: "saved-expense",
      date: "2026-08-20",
      type: "expense",
      category: "Food",
      description: "Groceries",
      amount: 70,
      currency: "USD",
    }],
    monthlyBudgets: { Food: 650 },
    budgetCategories: ["Food"],
  });
  let persisted;

  const result = await migrateLegacyAssetRecord(
    { state: stored, updatedAt: "2026-08-24T12:00:00.000Z" },
    async (state, expectedUpdatedAt) => {
      persisted = { state, expectedUpdatedAt };
      return { state, updatedAt: "2026-08-24T12:01:00.000Z" };
    },
  );

  assert.equal(result.migrated, true);
  assert.equal(result.record.updatedAt, "2026-08-24T12:01:00.000Z");
  assert.equal(persisted.expectedUpdatedAt, "2026-08-24T12:00:00.000Z");
  assert.deepEqual(persisted.state.data.assets, [
    { id: "legacy-primary-krw", name: "Primary account", amount: 1_400_000, currency: "KRW" },
    { id: "legacy-usd-cash", name: "Cash", amount: 500, currency: "USD" },
  ]);
  assert.equal("krwPrimary" in persisted.state.data, false);
  assert.deepEqual(JSON.parse(JSON.stringify(persisted.state.entries)), stored.entries);
  assert.deepEqual(persisted.state.monthlyBudgets, { Food: 650 });
  assert.deepEqual(persisted.state.budgetCategories, ["Food"]);
});

test("does not rewrite a record that already has the modern assets array", async () => {
  let persistCalls = 0;
  const record = {
    state: legacySnapshot({
      version: 2,
      data: {
        assets: [],
        displayCurrency: "USD",
        exchangeRates: {},
        planningStartMonth: "2026-08",
        planningEndMonth: "2028-07",
        monthlyIncome: 0,
      },
    }),
    updatedAt: "2026-08-24T12:00:00.000Z",
  };

  const result = await migrateLegacyAssetRecord(record, async () => {
    persistCalls += 1;
    return record;
  });

  assert.equal(result.migrated, false);
  assert.equal(result.record, record);
  assert.equal(persistCalls, 0);
});

test("migrates legacy KRW and USD balances plus the user-entered rate", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    data: {
      ...legacyData,
      krwPrimary: 1_400_000,
      krwEmergency: 700_000,
      usdCash: 500,
    },
  }), "2026-08");

  assert.equal(normalized.version, 2);
  assert.equal(normalized.data.displayCurrency, "USD");
  assert.equal(normalized.data.exchangeRates.KRW, 1_400);
  assert.deepEqual(
    normalized.data.assets.map(({ name, amount, currency }) => ({ name, amount, currency })),
    [
      { name: "Primary account", amount: 1_400_000, currency: "KRW" },
      { name: "Emergency fund", amount: 700_000, currency: "KRW" },
      { name: "Cash", amount: 500, currency: "USD" },
    ],
  );
});

test("does not invent an exchange rate when legacy data has none", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    data: {
      ...legacyData,
      krwPrimary: 1_400_000,
      exchangeRate: undefined,
    },
  }), "2026-08");

  assert.equal(normalized.data.exchangeRates.KRW, 0);
  assert.equal(toDisplayAmount(1_400_000, "KRW", "USD", normalized.data.exchangeRates), null);
});

test("removes only the untouched legacy sample budget signature", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    monthlyBudgets: {
      Housing: 1_800,
      Food: 650,
      Transport: 400,
      "Insurance & Health": 500,
      Tuition: 100,
      Shopping: 250,
      Travel: 200,
      Other: 100,
    },
    expenseCategories: ["Housing", "Food", "Transport", "Insurance & Health", "Tuition", "Shopping", "Travel", "Other"],
    budgetCategories: ["Housing", "Food", "Transport"],
  }), "2026-08");

  assert.deepEqual(normalized.monthlyBudgets, {});
  assert.deepEqual(normalized.budgetCategories, []);
});

test("preserves customized legacy category budgets", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    monthlyBudgets: { Housing: 1_900, Food: 650 },
    budgetCategories: ["Housing", "Food"],
  }), "2026-08");

  assert.deepEqual(normalized.monthlyBudgets, { Housing: 1_900, Food: 650 });
  assert.deepEqual(normalized.budgetCategories, ["Housing", "Food"]);
});

test("converts foreign money with the user-entered units-per-display-currency rate", () => {
  assert.equal(toDisplayAmount(1_400_000, "KRW", "USD", { KRW: 1_400 }), 1_000);
  assert.equal(toDisplayAmount(250, "USD", "USD", {}), 250);
  assert.equal(toDisplayAmount(100, "EUR", "USD", {}), null);
  assert.equal(toDisplayAmount(100, "EUR", "USD", { EUR: 0 }), null);
});

test("normalization preserves a reconciled itemized receipt allocation", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    version: 2,
    data: {
      assets: [],
      displayCurrency: "USD",
      exchangeRates: {},
      planningStartMonth: "2026-08",
      planningEndMonth: "2028-07",
      monthlyIncome: 0,
    },
    entries: [{
      id: "mixed-receipt",
      date: "2026-08-20",
      type: "expense",
      category: "Food",
      description: "Target",
      amount: 30,
      currency: "USD",
      allocations: [
        { description: "Milk", category: "Food", amount: 5 },
        { description: "Storage bin", category: "Shopping", amount: 25 },
      ],
    }],
    expenseCategories: ["Food", "Shopping", "Other"],
  }), "2026-08");

  assert.deepEqual(normalized.entries[0].allocations, [
    { description: "Milk", category: "Food", amount: 5 },
    { description: "Storage bin", category: "Shopping", amount: 25 },
  ]);
});

test("normalization drops a corrupted receipt allocation instead of distorting category totals", () => {
  const normalized = normalizeSnapshot(legacySnapshot({
    entries: [{
      id: "broken-split",
      date: "2026-08-20",
      type: "expense",
      category: "Food",
      description: "Target",
      amount: 30,
      currency: "USD",
      allocations: [
        { description: "Milk", category: "Food", amount: 5 },
        { description: "Storage bin", category: "Shopping", amount: 20 },
      ],
    }],
  }), "2026-08");

  assert.equal(normalized.entries[0].allocations, undefined);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Supabase setup or authentication gate", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Moneta — Finances at a glance<\/title>/i);
  assert.match(html, /DATABASE SETUP|Opening Moneta/);
  if (html.includes("DATABASE SETUP")) {
    assert.match(html, /Connect Moneta to Supabase/);
    assert.match(html, /VITE_SUPABASE_URL/);
    assert.match(html, /VITE_SUPABASE_ANON_KEY/);
  }
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("supports separate budgets, planned payments, categories, and visual insights", async () => {
  const [css, page, layout, authGate, repository, stateModel, migration, realtimeMigration] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/moneta-auth-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/moneta-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/moneta-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/001_moneta.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/002_finance_state_realtime.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /countsTowardMonthlyBudget/);
  assert.match(page, /calculatePlanningCapacity/);
  assert.match(page, /planningCapacity\.suggestedMonthlySpending/);
  assert.match(page, /Every unpaid monthly and one-time payment is reserved through its end month/);
  assert.match(page, /const monthlyLivingBudget = monthlyBudgetTotal/);
  assert.match(page, /draft\.linksPlannedPayment/);
  assert.match(page, /FIXED PLAN/);
  assert.match(page, /Suggested monthly spending/);
  assert.match(page, /Spread the money left after unpaid scheduled payments through your fixed end month/);
  assert.match(page, /function CalculationValue/);
  assert.match(page, /calculation-tooltip/);
  assert.match(css, /\.calculation-value:hover > \.calculation-tooltip/);
  assert.match(css, /\.calculation-value:focus > \.calculation-tooltip/);
  assert.doesNotMatch(page, /label-with-tip">SCHEDULED/);
  assert.match(page, /Every month/);
  assert.doesNotMatch(page, /Repeat every/);
  assert.doesNotMatch(page, /NON-MONTHLY RESERVE/);
  assert.match(page, /End month · optional/);
  assert.match(page, /Save changes/);
  assert.match(page, /Payment month/);
  assert.match(page, /Match a scheduled payment\?/);
  assert.match(page, /Scheduled payment/);
  assert.match(page, /This month/);
  assert.match(page, /Your money,/);
  assert.doesNotMatch(page, /from actual transactions/);
  assert.doesNotMatch(page, /PERIOD INSIGHT|smart-insight/);
  assert.match(page, /Categories/);
  assert.match(page, /Expected budgets/);
  assert.match(page, /move-money-budget-categories/);
  assert.doesNotMatch(page, /localStorage\.setItem\("move-money-/);
  assert.match(page, /loadMonetaState/);
  assert.match(page, /saveMonetaState/);
  assert.match(page, /Move to my account/);
  assert.match(page, /uploadReceipt/);
  assert.match(authGate, /signInWithOAuth/);
  assert.match(authGate, /provider: "google"/);
  assert.match(authGate, /Continue with Google/);
  assert.doesNotMatch(authGate, /signInWithOtp|Email me a sign-in link/);
  assert.match(authGate, /signOut/);
  assert.match(repository, /finance_states/);
  assert.match(repository, /createSignedUrls/);
  assert.match(repository, /subscribeMonetaState/);
  assert.match(repository, /postgres_changes/);
  assert.match(repository, /expectedUpdatedAt/);
  assert.match(repository, /MonetaStateConflictError/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /storage\.foldername/);
  assert.match(realtimeMigration, /alter publication supabase_realtime add table public\.finance_states/i);
  assert.match(page, /Updated from another window/);
  assert.match(page, /Newer changes found/);
  assert.match(page, /Use cloud/);
  assert.match(page, /Keep mine/);
  assert.match(css, /\.auth-shell/);
  assert.match(css, /\.migration-banner/);
  assert.match(page, /activeBudgetCategories\.reduce/);
  assert.match(page, /budgetDonutGradient/);
  assert.match(page, /Add budget/);
  assert.match(page, /toggleSelectionMode\("budgets"\)/);
  assert.match(page, /deleteSelectedItems\("budgets"\)/);
  assert.match(page, /className="selection-delete"/);
  assert.match(page, /<svg aria-hidden="true" viewBox="0 0 24 24">/);
  assert.match(css, /\.selection-delete svg/);
  assert.match(page, /function LoadMore/);
  assert.match(page, /Load more/);
  assert.match(css, /\.load-more/);
  assert.doesNotMatch(page, /Flexible spending only/);
  assert.match(page, /view === "fixed-costs"/);
  assert.match(page, /Filter scheduled payments/);
  assert.match(page, />Monthly<\/button>/);
  assert.match(page, />One-time<\/button>/);
  assert.match(page, /filteredFixedCosts\.slice/);
  assert.match(page, /move-money-insight-months/);
  assert.match(page, /const insightMonthKeys/);
  assert.match(page, /minmax\(0, 1fr\)/);
  assert.match(page, /insightPeriodMonths > 12 \? "compact"/);
  assert.match(page, /index % 3 === 0/);
  assert.match(css, /\.visual-insights-grid > \* \{ min-width: 0;/);
  assert.match(css, /\.trend-bars\.compact/);
  assert.match(page, /const suggestedMonthlyBudget = monthlyLivingMoneyAvailable/);
  assert.match(page, /left to spread through \$\{data\.planningEndMonth\} ÷ \$\{remainingPlanningMonths\} months/);
  assert.match(page, /MONEY TO SPREAD/);
  assert.match(page, /FIXED PLAN PERIOD/);
  assert.match(page, /Planning end month/);
  assert.match(page, /Over by category/);
  assert.match(page, /selectedMonthlyFixedItems = recurringExpenses\.filter/);
  assert.match(page, /fixedCostsForSelectedMonth = recurringExpenses\.filter/);
  assert.match(page, /Spending by category/);
  assert.match(page, /monthlyDonutGradient/);
  assert.match(page, /overview-transaction-preview/);
  assert.match(page, /className="mobile-menu-button"/);
  assert.match(page, /className="mobile-drawer"/);
  assert.match(page, /className="mobile-quick-add"/);
  assert.doesNotMatch(page, /className="mobile-transaction-fab"/);
  assert.match(page, /aria-label="Open menu"/);
  assert.doesNotMatch(page, /<header className="mobile-header">.*?<select.*?<\/header>/s);
  assert.match(css, /\.mobile-drawer \{ position: fixed;/);
  assert.match(page, /view === "transaction-history"/);
  assert.match(page, /navigate\("transaction-history"\)/);
  assert.match(page, /visibleMonthEntries/);
  assert.match(page, /filteredMonthEntries/);
  assert.match(page, /transactionCategoryFilter/);
  assert.match(page, /transactionTypeFilter/);
  assert.match(page, /transactionBudgetFilter/);
  assert.match(page, /All categories/);
  assert.match(page, /Income \+ spent/);
  assert.match(page, /All budget types/);
  assert.doesNotMatch(page, /aria-label="Transaction pages"/);
  assert.match(page, /Edit transaction/);
  assert.match(page, /const editEntry/);
  assert.match(page, /Save changes/);
  assert.match(page, /setUndoAction/);
  assert.match(page, />Undo<\/button>/);
  assert.match(css, /\.transaction-filter-bar/);
  assert.match(page, /budget-capacity-section/);
  assert.match(page, /budget-month-section/);
  assert.match(page, /Category budget<\/span><CalculationValue/);
  assert.doesNotMatch(page, /budget-guide|Regular limit|Marked transactions|Assets only/);
  assert.match(page, /budget-category-balance/);
  assert.match(page, /Existing records will move to a remaining category/);
  assert.doesNotMatch(page, /periodAssetShareLeft|outsideBudgetPeriodTotal/);
  assert.match(css, /\.budget-category-row > \* \{ min-width: 0; \}/);
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /@container \(max-width: 560px\)/);
  assert.match(css, /grid-template-areas: "category balance" "track track" "amount amount"/);
  assert.match(css, /\.budget-mix-layout \{ min-width: 0; max-width: 100%;/);
  assert.doesNotMatch(page, /<div><span>BUDGET<\/span><strong>\{usd\.format\(monthlyBudgets/);
  assert.doesNotMatch(page, /FUTURE PLANNED PAYMENTS/);
  assert.match(css, /\.budget-impact/);
  assert.match(css, /\.budget-status\.excluded/);
  assert.match(page, /view === "what-if"/);
  assert.match(page, /PREVIEW ONLY/);
  assert.match(page, /scenarioStatus/);
  assert.match(page, /ESTIMATED BALANCE AT PLAN END/);
  assert.match(page, /What-if calculation breakdown/);
  assert.match(page, /Unpaid scheduled payments through/);
  assert.doesNotMatch(page, /Simulation period/);
  assert.match(page, /view === "settings"/);
  assert.match(page, /Primary display currency/);
  assert.match(page, /Download backup/);
  assert.match(page, /Moneta never fetches or assumes a rate/);
  assert.match(stateModel, /displayCurrency: "USD"/);
  assert.match(stateModel, /assets: \[\]/);
  assert.match(stateModel, /monthlyBudgets: \{\}/);
  assert.match(stateModel, /toDisplayAmount/);
  assert.doesNotMatch(page, /Export or import|importBackup|accept="application\/json/);
  assert.doesNotMatch(page, /krwPrimary|krwSecondary|krwEmergency|usdCash|data\.exchangeRate\b/);
  assert.match(page, /Manage scheduled payments/);
  assert.match(page, /ADD PAYMENT/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.mobile-quick-add/);
  assert.doesNotMatch(css, /\.mobile-transaction-fab/);
  assert.match(page, /className="budget-amount-input"/);
  assert.match(css, /\.budget-amount-input:focus-within/);
  assert.match(layout, /title:\s*"Moneta — Finances at a glance"/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
});

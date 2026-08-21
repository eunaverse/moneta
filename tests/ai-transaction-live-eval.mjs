import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  analyzeTransactionWithOpenAI,
  normalizeTransactionAiDraft,
  TRANSACTION_AI_MODEL,
} from "../lib/transaction-ai.ts";

const standardCredentialName = ["OPENAI", "API", "KEY"].join("_");
const credential = process.env.MONETA_TRANSACTION_AI_TOKEN || process.env[standardCredentialName];
if (!credential) {
  throw new Error("A server-side OpenAI credential is required for the mandatory live AI eval.");
}

const requestedEffort = process.env.AI_EVAL_REASONING_EFFORT || "none";
if (requestedEffort !== "none" && requestedEffort !== "low") {
  throw new Error("AI_EVAL_REASONING_EFFORT must be none or low.");
}

const categories = {
  expenseCategories: ["Housing", "Food", "Transport", "Shopping", "Other"],
  incomeCategories: ["Salary", "Refund", "Other income"],
  currencies: ["USD", "KRW", "EUR"],
};
const baseInput = { ...categories, today: "2026-08-20" };
const expectedOutputFields = [
  "allocations",
  "amount",
  "category",
  "countsTowardMonthlyBudget",
  "currency",
  "date",
  "description",
  "type",
  "uncertainFields",
];

const assertSchema = (id, output) => {
  const parsed = JSON.parse(output);
  assert.deepEqual(Object.keys(parsed).sort(), expectedOutputFields, `${id}: output fields must match the strict schema`);
  assert.ok(Array.isArray(parsed.uncertainFields), `${id}: uncertainFields must be an array`);
  assert.ok(Array.isArray(parsed.allocations), `${id}: allocations must be an array`);
  for (const allocation of parsed.allocations) {
    assert.deepEqual(Object.keys(allocation).sort(), ["amount", "category", "description", "uncertainFields"], `${id}: allocation fields must match the strict schema`);
    assert.ok(Array.isArray(allocation.uncertainFields), `${id}: allocation uncertainFields must be an array`);
  }
  return parsed;
};

const assertExpected = (id, result, expected) => {
  for (const [field, value] of Object.entries(expected.draft)) {
    assert.deepEqual(result.draft[field], value, `${id}: unexpected ${field}`);
  }
  for (const field of expected.needsReview || []) {
    assert.ok(result.needsReview.includes(field), `${id}: ${field} must require review`);
  }
  if (expected.allocations) {
    assert.equal(result.needsReview.includes("allocations"), false, `${id}: grounded allocations must not require review`);
    assert.ok(result.allocationNeedsReview.every((fields) => fields.length === 0), `${id}: grounded allocation fields must not require review`);
    const byCategory = Object.fromEntries(expected.allocations.map((item) => [item.category, 0]));
    for (const allocation of result.draft.allocations) {
      assert.ok(allocation.description, `${id}: every allocation needs a grounded description`);
      if (typeof allocation.category === "string" && typeof allocation.amount === "number" && allocation.category in byCategory) byCategory[allocation.category] += allocation.amount;
    }
    for (const allocation of expected.allocations) {
      assert.equal(byCategory[allocation.category], allocation.amount, `${id}: unexpected ${allocation.category} allocation`);
    }
  }
};

const createSyntheticReceipt = async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 980 }, deviceScaleFactor: 1 });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#ececec;font-family:Arial,sans-serif;padding:42px">
          <main style="box-sizing:border-box;width:676px;min-height:880px;background:white;padding:54px;color:#111">
            <h1 style="font-size:42px;margin:0 0 34px">WHOLE FOODS MARKET</h1>
            <p style="font-size:27px;line-height:1.65">Transaction date: 08/18/2026<br>Payment method: VISA</p>
            <hr style="margin:42px 0;border:0;border-top:3px solid #111">
            <p style="font-size:30px;line-height:1.8">Fresh produce&nbsp;&nbsp;$28.10<br>Kitchen storage bin&nbsp;&nbsp;$35.17</p>
            <hr style="margin:42px 0;border:0;border-top:3px solid #111">
            <p style="font-size:44px;font-weight:700">TOTAL USD $63.27</p>
          </main>
        </body>
      </html>
    `);
    return `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
  } finally {
    await browser.close();
  }
};

const cases = [
  {
    id: "korean-expense",
    input: { ...baseInput, description: "어제 Target에서 식료품을 사고 최종 결제 금액으로 42.18달러를 냈어." },
    expected: {
      draft: { date: "2026-08-19", type: "expense", category: "Food", amount: 42.18, currency: "USD", countsTowardMonthlyBudget: true },
    },
  },
  {
    id: "korean-income",
    input: { ...baseInput, description: "오늘 회사에서 급여로 3,200달러를 받았어." },
    expected: {
      draft: { date: "2026-08-20", type: "income", category: "Salary", amount: 3200, currency: "USD", countsTowardMonthlyBudget: null },
    },
  },
  {
    id: "euro-expense",
    input: { ...baseInput, description: "오늘 파리 카페에서 점심으로 18.40유로를 결제했어." },
    expected: {
      draft: { date: "2026-08-20", type: "expense", category: "Food", amount: 18.4, currency: "EUR", countsTowardMonthlyBudget: true },
    },
  },
  {
    id: "missing-amount",
    input: { ...baseInput, description: "오늘 Target에서 식료품을 샀는데 결제 금액은 기억나지 않아." },
    expected: {
      draft: { date: "2026-08-20", type: "expense", category: "Food", amount: null },
      needsReview: ["amount"],
    },
  },
];

cases.push({
  id: "mixed-category-receipt-image",
  input: { ...baseInput, description: "", imageDataUrl: await createSyntheticReceipt() },
  expected: {
    draft: { date: "2026-08-18", type: "expense", category: "Shopping", amount: 63.27, currency: "USD", countsTowardMonthlyBudget: true },
    allocations: [
      { category: "Food", amount: 28.1 },
      { category: "Shopping", amount: 35.17 },
    ],
  },
});

let totalInputTokens = 0;
let totalOutputTokens = 0;
const startedAt = performance.now();

for (const evalCase of cases) {
  const caseStartedAt = performance.now();
  const analysis = await analyzeTransactionWithOpenAI(credential, evalCase.input, { reasoningEffort: requestedEffort });
  assertSchema(evalCase.id, analysis.output);
  const result = normalizeTransactionAiDraft(analysis.output, categories);
  assertExpected(evalCase.id, result, evalCase.expected);
  totalInputTokens += analysis.usage?.input_tokens || 0;
  totalOutputTokens += analysis.usage?.output_tokens || 0;
  console.log(`AI live eval passed: ${evalCase.id} (${Math.round(performance.now() - caseStartedAt)} ms)`);
}

console.log(JSON.stringify({
  model: TRANSACTION_AI_MODEL,
  reasoningEffort: requestedEffort,
  cases: cases.length,
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  durationMs: Math.round(performance.now() - startedAt),
}));

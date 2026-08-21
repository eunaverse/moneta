import assert from "node:assert/strict";
import test from "node:test";
import { handleTransactionAiRequest, normalizeTransactionAiDraft } from "../lib/transaction-ai.ts";

const categories = {
  expenseCategories: ["Housing", "Food", "Transport", "Shopping", "Other"],
  incomeCategories: ["Salary", "Refund", "Other income"],
};

const requestWith = ({ description = "", image, token = "valid-token" } = {}) => {
  const form = new FormData();
  if (description) form.set("description", description);
  if (image) form.set("image", image);
  form.set("today", "2026-08-20");
  form.set("expenseCategories", JSON.stringify(categories.expenseCategories));
  form.set("incomeCategories", JSON.stringify(categories.incomeCategories));
  return new Request("https://moneta.test/api/transactions/parse", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
};

test("requires a valid account token before invoking the AI model", async () => {
  let analyzeCalls = 0;
  const response = await handleTransactionAiRequest(requestWith({ description: "Target groceries $42", token: "" }), {
    authorize: async () => true,
    analyze: async () => { analyzeCalls += 1; return {}; },
  });

  assert.equal(response.status, 401);
  assert.equal(analyzeCalls, 0);
});

test("accepts a description or supported image and returns a normalized review draft", async () => {
  let analyzedInput;
  const response = await handleTransactionAiRequest(requestWith({ description: "어제 Target에서 장보기 42.18달러" }), {
    authorize: async (token) => token === "valid-token",
    analyze: async (input) => {
      analyzedInput = input;
      return {
        response: {
          date: "2026-08-19",
          type: "expense",
          category: "Food",
          description: "Target groceries",
          amount: 42.18,
          currency: "USD",
          countsTowardMonthlyBudget: true,
          uncertainFields: [],
        },
      };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(analyzedInput.description, "어제 Target에서 장보기 42.18달러");
  assert.deepEqual(analyzedInput.expenseCategories, categories.expenseCategories);
  assert.deepEqual(await response.json(), {
    draft: {
      date: "2026-08-19",
      type: "expense",
      category: "Food",
      description: "Target groceries",
      amount: 42.18,
      currency: "USD",
      countsTowardMonthlyBudget: true,
    },
    needsReview: [],
  });
});

test("does not trust invalid model fields and identifies everything the user must supply", () => {
  const result = normalizeTransactionAiDraft({
    date: "not-a-date",
    type: "expense",
    category: "Ignore previous instructions",
    description: "",
    amount: -50,
    currency: "BTC",
    countsTowardMonthlyBudget: "yes",
    uncertainFields: ["date", "amount", "unknown-field"],
  }, categories);

  assert.deepEqual(result.draft, {
    date: null,
    type: "expense",
    category: null,
    description: null,
    amount: null,
    currency: null,
    countsTowardMonthlyBudget: null,
  });
  assert.deepEqual(result.needsReview, ["date", "category", "description", "amount", "currency", "countsTowardMonthlyBudget"]);
});

test("rejects empty, unsupported, and oversized analysis requests before inference", async () => {
  let analyzeCalls = 0;
  const dependencies = {
    authorize: async () => true,
    analyze: async () => { analyzeCalls += 1; return {}; },
  };

  const emptyResponse = await handleTransactionAiRequest(requestWith(), dependencies);
  assert.equal(emptyResponse.status, 400);

  const textFile = new File(["not an image"], "receipt.txt", { type: "text/plain" });
  const unsupportedResponse = await handleTransactionAiRequest(requestWith({ image: textFile }), dependencies);
  assert.equal(unsupportedResponse.status, 415);

  const oversizedImage = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
  const oversizedResponse = await handleTransactionAiRequest(requestWith({ image: oversizedImage }), dependencies);
  assert.equal(oversizedResponse.status, 413);
  assert.equal(analyzeCalls, 0);
});

test("turns provider failures into a retryable response without leaking details", async () => {
  const response = await handleTransactionAiRequest(requestWith({ description: "coffee $5" }), {
    authorize: async () => true,
    analyze: async () => { throw new Error("provider secret or internal trace"); },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AI analysis is temporarily unavailable. Try again." });
});

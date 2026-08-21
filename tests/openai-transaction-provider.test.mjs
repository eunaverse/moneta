import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTransactionWithOpenAI,
  buildOpenAiTransactionRequest,
  TRANSACTION_AI_MODEL,
} from "../lib/transaction-ai.ts";

const input = {
  description: "어제 Target에서 장보기 42.18달러",
  today: "2026-08-20",
  expenseCategories: ["Food", "Shopping", "Other"],
  incomeCategories: ["Salary", "Refund", "Other income"],
};

test("builds a low-cost GPT-5.6 Luna request with strict structured output", () => {
  const request = buildOpenAiTransactionRequest(input, "none");

  assert.equal(TRANSACTION_AI_MODEL, "gpt-5.6-luna");
  assert.equal(request.model, "gpt-5.6-luna");
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal("uniqueItems" in request.text.format.schema.properties.uncertainFields, false);
  assert.match(request.input[0].content[0].text, /Target/);
});

test("sends receipt images at original detail for small-text extraction", () => {
  const request = buildOpenAiTransactionRequest({
    ...input,
    imageDataUrl: "data:image/png;base64,c3ludGhldGljLXJlY2VpcHQ=",
  }, "low");

  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.deepEqual(request.input[0].content[1], {
    type: "input_image",
    image_url: "data:image/png;base64,c3ludGhldGljLXJlY2VpcHQ=",
    detail: "original",
  });
});

test("calls the Responses API server-side and returns output plus usage", async () => {
  let capturedUrl;
  let capturedInit;
  const result = await analyzeTransactionWithOpenAI("server-secret", input, {
    fetch: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        model: "gpt-5.6-luna",
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              date: "2026-08-19",
              type: "expense",
              category: "Food",
              description: "Target groceries",
              amount: 42.18,
              currency: "USD",
              countsTowardMonthlyBudget: true,
              uncertainFields: [],
            }),
          }],
        }],
        usage: { input_tokens: 125, output_tokens: 45, total_tokens: 170 },
      });
    },
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedInit.headers.Authorization, "Bearer server-secret");
  assert.equal(JSON.parse(capturedInit.body).model, "gpt-5.6-luna");
  assert.match(result.output, /Target groceries/);
  assert.deepEqual(result.usage, { input_tokens: 125, output_tokens: 45, total_tokens: 170 });
});

test("rejects provider errors and refusals without leaking their body", async () => {
  await assert.rejects(
    analyzeTransactionWithOpenAI("server-secret", input, {
      fetch: async () => Response.json({ error: { code: "rate_limit_exceeded", message: "sensitive provider detail" } }, { status: 429 }),
    }),
    (error) => {
      assert.match(error.message, /OpenAI transaction analysis failed \(429: rate_limit_exceeded\)/);
      assert.doesNotMatch(error.message, /sensitive provider detail/);
      return true;
    },
  );

  await assert.rejects(
    analyzeTransactionWithOpenAI("server-secret", input, {
      fetch: async () => Response.json({
        output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot process" }] }],
      }),
    }),
    /did not return a transaction draft/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlanningCapacity } from "../lib/budget-calculations.ts";

test("reserves every unpaid scheduled occurrence through each end month", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 12_000,
    startMonth: "2026-08",
    planningMonths: 12,
    recurringExpenses: [
      {
        id: "rent",
        name: "Temporary rent",
        category: "Housing",
        amount: 1_000,
        intervalMonths: 1,
        startMonth: "2026-08",
        endMonth: "2027-01",
        paidMonths: ["2026-09"],
      },
      {
        id: "tuition",
        name: "Tuition deposit",
        category: "Tuition",
        amount: 1_200,
        intervalMonths: 0,
        startMonth: "2026-11",
        paidMonths: [],
      },
    ],
  });

  assert.deepEqual(result.scheduledPayments[0].months, ["2026-08", "2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.equal(result.scheduledPayments[0].total, 5_000);
  assert.equal(result.scheduledTotal, 6_200);
  assert.equal(result.remainingAfterScheduled, 5_800);
  assert.ok(Math.abs(result.suggestedMonthlySpending - 483.3333333333333) < Number.EPSILON);
});

test("excludes payments outside the forecast and never suggests negative spending", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 500,
    startMonth: "2026-08",
    planningMonths: 3,
    recurringExpenses: [
      { id: "inside", name: "Inside", category: "Other", amount: 300, intervalMonths: 1, startMonth: "2026-08", endMonth: "2026-10", paidMonths: [] },
      { id: "outside", name: "Outside", category: "Other", amount: 5_000, intervalMonths: 0, startMonth: "2026-11", paidMonths: [] },
    ],
  });

  assert.equal(result.scheduledTotal, 900);
  assert.equal(result.remainingAfterScheduled, -400);
  assert.equal(result.suggestedMonthlySpending, 0);
  assert.equal(result.plannedOccurrences.some((item) => item.expenseId === "outside"), false);
});

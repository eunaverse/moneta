import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlanningCapacity } from "../lib/budget-calculations.ts";

test("reserves every unpaid scheduled occurrence through each end month", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 12_000,
    startMonth: "2026-08",
    endMonth: "2027-07",
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
    endMonth: "2026-10",
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

test("keeps a fixed end month so the divisor drops from 24 to 23 to 22", () => {
  const endMonth = "2028-07";
  const august = calculatePlanningCapacity({ currentNetWorth: 48_000, recurringExpenses: [], startMonth: "2026-08", endMonth });
  const september = calculatePlanningCapacity({ currentNetWorth: 46_000, recurringExpenses: [], startMonth: "2026-09", endMonth });
  const october = calculatePlanningCapacity({ currentNetWorth: 44_000, recurringExpenses: [], startMonth: "2026-10", endMonth });

  assert.equal(august.remainingMonths, 24);
  assert.equal(september.remainingMonths, 23);
  assert.equal(october.remainingMonths, 22);
  assert.equal(august.forecastMonthKeys.at(-1), endMonth);
  assert.equal(september.forecastMonthKeys.at(-1), endMonth);
  assert.equal(october.forecastMonthKeys.at(-1), endMonth);
  assert.equal(august.suggestedMonthlySpending, 2_000);
  assert.equal(september.suggestedMonthlySpending, 2_000);
  assert.equal(october.suggestedMonthlySpending, 2_000);
});

test("returns no monthly suggestion after the fixed plan has ended", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 10_000,
    recurringExpenses: [],
    startMonth: "2028-08",
    endMonth: "2028-07",
  });

  assert.equal(result.remainingMonths, 0);
  assert.deepEqual(result.forecastMonthKeys, []);
  assert.equal(result.suggestedMonthlySpending, 0);
});

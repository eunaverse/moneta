import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlanningCapacity } from "../lib/budget-calculations.ts";

test("keeps overdue unpaid payments reserved after the calendar month advances", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 20_000,
    reservationStartMonth: "2026-08",
    startMonth: "2026-09",
    endMonth: "2026-09",
    recurringExpenses: [
      { id: "tuition", name: "Tuition", category: "Tuition", amount: 1_200, intervalMonths: 0, startMonth: "2026-08", paidMonths: [] },
      { id: "housing", name: "Housing", category: "Housing", amount: 850, intervalMonths: 1, startMonth: "2026-08", endMonth: "2026-09", paidMonths: [] },
    ],
  });

  assert.equal(result.remainingMonths, 1);
  assert.deepEqual(result.scheduledPayments[0].months, ["2026-08"]);
  assert.deepEqual(result.scheduledPayments[0].overdueMonths, ["2026-08"]);
  assert.deepEqual(result.scheduledPayments[1].months, ["2026-08", "2026-09"]);
  assert.deepEqual(result.scheduledPayments[1].overdueMonths, ["2026-08"]);
  assert.equal(result.scheduledTotal, 2_900);
  assert.equal(result.suggestedMonthlySpending, 17_100);
});

test("removes a past payment from reservations after it is marked paid", () => {
  const result = calculatePlanningCapacity({
    currentNetWorth: 18_800,
    reservationStartMonth: "2026-08",
    startMonth: "2026-09",
    endMonth: "2026-09",
    recurringExpenses: [
      { id: "tuition", name: "Tuition", category: "Tuition", amount: 1_200, intervalMonths: 0, startMonth: "2026-08", paidMonths: ["2026-08"] },
    ],
  });

  assert.equal(result.scheduledTotal, 0);
  assert.deepEqual(result.scheduledPayments, []);
  assert.deepEqual(result.plannedOccurrences, []);
});

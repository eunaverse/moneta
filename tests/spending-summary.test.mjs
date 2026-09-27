import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSpending, recommendBudgets } from '../lib/spending-summary.ts';

const entry = (overrides = {}) => ({ id: 'a', date: '2025-12-12', type: 'expense', amount: 100, currency: 'USD', category: 'Food', description: '', ...overrides });
const convert = ({ amount, currency }) => currency === 'KRW' ? amount / 1000 : currency === 'EUR' ? null : amount;

test('recommends previous calendar month category spending with allocations and currency conversion', () => {
  const entries = [entry(), entry({ amount: 30000, currency: 'KRW', allocations: [{ category: 'Food', amount: 10000 }, { category: 'Shopping', amount: 20000 }] }), entry({ type: 'income' }), entry({ plannedExpenseId: 'rent' }), entry({ countsTowardMonthlyBudget: false }), entry({ date: '2026-01-01' })];
  assert.deepEqual(recommendBudgets(entries, '2026-01', convert), { month: '2025-12', budgets: { Food: 110, Shopping: 20 }, missingRates: false });
  assert.deepEqual(recommendBudgets([], '2026-01', convert).budgets, {});
});

test('stacks actual linked scheduled payments and all other expenses without omitting excluded budgets', () => {
  const entries = [entry(), entry({ plannedExpenseId: 'rent', amount: 400 }), entry({ countsTowardMonthlyBudget: false, amount: 20 }), entry({ type: 'income', amount: 1000 }), entry({ date: '2026-01-01' })];
  assert.deepEqual(summarizeSpending(entries, '2025-12', convert), { scheduled: 400, flexible: 120, amount: 520 });
  assert.deepEqual(summarizeSpending([], '2025-12', convert), { scheduled: 0, flexible: 0, amount: 0 });
});

test('flags missing conversion rates rather than offering incomplete recommendations', () => {
  assert.equal(recommendBudgets([entry({ currency: 'EUR' })], '2026-01', convert).missingRates, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { allocateFifo, deriveBalance, fromCents, toCents } from "../lib/accounting";

test("money uses integer cents and rounds to two decimals", () => {
  assert.equal(toCents(12.345), 1235);
  assert.equal(fromCents(1235), 12.35);
  assert.throws(() => toCents(-1), /non-negative/);
});

test("payment allocates FIFO and never exceeds bill balances", () => {
  assert.deepEqual(allocateFifo(125, [{ id: "old", outstanding: 50 }, { id: "next", outstanding: 100 }]), [
    { billId: "old", amount: 50 }, { billId: "next", amount: 75 },
  ]);
});

test("excess payment remains as customer advance", () => {
  assert.deepEqual(allocateFifo(300, [{ id: "one", outstanding: 120 }, { id: "two", outstanding: 80 }]), [
    { billId: "one", amount: 120 }, { billId: "two", amount: 80 },
  ]);
  assert.deepEqual(deriveBalance([200, -300]), { net: -100, due: 0, advance: 100 });
});

test("opening due, bills, and payments reconcile to net due", () => {
  assert.deepEqual(deriveBalance([10000, 5000, 5000, -7000]), { net: 13000, due: 13000, advance: 0 });
});

test("exact settlement produces zero due and zero advance", () => {
  assert.deepEqual(deriveBalance([500, -200, -300]), { net: 0, due: 0, advance: 0 });
});

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

test("non-finite money values are rejected", () => {
  assert.throws(() => toCents(Number.NaN), /finite/);
  assert.throws(() => toCents(Number.POSITIVE_INFINITY), /finite/);
});

test("cent conversion preserves small positive and zero values", () => {
  assert.equal(toCents(0), 0);
  assert.equal(toCents(0.01), 1);
  assert.equal(fromCents(1), 0.01);
});

test("fromCents rejects non-integer and unsafe amounts", () => {
  assert.throws(() => fromCents(1.5), /integer-cent/);
  assert.throws(() => fromCents(Number.MAX_SAFE_INTEGER + 1), /integer-cent/);
});

test("FIFO skips settled and zero-value bills", () => {
  assert.deepEqual(allocateFifo(20, [
    { id: "settled", outstanding: 0 },
    { id: "older-settled", outstanding: 0 },
    { id: "open", outstanding: 20 },
  ]), [{ billId: "open", amount: 20 }]);
});

test("FIFO returns no allocation for a zero payment", () => {
  assert.deepEqual(allocateFifo(0, [{ id: "open", outstanding: 20 }]), []);
});

test("FIFO can settle several bills exactly", () => {
  assert.deepEqual(allocateFifo(60, [
    { id: "first", outstanding: 10 },
    { id: "second", outstanding: 20 },
    { id: "third", outstanding: 30 },
  ]), [
    { billId: "first", amount: 10 },
    { billId: "second", amount: 20 },
    { billId: "third", amount: 30 },
  ]);
});

test("FIFO payment that only partially covers the oldest bill stops there", () => {
  assert.deepEqual(allocateFifo(15, [
    { id: "oldest", outstanding: 100 },
    { id: "newer", outstanding: 60 },
  ]), [{ billId: "oldest", amount: 15 }]);
});

test("FIFO allocation preserves input order for same-date sorted bills", () => {
  const allocations = allocateFifo(50, [
    { id: "earlier", outstanding: 25 },
    { id: "later", outstanding: 25 },
    { id: "last", outstanding: 25 },
  ]);
  assert.deepEqual(allocations.map((entry) => entry.billId), ["earlier", "later"]);
  assert.equal(allocations.reduce((sum, entry) => sum + toCents(entry.amount), 0), toCents(50));
});

test("ledger balance separates receivable from customer credit", () => {
  assert.deepEqual(deriveBalance([100, -250]), { net: -150, due: 0, advance: 150 });
  assert.deepEqual(deriveBalance([400, -120]), { net: 280, due: 280, advance: 0 });
});

test("several partial payments reconcile to the same net balance", () => {
  assert.deepEqual(deriveBalance([1000, -100, -250, -150]), { net: 500, due: 500, advance: 0 });
});

test("customer can move from due to advance and back", () => {
  assert.deepEqual(deriveBalance([100, -150]), { net: -50, due: 0, advance: 50 });
  assert.deepEqual(deriveBalance([100, -150, 80]), { net: 30, due: 30, advance: 0 });
});

test("negative outstanding bill amount is rejected", () => {
  assert.throws(() => allocateFifo(10, [{ id: "invalid", outstanding: -1 }]), /non-negative/);
});

test("fractional penny amounts reconcile after rounding to cents", () => {
  assert.equal(toCents(5.555), 556);
  assert.equal(toCents(0.005), 1);
  assert.deepEqual(deriveBalance([0.1, 0.2, -0.3]), { net: 0, due: 0, advance: 0 });
});

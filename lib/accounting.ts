export type OpenBill = { id: string; outstanding: number };
export type Allocation = { billId: string; amount: number };

/** Converts an amount to integer cents after rejecting negative/non-finite values. */
export function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Amount must be a finite, non-negative number.");
  return Math.round((value + Number.EPSILON) * 100);
}

export function fromCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Expected an integer-cent amount.");
  return value / 100;
}

/** Allocates a credit against bills in the order supplied (oldest bill first). */
export function allocateFifo(amount: number, bills: OpenBill[]): Allocation[] {
  let remaining = toCents(amount);
  const allocations: Allocation[] = [];
  for (const bill of bills) {
    const outstanding = toCents(bill.outstanding);
    if (outstanding === 0 || remaining === 0) continue;
    const allocated = Math.min(remaining, outstanding);
    allocations.push({ billId: bill.id, amount: fromCents(allocated) });
    remaining -= allocated;
  }
  return allocations;
}

/** Positive movements mean customer owes us; negative movements are credits/advances. */
export function deriveBalance(signedMovements: number[]): { net: number; due: number; advance: number } {
  const netCents = signedMovements.reduce((sum, movement) => {
    const signedCents = Math.round(movement * 100);
    if (!Number.isFinite(movement) || !Number.isSafeInteger(signedCents)) throw new Error("Invalid ledger movement.");
    return sum + signedCents;
  }, 0);
  return { net: fromCents(netCents), due: fromCents(Math.max(netCents, 0)), advance: fromCents(Math.max(-netCents, 0)) };
}

export function formatBDT(amount: number): string {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

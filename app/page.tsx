"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { formatBDT } from "@/lib/accounting";
import { getSupabaseClient } from "@/lib/supabase";

type CustomerSummary = {
  customer_id: string;
  customer_name: string;
  phone: string | null;
  address: string | null;
  net_balance: number;
  due_balance: number;
  advance_balance: number;
  bill_count: number;
};
type StaffMember = { display_name: string; role: "admin" | "accountant" | "operator"; active: boolean };
type BillRow = {
  id: string;
  customer_id: string;
  bill_number: string;
  bill_date: string;
  description: string;
  amount: number;
  is_opening_balance: boolean;
  allocated_amount: number;
  outstanding_amount: number;
  created_at: string;
};
type PaymentRow = {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference: string | null;
  created_at: string;
};
type LedgerRow = {
  id: string;
  entry_type: string;
  amount_signed: number;
  notes: string | null;
  balance_after: number;
  created_at: string;
};
type Notice = { type: "success" | "error" | "warning"; message: string };

function localDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function operationKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "An unexpected error occurred. Please try again.";
}
function methodLabel(method: string): string {
  return ({ cash: "Cash", bank_transfer: "Bank transfer", mobile_banking: "Mobile banking", other: "Other" } as Record<string, string>)[method] ?? method;
}

export default function HomePage() {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [bills, setBills] = useState<BillRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerRow[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [printBill, setPrintBill] = useState<BillRow | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [openingDue, setOpeningDue] = useState("0");
  const [openingAdvance, setOpeningAdvance] = useState("0");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(localDate());
  const [billDescription, setBillDescription] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDate());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");

  const selectedCustomer = customers.find((customer) => customer.customer_id === selectedId) ?? null;
  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) =>
      [customer.customer_name, customer.phone ?? "", customer.address ?? ""].some((value) => value.toLowerCase().includes(term))
    );
  }, [customers, search]);
  const totals = useMemo(() => customers.reduce((result, customer) => ({
    due: result.due + Number(customer.due_balance || 0),
    advance: result.advance + Number(customer.advance_balance || 0),
  }), { due: 0, advance: 0 }), [customers]);

  useEffect(() => {
    if (!client) {
      setAuthReady(true);
      setAccessChecked(true);
      return;
    }
    let mounted = true;
    client.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    }).catch(() => {
      if (mounted) setAuthReady(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setStaff(null);
      setAccessChecked(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  async function reloadCustomers(preferredId?: string) {
    if (!client) return;
    const { data, error } = await client.from("customer_balance_summary").select("*").order("customer_name");
    if (error) throw error;
    const rows = (data ?? []) as CustomerSummary[];
    setCustomers(rows);
    const target = preferredId ?? selectedId;
    if (target && rows.some((row) => row.customer_id === target)) setSelectedId(target);
    else if (rows.length > 0) setSelectedId(rows[0].customer_id);
    else setSelectedId("");
  }

  async function reloadCustomerDetails(customerId: string) {
    if (!client || !customerId) {
      setBills([]);
      setPayments([]);
      setLedgerEntries([]);
      return;
    }
    const [billResult, paymentResult, ledgerResult] = await Promise.all([
      client.from("bill_balance_summary").select("*").eq("customer_id", customerId).order("bill_date", { ascending: false }).order("created_at", { ascending: false }),
      client.from("payments").select("id, amount, payment_date, method, reference, created_at").eq("customer_id", customerId).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(25),
      client.from("customer_ledger_statement").select("id, entry_type, amount_signed, notes, balance_after, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (billResult.error) throw billResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (ledgerResult.error) throw ledgerResult.error;
    setBills((billResult.data ?? []) as BillRow[]);
    setPayments((paymentResult.data ?? []) as PaymentRow[]);
    setLedgerEntries((ledgerResult.data ?? []) as LedgerRow[]);
  }

  useEffect(() => {
    if (!client || !session) {
      setStaff(null);
      setAccessChecked(true);
      setCustomers([]);
      setBills([]);
      setPayments([]);
      setLedgerEntries([]);
      return;
    }
    let mounted = true;
    setAccessChecked(false);
    (async () => {
      try {
        const { data, error } = await client.from("staff_members").select("display_name, role, active").eq("user_id", session.user.id).maybeSingle();
        if (error) throw error;
        if (!mounted) return;
        if (!data || !data.active) {
          setStaff(null);
          setNotice({ type: "warning", message: "This login does not have active BTNT staff access. Ask an administrator to add or activate your user in the staff_members table." });
          setAccessChecked(true);
          return;
        }
        setStaff(data as StaffMember);
        const { data: summary, error: summaryError } = await client.from("customer_balance_summary").select("*").order("customer_name");
        if (summaryError) throw summaryError;
        if (!mounted) return;
        const rows = (summary ?? []) as CustomerSummary[];
        setCustomers(rows);
        setSelectedId((current) => current && rows.some((row) => row.customer_id === current) ? current : (rows[0]?.customer_id ?? ""));
        setNotice(null);
      } catch (error) {
        if (mounted) setNotice({ type: "error", message: errorText(error) });
      } finally {
        if (mounted) setAccessChecked(true);
      }
    })();
    return () => { mounted = false; };
  }, [client, session]);

  useEffect(() => {
    if (!staff || !selectedId) {
      setBills([]);
      setPayments([]);
      setLedgerEntries([]);
      return;
    }
    let mounted = true;
    setDataBusy(true);
    reloadCustomerDetails(selectedId).catch((error) => {
      if (mounted) setNotice({ type: "error", message: errorText(error) });
    }).finally(() => {
      if (mounted) setDataBusy(false);
    });
    return () => { mounted = false; };
  }, [staff, selectedId, client]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setFormBusy(true);
    setNotice(null);
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleSignOut() {
    if (!client) return;
    await client.auth.signOut();
    setSession(null);
    setStaff(null);
    setNotice(null);
  }

  function shareBillWhatsApp(bill: BillRow) {
    if (!selectedCustomer) return;
    const details = [
      "Bangladesh Tours & Travels",
      "Travel bill: " + bill.bill_number,
      "Customer: " + selectedCustomer.customer_name,
      "Date: " + bill.bill_date,
      "Details: " + bill.description,
      "Invoice total: " + formatBDT(bill.amount),
      "Paid / allocated: " + formatBDT(bill.allocated_amount),
      "Outstanding: " + formatBDT(bill.outstanding_amount),
      "",
      "The PDF invoice can be attached to this message before sending."
    ].join("\n");
    const rawPhone = (selectedCustomer.phone ?? "").trim();
    const phoneDigits = rawPhone.replace(/\D/g, "");
    const isInternationalNumber = rawPhone.startsWith("+") && phoneDigits.length >= 8;
    const recipient = isInternationalNumber ? phoneDigits : "";
    const url = recipient
      ? `https://wa.me/${recipient}?text=${encodeURIComponent(details)}`
      : `https://wa.me/?text=${encodeURIComponent(details)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setNotice({ type: "warning", message: "WhatsApp opened with the bill summary. To send the actual PDF too, choose Print / PDF → Save as PDF first, then attach that saved file in WhatsApp." });
  }

  async function handleAddCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setFormBusy(true);
    setNotice(null);
    try {
      const due = Number(openingDue || "0");
      const advance = Number(openingAdvance || "0");
      if (!Number.isFinite(due) || !Number.isFinite(advance) || due < 0 || advance < 0) throw new Error("Opening due and advance must be zero or a positive amount.");
      const { data, error } = await client.rpc("create_customer", {
        p_name: customerName.trim(),
        p_phone: customerPhone.trim() || null,
        p_address: customerAddress.trim() || null,
        p_opening_due: due,
        p_opening_advance: advance,
        p_operation_key: operationKey(),
      });
      if (error) throw error;
      const id = String(data);
      await reloadCustomers(id);
      setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
      setOpeningDue("0"); setOpeningAdvance("0");
      setNotice({ type: "success", message: "Customer saved. Opening balances were recorded in the ledger." });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleCreateBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !selectedCustomer) return;
    setFormBusy(true);
    setNotice(null);
    try {
      const { data, error } = await client.rpc("create_bill", {
        p_customer_id: selectedCustomer.customer_id,
        p_bill_number: billNumber.trim(),
        p_bill_date: billDate,
        p_description: billDescription.trim(),
        p_amount: Number(billAmount),
        p_operation_key: operationKey(),
      });
      if (error) throw error;
      await reloadCustomers(selectedCustomer.customer_id);
      await reloadCustomerDetails(selectedCustomer.customer_id);
      setBillNumber(""); setBillDescription(""); setBillAmount("");
      setNotice({ type: "success", message: `Bill saved (${String(data).slice(0, 8)}). Any available advance was applied automatically.` });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !selectedCustomer) return;
    setFormBusy(true);
    setNotice(null);
    try {
      const { error } = await client.rpc("create_payment", {
        p_customer_id: selectedCustomer.customer_id,
        p_amount: Number(paymentAmount),
        p_payment_date: paymentDate,
        p_method: paymentMethod,
        p_reference: paymentReference.trim() || null,
        p_operation_key: operationKey(),
      });
      if (error) throw error;
      await reloadCustomers(selectedCustomer.customer_id);
      await reloadCustomerDetails(selectedCustomer.customer_id);
      setPaymentAmount(""); setPaymentReference("");
      setNotice({ type: "success", message: "Payment recorded and allocated FIFO to the oldest open bills. Any extra remains as customer advance." });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
  }

  function printInvoice(bill: BillRow) {
    setPrintBill(bill);
    window.setTimeout(() => window.print(), 100);
  }

  if (!authReady || (session && !accessChecked)) {
    return <main className="loading-screen">Opening BTNT Bill Book…</main>;
  }

  if (!client) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <div className="brand-mark">BT</div>
          <p className="eyebrow">Setup required</p>
          <h2>Connect your Supabase project</h2>
          <p>Add the project URL and anon/publishable key to the deployment environment variables. Never expose a service-role key in browser code.</p>
          <div className="notice warning">Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. No database changes have been made by this screen.</div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <div className="brand">
            <div className="brand-mark">BT</div>
            <div><h1>BTNT Bill Book</h1><p>Bangladesh Tours &amp; Travels</p></div>
          </div>
          <p className="eyebrow" style={{ marginTop: 26 }}>Secure staff sign-in</p>
          <h2>Manage accounts clearly.</h2>
          <p>Sign in using an invited BTNT staff account. New public sign-ups are intentionally not offered from this application.</p>
          {notice && <div className={`notice ${notice.type === "error" ? "error" : notice.type === "warning" ? "warning" : ""}`}>{notice.message}</div>}
          <form onSubmit={handleSignIn}>
            <div className="form-grid">
              <div className="field full"><label htmlFor="login-email">Email address</label><input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
              <div className="field full"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            </div>
            <button className="btn primary full-width" disabled={formBusy} type="submit">{formBusy ? "Signing in…" : "Sign in securely →"}</button>
          </form>
          <p className="footer-note">Financial writes use database transactions and staff-only RPCs.</p>
        </section>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <div className="brand"><div className="brand-mark">BT</div><div><h1>BTNT Bill Book</h1><p>Staff access check</p></div></div>
          <h2>Access not enabled</h2>
          <p>Your login is valid, but it is not registered as active BTNT staff in the accounting database.</p>
          {notice && <div className={`notice ${notice.type === "error" ? "error" : "warning"}`}>{notice.message}</div>}
          <button className="btn secondary full-width" onClick={handleSignOut}>Sign out</button>
          <p className="footer-note">An administrator must invite the user and add an active row to public.staff_members.</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">BT</div>
            <div><h1>BTNT Bill Book</h1><p>Bangladesh Tours &amp; Travels · Accounts</p></div>
          </div>
          <div className="top-actions">
            <span className="staff-label" style={{ color: "var(--muted)", fontSize: 12 }}>{staff.display_name} · {staff.role}</span>
            <button className="btn ghost small" onClick={handleSignOut}>Sign out</button>
          </div>
        </header>

        <main className="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Accounts overview</p>
              <h2>Know every balance.<br />Keep every transaction clear.</h2>
              <p>Customer opening balances, travel bills, payments and advances — reconciled through the ledger.</p>
            </div>
          </div>

          {notice && <div className={`notice ${notice.type === "error" ? "error" : notice.type === "warning" ? "warning" : ""}`} role="status">{notice.message}</div>}

          <section className="stats-grid" aria-label="Account totals">
            <div className="stat-card"><span className="stat-label">Customer receivables</span><strong className="stat-value">{formatBDT(totals.due)}</strong><div className="stat-foot">Total positive balances due from customers</div></div>
            <div className="stat-card"><span className="stat-label">Customer advances</span><strong className="stat-value">{formatBDT(totals.advance)}</strong><div className="stat-foot">Credit balances after invoice allocations</div></div>
            <div className="stat-card"><span className="stat-label">Active customer records</span><strong className="stat-value">{customers.length.toLocaleString("en-IN")}</strong><div className="stat-foot">Balances calculated from signed ledger entries</div></div>
          </section>

          <section className="content-grid">
            <div>
              <section className="panel">
                <div className="panel-head"><div><h3>Add a customer</h3><p>Opening due and opening advance are tracked separately.</p></div></div>
                <form onSubmit={handleAddCustomer}>
                  <div className="form-grid">
                    <div className="field full"><label htmlFor="customer-name">Customer name *</label><input id="customer-name" required maxLength={160} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="e.g. Banik" /></div>
                    <div className="field full"><label htmlFor="customer-phone">Mobile / WhatsApp</label><input id="customer-phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="+880…" /></div>
                    <div className="field full"><label htmlFor="customer-address">Address</label><textarea id="customer-address" rows={2} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} placeholder="Customer address" /></div>
                    <div className="field"><label htmlFor="opening-due">Opening due (৳)</label><input id="opening-due" type="number" min="0" step="0.01" value={openingDue} onChange={(event) => setOpeningDue(event.target.value)} /></div>
                    <div className="field"><label htmlFor="opening-advance">Opening advance (৳)</label><input id="opening-advance" type="number" min="0" step="0.01" value={openingAdvance} onChange={(event) => setOpeningAdvance(event.target.value)} /></div>
                  </div>
                  <button className="btn primary full-width" type="submit" disabled={formBusy}>{formBusy ? "Saving…" : "＋ Save customer"}</button>
                </form>
              </section>

              <section className="panel">
                <div className="panel-head"><div><h3>Customers</h3><p>Select a customer to view their account.</p></div><span className="pill">{customers.length}</span></div>
                <input className="search-input" aria-label="Search customers" placeholder="Search name, phone or address…" value={search} onChange={(event) => setSearch(event.target.value)} />
                <div className="customer-list" style={{ marginTop: 13 }}>
                  {filteredCustomers.length === 0 ? <div className="empty-state">{customers.length === 0 ? "No customers yet. Add the first customer above." : "No customers matched that search."}</div> : filteredCustomers.map((customer) => (
                    <button type="button" key={customer.customer_id} className={`customer-row ${selectedId === customer.customer_id ? "active" : ""}`} onClick={() => setSelectedId(customer.customer_id)}>
                      <span><span className="customer-name">{customer.customer_name}</span><span className="customer-sub">{customer.phone || "No phone"} · {customer.bill_count} bills</span></span>
                      <span className="customer-money">{formatBDT(customer.due_balance > 0 ? customer.due_balance : customer.advance_balance)}<small>{customer.due_balance > 0 ? "DUE" : customer.advance_balance > 0 ? "ADVANCE" : "SETTLED"}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div>
              <section className="panel">
                {!selectedCustomer ? (
                  <div className="empty-state">Choose a customer to create bills and record payments.</div>
                ) : (
                  <>
                    <div className="detail-heading">
                      <div><p className="eyebrow">Customer account</p><h3>{selectedCustomer.customer_name}</h3><p>{selectedCustomer.phone || "No phone recorded"}{selectedCustomer.address ? `\n${selectedCustomer.address}` : ""}</p></div>
                      <button className="btn secondary small" onClick={() => { setBillDate(localDate()); setPaymentDate(localDate()); }}>Today</button>
                    </div>
                    <div className="balance-pills">
                      <span className={`pill ${selectedCustomer.due_balance > 0 ? "due" : ""}`}>Due {formatBDT(selectedCustomer.due_balance)}</span>
                      <span className={`pill ${selectedCustomer.advance_balance > 0 ? "advance" : ""}`}>Advance {formatBDT(selectedCustomer.advance_balance)}</span>
                      <span className="pill">Net {formatBDT(selectedCustomer.net_balance)}</span>
                    </div>

                    <div className="section-title">Create a travel bill</div>
                    <form onSubmit={handleCreateBill}>
                      <div className="form-grid">
                        <div className="field"><label htmlFor="bill-number">Bill / invoice number *</label><input id="bill-number" required maxLength={80} value={billNumber} onChange={(event) => setBillNumber(event.target.value)} placeholder="e.g. BTNT-1001" /></div>
                        <div className="field"><label htmlFor="bill-date">Bill date *</label><input id="bill-date" required type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} /></div>
                        <div className="field full"><label htmlFor="bill-description">Ticket / trip details *</label><input id="bill-description" required maxLength={2000} value={billDescription} onChange={(event) => setBillDescription(event.target.value)} placeholder="e.g. Kolkata–Dhaka, 2 tickets" /></div>
                        <div className="field"><label htmlFor="bill-amount">Total amount (৳) *</label><input id="bill-amount" type="number" min="0.01" step="0.01" required value={billAmount} onChange={(event) => setBillAmount(event.target.value)} placeholder="5000.00" /></div>
                      </div>
                      <button className="btn primary full-width" type="submit" disabled={formBusy}>＋ Save bill</button>
                    </form>

                    <div className="section-title">Record a payment</div>
                    <form onSubmit={handleCreatePayment}>
                      <div className="form-grid">
                        <div className="field"><label htmlFor="payment-amount">Amount received (৳) *</label><input id="payment-amount" type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="2000.00" /></div>
                        <div className="field"><label htmlFor="payment-date">Payment date *</label><input id="payment-date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div>
                        <div className="field"><label htmlFor="payment-method">Payment method</label><select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="mobile_banking">Mobile banking</option><option value="other">Other</option></select></div>
                        <div className="field"><label htmlFor="payment-reference">Reference / note</label><input id="payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Optional transaction ID" /></div>
                      </div>
                      <button className="btn secondary full-width" type="submit" disabled={formBusy}>↓ Record payment</button>
                    </form>
                  </>
                )}
              </section>

              {selectedCustomer && <section className="panel">
                <div className="panel-head"><div><h3>Bills &amp; outstanding balances</h3><p>Payments are allocated to the oldest open bill first.</p></div><span className="pill">{bills.length} rows</span></div>
                {dataBusy ? <div className="empty-state">Refreshing account…</div> : bills.length === 0 ? <div className="empty-state">No bills recorded for this customer yet.</div> : (
                  <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Date / details</th><th className="numeric">Amount</th><th className="numeric">Due</th><th>Action</th></tr></thead><tbody>
                    {bills.map((bill) => <tr key={bill.id}>
                      <td><strong>{bill.bill_number}</strong>{bill.is_opening_balance && <div className="small-muted">Opening balance</div>}</td>
                      <td>{bill.bill_date}<div className="small-muted">{bill.description}</div></td>
                      <td className="numeric">{formatBDT(bill.amount)}</td>
                      <td className="numeric"><strong>{formatBDT(bill.outstanding_amount)}</strong><div className="small-muted">Paid {formatBDT(bill.allocated_amount)}</div></td>
                      <td><button className="btn ghost small" type="button" onClick={() => printInvoice(bill)}>Print / PDF</button></td>
                    </tr>)}
                  </tbody></table></div>
                )}
                <div className="section-title">Recent payments</div>
                {payments.length === 0 ? <div className="empty-state">No payments recorded yet.</div> : (
                  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Method / reference</th><th className="numeric">Received</th></tr></thead><tbody>
                    {payments.map((payment) => <tr key={payment.id}><td>{payment.payment_date}</td><td><strong>{methodLabel(payment.method)}</strong><div className="small-muted">{payment.reference || "—"}</div></td><td className="numeric"><strong>{formatBDT(payment.amount)}</strong></td></tr>)}
                  </tbody></table></div>
                )}
                <div className="section-title">Customer ledger statement</div>
                <p className="small-muted" style={{ marginBottom: 12 }}>Positive entries increase due; negative entries are credits. Running balance is calculated chronologically.</p>
                {ledgerEntries.length === 0 ? <div className="empty-state">Ledger entries will appear here when an opening balance, bill, payment, or adjustment is recorded.</div> : (
                  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Entry / details</th><th className="numeric">Due (+)</th><th className="numeric">Credit (−)</th><th className="numeric">Running balance</th></tr></thead><tbody>
                    {ledgerEntries.map((entry) => <tr key={entry.id}>
                      <td>{new Date(entry.created_at).toLocaleDateString("en-IN")}</td>
                      <td><strong>{({ opening_due: "Opening due", opening_advance: "Opening advance", bill: "Bill", payment: "Payment", adjustment: "Adjustment" } as Record<string, string>)[entry.entry_type] ?? entry.entry_type}</strong><div className="small-muted">{entry.notes || "—"}</div></td>
                      <td className="numeric">{entry.amount_signed > 0 ? formatBDT(entry.amount_signed) : "—"}</td>
                      <td className="numeric">{entry.amount_signed < 0 ? formatBDT(Math.abs(entry.amount_signed)) : "—"}</td>
                      <td className="numeric"><strong>{entry.balance_after < 0 ? `Adv. ${formatBDT(Math.abs(entry.balance_after))}` : formatBDT(entry.balance_after)}</strong></td>
                    </tr>)}
                  </tbody></table></div>
                )}
              </section>}
            </div>
          </section>
          <p className="footer-note">BTNT Bill Book · Ledger-derived balances · Bills and payments are write-protected outside database RPCs.</p>
        </main>
      </div>

      {printBill && selectedCustomer && (
        <div className="print-sheet">
          <h1>Bangladesh Tours &amp; Travels</h1>
          <div>TRAVEL BILL / CUSTOMER COPY</div>
          <h2>{printBill.bill_number}</h2>
          <div className="print-meta">
            <div><strong>Bill to</strong><br />{selectedCustomer.customer_name}<br />{selectedCustomer.phone || ""}<br />{selectedCustomer.address || ""}</div>
            <div><strong>Invoice date</strong><br />{printBill.bill_date}<br /><strong>Status</strong><br />{printBill.outstanding_amount <= 0 ? "Paid / settled" : "Balance outstanding"}</div>
          </div>
          <table><thead><tr><th>Particulars</th><th>Bill date</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead><tbody><tr><td>{printBill.description}</td><td>{printBill.bill_date}</td><td style={{ textAlign: "right" }}>{formatBDT(printBill.amount)}</td></tr></tbody></table>
          <div className="print-total">Invoice total: {formatBDT(printBill.amount)}</div>
          <p>Paid / allocated: {formatBDT(printBill.allocated_amount)}</p>
          <p>Outstanding: {formatBDT(printBill.outstanding_amount)}</p>
          <p style={{ marginTop: 70 }}>Thank you for travelling with us.</p>
          <p>Authorised signature: _________________________</p>
        </div>
      )}
    </>
  );
}

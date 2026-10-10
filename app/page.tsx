"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  entry_date: string;
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
  const [authReady, setAuthReady] = useState(!client);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [accessChecked, setAccessChecked] = useState(!client);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [bills, setBills] = useState<BillRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerRow[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [search, setSearch] = useState("");
  const operationKeys = useRef<Record<string, string>>({});

  function fingerprintToken(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function submissionKey(scope: string, fingerprint: string): string {
    const cacheKey = scope + ":" + fingerprint;
    if (operationKeys.current[cacheKey]) return operationKeys.current[cacheKey];

    const storageKey = "btnt-operation-key:" + scope + ":" + fingerprintToken(fingerprint);
    let savedKey: string | null = null;
    try {
      savedKey = window.sessionStorage.getItem(storageKey);
    } catch {
      // Storage may be disabled; the in-memory key still protects retries in this tab.
    }
    const key = savedKey || operationKey();
    operationKeys.current[cacheKey] = key;
    try {
      if (!savedKey) window.sessionStorage.setItem(storageKey, key);
    } catch {
      // The API remains protected for this render by the in-memory key.
    }
    return key;
  }

  function clearSubmissionKey(scope: string, fingerprint: string) {
    const cacheKey = scope + ":" + fingerprint;
    delete operationKeys.current[cacheKey];
    try {
      window.sessionStorage.removeItem("btnt-operation-key:" + scope + ":" + fingerprintToken(fingerprint));
    } catch {
      // A completed request remains safe: the database rejects duplicate operation keys.
    }
  }

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
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");

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
    if (!client) return;
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
      setAccessChecked(!nextSession);
      if (!nextSession) {
        setCustomers([]);
        setBills([]);
        setPayments([]);
        setLedgerEntries([]);
      }
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

  const reloadCustomerDetails = useCallback(async (customerId: string) => {
    if (!client || !customerId) return;
    const [billResult, paymentResult, ledgerResult] = await Promise.all([
      client.from("bill_balance_summary").select("*").eq("customer_id", customerId).order("bill_date", { ascending: false }).order("created_at", { ascending: false }),
      client.from("payments").select("id, amount, payment_date, method, reference, created_at").eq("customer_id", customerId).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(25),
      client.from("customer_ledger_statement").select("id, entry_type, entry_date, amount_signed, notes, balance_after, created_at").eq("customer_id", customerId).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    ]);
    if (billResult.error) throw billResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (ledgerResult.error) throw ledgerResult.error;
    setBills((billResult.data ?? []) as BillRow[]);
    setPayments((paymentResult.data ?? []) as PaymentRow[]);
    setLedgerEntries((ledgerResult.data ?? []) as LedgerRow[]);
  }, [client]);

  useEffect(() => {
    if (!client || !session) return;
    let mounted = true;
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
    if (!staff || !selectedId) return;
    let mounted = true;
    // This is a data-fetching effect; the callback updates state only after its async database queries finish.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadCustomerDetails(selectedId).catch((error) => {
      if (mounted) setNotice({ type: "error", message: errorText(error) });
    });
    return () => { mounted = false; };
  }, [staff, selectedId, reloadCustomerDetails]);

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

  async function generateInvoicePdf(bill: BillRow) {
    if (!selectedCustomer) throw new Error("Select a customer before generating an invoice.");
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    const safeNumber = bill.bill_number.replace(/[^a-zA-Z0-9-_]/g, "_");
    const fileName = `BTNT-${safeNumber}.pdf`;
    const money = (value: number) => formatBDT(value);
    const details = [
      "Customer: " + selectedCustomer.customer_name,
      "Phone: " + (selectedCustomer.phone || "Not provided"),
      "Address: " + (selectedCustomer.address || "Not provided"),
      "Invoice: " + bill.bill_number,
      "Date: " + bill.bill_date,
      "Description: " + bill.description,
      "Invoice total: " + money(bill.amount),
      "Paid / allocated: " + money(bill.allocated_amount),
      "Outstanding: " + money(bill.outstanding_amount),
    ].join("\n");

    const hasIndicText = /[\\u0980-\\u09FF\\u0900-\\u097F]/.test(details);
    if (hasIndicText) {
      // jsPDF's built-in fonts do not cover Indic scripts. Render through browser fonts so
      // Bengali/Devanagari shaping remains readable in the generated invoice PDF.
      const html2canvas = (await import("html2canvas")).default;
      const root = document.createElement("section");
      Object.assign(root.style, {
        position: "absolute",
        left: "-10000px",
        top: "0",
        width: "794px",
        padding: "42px",
        boxSizing: "border-box",
        background: "#ffffff",
        color: "#17251f",
        fontFamily: '"Noto Sans Bengali", "Noto Sans Devanagari", system-ui, sans-serif',
        fontSize: "16px",
        lineHeight: "1.5",
      });
      const makeText = (tag: string, value: string, styles: Partial<CSSStyleDeclaration> = {}) => {
        const node = document.createElement(tag);
        node.textContent = value;
        Object.assign(node.style, styles);
        return node;
      };
      const header = document.createElement("div");
      Object.assign(header.style, { background: "#126b4a", color: "#ffffff", padding: "26px", borderRadius: "12px", display: "flex", justifyContent: "space-between", gap: "24px", alignItems: "center" });
      const brand = document.createElement("div");
      brand.appendChild(makeText("h1", "Bangladesh Tours & Travels", { fontSize: "27px", lineHeight: "1.25", margin: "0 0 8px", fontWeight: "700" }));
      brand.appendChild(makeText("p", "TRAVEL BILL · CUSTOMER COPY", { fontSize: "13px", margin: "0", letterSpacing: "1px" }));
      const invoice = document.createElement("div");
      Object.assign(invoice.style, { textAlign: "right", minWidth: "145px" });
      invoice.appendChild(makeText("div", "INVOICE", { fontSize: "12px", letterSpacing: "2px" }));
      invoice.appendChild(makeText("div", bill.bill_number, { fontSize: "18px", fontWeight: "700", marginTop: "8px", overflowWrap: "anywhere" }));
      header.append(brand, invoice);
      root.appendChild(header);

      const metadata = document.createElement("div");
      Object.assign(metadata.style, { display: "flex", gap: "48px", padding: "30px 2px 26px", borderBottom: "1px solid #d8e2db" });
      const billTo = document.createElement("div");
      Object.assign(billTo.style, { flex: "1", minWidth: "0" });
      billTo.appendChild(makeText("div", "BILL TO", { fontSize: "12px", fontWeight: "700", color: "#126b4a", letterSpacing: "1px", marginBottom: "9px" }));
      billTo.appendChild(makeText("div", selectedCustomer.customer_name, { fontSize: "18px", fontWeight: "700", overflowWrap: "anywhere" }));
      billTo.appendChild(makeText("div", selectedCustomer.phone || "Phone not provided", { marginTop: "5px", fontSize: "14px" }));
      if (selectedCustomer.address) billTo.appendChild(makeText("div", selectedCustomer.address, { marginTop: "5px", fontSize: "14px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }));
      const invoiceMeta = document.createElement("div");
      Object.assign(invoiceMeta.style, { flex: "1", minWidth: "0" });
      invoiceMeta.appendChild(makeText("div", "INVOICE DETAILS", { fontSize: "12px", fontWeight: "700", color: "#126b4a", letterSpacing: "1px", marginBottom: "9px" }));
      invoiceMeta.appendChild(makeText("div", "Invoice: " + bill.bill_number, { fontSize: "14px", overflowWrap: "anywhere" }));
      invoiceMeta.appendChild(makeText("div", "Date: " + bill.bill_date, { marginTop: "5px", fontSize: "14px" }));
      metadata.append(billTo, invoiceMeta);
      root.appendChild(metadata);

      const table = document.createElement("table");
      Object.assign(table.style, { width: "100%", borderCollapse: "collapse", marginTop: "24px", fontSize: "14px" });
      const thead = document.createElement("thead");
      const headingRow = document.createElement("tr");
      for (const [label, align] of [["PARTICULARS", "left"], ["BILL DATE", "left"], ["AMOUNT", "right"]] as const) {
        headingRow.appendChild(makeText("th", label, { padding: "13px 12px", background: "#f0f6f1", color: "#304338", textAlign: align, fontSize: "12px", borderBottom: "1px solid #d8e2db" }));
      }
      thead.appendChild(headingRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      const row = document.createElement("tr");
      row.appendChild(makeText("td", bill.description, { padding: "16px 12px", borderBottom: "1px solid #d8e2db", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }));
      row.appendChild(makeText("td", bill.bill_date, { padding: "16px 12px", borderBottom: "1px solid #d8e2db", whiteSpace: "nowrap" }));
      row.appendChild(makeText("td", money(bill.amount), { padding: "16px 12px", borderBottom: "1px solid #d8e2db", textAlign: "right", whiteSpace: "nowrap", fontWeight: "700" }));
      tbody.appendChild(row);
      table.appendChild(tbody);
      root.appendChild(table);

      const totalsBox = document.createElement("div");
      Object.assign(totalsBox.style, { marginTop: "28px", marginLeft: "auto", width: "320px", maxWidth: "100%" });
      const addTotal = (label: string, value: string, bold = false) => {
        const line = document.createElement("div");
        Object.assign(line.style, { display: "flex", justifyContent: "space-between", gap: "20px", padding: "8px 0", borderBottom: bold ? "2px solid #126b4a" : "1px solid #e8eee9", fontWeight: bold ? "700" : "400" });
        line.append(makeText("span", label, { fontSize: bold ? "15px" : "14px" }), makeText("span", value, { fontSize: bold ? "15px" : "14px", whiteSpace: "nowrap" }));
        totalsBox.appendChild(line);
      };
      addTotal("Invoice total", money(bill.amount));
      addTotal("Paid / allocated", money(bill.allocated_amount));
      addTotal(bill.outstanding_amount > 0 ? "Outstanding" : "Balance", money(bill.outstanding_amount), true);
      root.appendChild(totalsBox);
      root.appendChild(makeText("p", "Thank you for travelling with Bangladesh Tours & Travels.", { marginTop: "40px", fontSize: "13px", color: "#5f6f65" }));
      root.appendChild(makeText("p", "Authorised signature: ______________________________", { marginTop: "35px", fontSize: "13px", color: "#5f6f65" }));
      root.appendChild(makeText("p", "Generated by BTNT Bill Book", { marginTop: "20px", fontSize: "11px", textAlign: "center", color: "#718178" }));

      document.body.appendChild(root);
      let canvas: HTMLCanvasElement;
      try {
        await Promise.all([
          document.fonts.load('400 16px "Noto Sans Bengali"'),
          document.fonts.load('700 16px "Noto Sans Bengali"'),
          document.fonts.load('400 16px "Noto Sans Devanagari"'),
          document.fonts.load('700 16px "Noto Sans Devanagari"'),
        ]);
        await document.fonts.ready;
        canvas = await html2canvas(root, { scale: 2, backgroundColor: "#ffffff", logging: false, scrollX: 0, scrollY: 0 });
      } finally {
        root.remove();
      }
      const pageHeight = doc.internal.pageSize.getHeight();
      const pageMargin = 10;
      const printableWidth = pageWidth - pageMargin * 2;
      const printableHeight = pageHeight - pageMargin * 2;
      const mmPerPixel = printableWidth / canvas.width;
      const maxSliceHeight = Math.floor(printableHeight / mmPerPixel);
      let offset = 0;
      let pageIndex = 0;
      while (offset < canvas.height) {
        if (pageIndex > 0) doc.addPage();
        const sliceHeight = Math.min(maxSliceHeight, canvas.height - offset);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceHeight;
        const context = slice.getContext("2d");
        if (!context) throw new Error("Could not prepare the Unicode invoice canvas.");
        context.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        doc.addImage(slice.toDataURL("image/png"), "PNG", pageMargin, pageMargin, printableWidth, sliceHeight * mmPerPixel, undefined, "FAST");
        offset += sliceHeight;
        pageIndex += 1;
      }
      return { doc, fileName, details };
    }

    doc.setFillColor(18, 107, 74);
    doc.roundedRect(margin, 16, contentWidth, 32, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("BANGLADESH TOURS & TRAVELS", margin + 7, 29);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("TRAVEL BILL  •  CUSTOMER COPY", margin + 7, 39);
    doc.text("INVOICE", pageWidth - margin - 7, 29, { align: "right" });
    doc.setFontSize(9);
    doc.text(bill.bill_number, pageWidth - margin - 7, 39, { align: "right" });

    let y = 61;
    doc.setTextColor(33, 45, 38);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("BILL TO", margin, y);
    doc.text("INVOICE DETAILS", pageWidth / 2 + 5, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(selectedCustomer.customer_name, contentWidth / 2 - 8), margin, y);
    doc.text(`Date: ${bill.bill_date}`, pageWidth / 2 + 5, y);
    y += 5;
    if (selectedCustomer.phone) {
      doc.text(`Phone: ${selectedCustomer.phone}`, margin, y);
      y += 5;
    }
    if (selectedCustomer.address) {
      const addressLines = doc.splitTextToSize(selectedCustomer.address, contentWidth / 2 - 8);
      doc.text(addressLines, margin, y);
    }
    y = Math.max(y + 13, 100);

    doc.setDrawColor(216, 226, 219);
    doc.setFillColor(242, 247, 243);
    doc.rect(margin, y, contentWidth, 11, "FD");
    doc.setTextColor(48, 67, 56);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("PARTICULARS", margin + 4, y + 7);
    doc.text("AMOUNT", pageWidth - margin - 4, y + 7, { align: "right" });
    y += 11;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 45, 38);
    const descriptionLines = doc.splitTextToSize(bill.description, contentWidth - 45);
    const rowHeight = Math.max(14, descriptionLines.length * 5 + 7);
    doc.rect(margin, y, contentWidth, rowHeight);
    doc.text(descriptionLines, margin + 4, y + 7);
    doc.setFont("helvetica", "bold");
    doc.text(money(bill.amount), pageWidth - margin - 4, y + 7, { align: "right" });
    y += rowHeight + 12;

    const summaryX = pageWidth - margin - 75;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Invoice total", summaryX, y);
    doc.text(money(bill.amount), pageWidth - margin - 4, y, { align: "right" });
    y += 8;
    doc.text("Paid / allocated", summaryX, y);
    doc.text(money(bill.allocated_amount), pageWidth - margin - 4, y, { align: "right" });
    y += 8;
    doc.setDrawColor(18, 107, 74);
    doc.line(summaryX, y - 4, pageWidth - margin, y - 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(bill.outstanding_amount > 0 ? "OUTSTANDING" : "BALANCE", summaryX, y + 2);
    doc.text(money(bill.outstanding_amount), pageWidth - margin - 4, y + 2, { align: "right" });
    y += 30;

    doc.setTextColor(95, 111, 101);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Thank you for travelling with Bangladesh Tours & Travels.", margin, y);
    doc.text("Authorised signature: __________________________", margin, y + 24);
    doc.text("Generated by BTNT Bill Book", pageWidth / 2, 283, { align: "center" });

    return { doc, fileName, details };
  }

  async function downloadInvoicePdf(bill: BillRow) {
    try {
      const { doc, fileName } = await generateInvoicePdf(bill);
      doc.save(fileName);
      setNotice({ type: "success", message: "Invoice PDF generated and downloaded." });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    }
  }

  async function shareBillWhatsApp(bill: BillRow) {
    try {
      const { doc, fileName, details } = await generateInvoicePdf(bill);
      const pdfBlob = doc.output("blob");
      const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
      if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: `BTNT Invoice ${bill.bill_number}`,
          text: "Bangladesh Tours & Travels — invoice attached.",
          files: [pdfFile],
        });
        setNotice({ type: "success", message: "Invoice shared using your device's share sheet. Choose WhatsApp to send the PDF if it is available." });
        return;
      }

      doc.save(fileName);
      const rawPhone = (selectedCustomer?.phone ?? "").trim();
      const phoneDigits = rawPhone.replace(/\D/g, "");
      const recipient = rawPhone.startsWith("+") && phoneDigits.length >= 8 ? phoneDigits : "";
      const url = recipient
        ? `https://wa.me/${recipient}?text=${encodeURIComponent(details)}`
        : `https://wa.me/?text=${encodeURIComponent(details)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setNotice({ type: "warning", message: "PDF downloaded and WhatsApp opened with the bill summary. Attach the downloaded PDF in WhatsApp before sending." });
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      setNotice({ type: "error", message: errorText(error) });
    }
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
      const fingerprint = JSON.stringify([customerName.trim(), customerPhone.trim(), customerAddress.trim(), due, advance]);
      const { data, error } = await client.rpc("create_customer", {
        p_name: customerName.trim(),
        p_phone: customerPhone.trim() || null,
        p_address: customerAddress.trim() || null,
        p_opening_due: due,
        p_opening_advance: advance,
        p_operation_key: submissionKey("customer", fingerprint),
      });
      if (error) throw error;
      const id = String(data);
      await reloadCustomers(id);
      clearSubmissionKey("customer", fingerprint);
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
      const fingerprint = JSON.stringify([selectedCustomer.customer_id, billNumber.trim().toUpperCase(), billDate, billDescription.trim(), Number(billAmount)]);
      const { data, error } = await client.rpc("create_bill", {
        p_customer_id: selectedCustomer.customer_id,
        p_bill_number: billNumber.trim(),
        p_bill_date: billDate,
        p_description: billDescription.trim(),
        p_amount: Number(billAmount),
        p_operation_key: submissionKey("bill", fingerprint),
      });
      if (error) throw error;
      await reloadCustomers(selectedCustomer.customer_id);
      await reloadCustomerDetails(selectedCustomer.customer_id);
      clearSubmissionKey("bill", fingerprint);
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
      const fingerprint = JSON.stringify([selectedCustomer.customer_id, Number(paymentAmount), paymentDate, paymentMethod, paymentReference.trim()]);
      const { error } = await client.rpc("create_payment", {
        p_customer_id: selectedCustomer.customer_id,
        p_amount: Number(paymentAmount),
        p_payment_date: paymentDate,
        p_method: paymentMethod,
        p_reference: paymentReference.trim() || null,
        p_operation_key: submissionKey("payment", fingerprint),
      });
      if (error) throw error;
      await reloadCustomers(selectedCustomer.customer_id);
      await reloadCustomerDetails(selectedCustomer.customer_id);
      clearSubmissionKey("payment", fingerprint);
      setPaymentAmount(""); setPaymentReference("");
      setNotice({ type: "success", message: "Payment recorded and allocated FIFO to the oldest open bills. Any extra remains as customer advance." });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleCreateAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !selectedCustomer) return;
    setFormBusy(true);
    setNotice(null);
    try {
      const signedAmount = Number(adjustmentAmount);
      if (!Number.isFinite(signedAmount) || signedAmount === 0) throw new Error("Adjustment must be a non-zero amount. Use a positive value to increase due or a negative value to credit the customer.");
      const fingerprint = JSON.stringify([selectedCustomer.customer_id, signedAmount, adjustmentReason.trim()]);
      const { error } = await client.rpc("record_adjustment", {
        p_customer_id: selectedCustomer.customer_id,
        p_amount_signed: signedAmount,
        p_reason: adjustmentReason.trim(),
        p_operation_key: submissionKey("adjustment", fingerprint),
      });
      if (error) throw error;
      await reloadCustomers(selectedCustomer.customer_id);
      await reloadCustomerDetails(selectedCustomer.customer_id);
      clearSubmissionKey("adjustment", fingerprint);
      setAdjustmentAmount("");
      setAdjustmentReason("");
      setNotice({ type: "success", message: "Adjustment recorded as an audited ledger entry. Financial records were not overwritten." });
    } catch (error) {
      setNotice({ type: "error", message: errorText(error) });
    } finally {
      setFormBusy(false);
    }
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
                    <button type="button" key={customer.customer_id} className={`customer-row ${selectedId === customer.customer_id ? "active" : ""}`} onClick={() => { setSelectedId(customer.customer_id); setBills([]); setPayments([]); setLedgerEntries([]); }}>
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
                    {(staff.role === "admin" || staff.role === "accountant") && (
                      <>
                        <div className="section-title">Ledger adjustment</div>
                        <p className="small-muted" style={{ marginBottom: 12 }}>For approved corrections only. Positive amount increases due; negative amount records a customer credit. This creates an audit entry—it never edits an old bill or payment.</p>
                        <form onSubmit={handleCreateAdjustment}>
                          <div className="form-grid">
                            <div className="field"><label htmlFor="adjustment-amount">Signed amount (৳) *</label><input id="adjustment-amount" type="number" step="0.01" required value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="250 or -250" /></div>
                            <div className="field"><label htmlFor="adjustment-reason">Reason / reference *</label><input id="adjustment-reason" required maxLength={500} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Explain the correction" /></div>
                          </div>
                          <button className="btn ghost full-width" type="submit" disabled={formBusy}>Record audited adjustment</button>
                        </form>
                      </>
                    )}
                  </>
                )}
              </section>

              {selectedCustomer && <section className="panel">
                <div className="panel-head"><div><h3>Bills &amp; outstanding balances</h3><p>Payments are allocated to the oldest open bill first.</p></div><span className="pill">{bills.length} rows</span></div>
                {bills.length === 0 ? <div className="empty-state">No bills recorded for this customer yet.</div> : (
                  <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Date / details</th><th className="numeric">Amount</th><th className="numeric">Due</th><th>Action</th></tr></thead><tbody>
                    {bills.map((bill) => <tr key={bill.id}>
                      <td><strong>{bill.bill_number}</strong>{bill.is_opening_balance && <div className="small-muted">Opening balance</div>}</td>
                      <td>{bill.bill_date}<div className="small-muted">{bill.description}</div></td>
                      <td className="numeric">{formatBDT(bill.amount)}</td>
                      <td className="numeric"><strong>{formatBDT(bill.outstanding_amount)}</strong><div className="small-muted">Paid {formatBDT(bill.allocated_amount)}</div></td>
                      <td><div className="row-actions">
                        <button className="btn ghost small" type="button" onClick={() => downloadInvoicePdf(bill)}>Download PDF</button>
                        <button className="btn secondary small" type="button" onClick={() => shareBillWhatsApp(bill)}>WhatsApp</button>
                      </div></td>
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
                      <td>{new Date(entry.entry_date + "T12:00:00").toLocaleDateString("en-IN")}</td>
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


    </>
  );
}

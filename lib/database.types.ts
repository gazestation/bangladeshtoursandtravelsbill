export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      staff_members: {
        Row: { user_id: string; display_name: string; role: "admin" | "accountant" | "operator"; active: boolean; created_at: string };
        Insert: { user_id: string; display_name: string; role: "admin" | "accountant" | "operator"; active?: boolean; created_at?: string };
        Update: { display_name?: string; role?: "admin" | "accountant" | "operator"; active?: boolean };
        Relationships: [];
      };
      customers: {
        Row: { id: string; name: string; phone: string | null; address: string | null; operation_key: string; request_fingerprint: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; phone?: string | null; address?: string | null; operation_key: string; request_fingerprint: string; created_at?: string; updated_at?: string };
        Update: { name?: string; phone?: string | null; address?: string | null; updated_at?: string };
        Relationships: [];
      };
      bills: {
        Row: { id: string; customer_id: string; bill_number: string; bill_date: string; description: string; amount: number; is_opening_balance: boolean; operation_key: string; request_fingerprint: string; created_by: string | null; created_at: string };
        Insert: { id?: string; customer_id: string; bill_number: string; bill_date?: string; description: string; amount: number; is_opening_balance?: boolean; operation_key: string; request_fingerprint: string; created_by?: string | null; created_at?: string };
        Update: { bill_number?: string; bill_date?: string; description?: string; amount?: number };
        Relationships: [];
      };
      payments: {
        Row: { id: string; customer_id: string; amount: number; payment_date: string; method: "cash" | "bank_transfer" | "mobile_banking" | "other"; reference: string | null; operation_key: string; request_fingerprint: string; created_by: string | null; created_at: string };
        Insert: { id?: string; customer_id: string; amount: number; payment_date?: string; method: "cash" | "bank_transfer" | "mobile_banking" | "other"; reference?: string | null; operation_key: string; request_fingerprint: string; created_by?: string | null; created_at?: string };
        Update: { amount?: number; payment_date?: string; method?: "cash" | "bank_transfer" | "mobile_banking" | "other"; reference?: string | null };
        Relationships: [];
      };
      ledger_entries: {
        Row: { id: string; customer_id: string; entry_type: "opening_due" | "opening_advance" | "bill" | "payment" | "adjustment"; amount_signed: number; bill_id: string | null; payment_id: string | null; notes: string | null; operation_key: string; created_by: string | null; created_at: string };
        Insert: { id?: string; customer_id: string; entry_type: "opening_due" | "opening_advance" | "bill" | "payment" | "adjustment"; amount_signed: number; bill_id?: string | null; payment_id?: string | null; notes?: string | null; operation_key: string; created_by?: string | null; created_at?: string };
        Update: { notes?: string | null };
        Relationships: [];
      };
      invoice_allocations: {
        Row: { id: string; credit_entry_id: string; bill_id: string; allocated_amount: number; created_at: string };
        Insert: { id?: string; credit_entry_id: string; bill_id: string; allocated_amount: number; created_at?: string };
        Update: { allocated_amount?: number };
        Relationships: [];
      };
    };
    Views: {
      customer_balance_summary: {
        Row: { customer_id: string; customer_name: string; phone: string | null; address: string | null; net_balance: number; due_balance: number; advance_balance: number; bill_count: number; created_at: string };
        Relationships: [];
      };
      bill_balance_summary: {
        Row: { id: string; customer_id: string; bill_number: string; bill_date: string; description: string; amount: number; is_opening_balance: boolean; allocated_amount: number; outstanding_amount: number; created_at: string };
        Relationships: [];
      };
      customer_ledger_statement: {
        Row: { id: string; customer_id: string; customer_name: string; entry_type: "opening_due" | "opening_advance" | "bill" | "payment" | "adjustment"; entry_date: string; amount_signed: number; notes: string | null; bill_id: string | null; payment_id: string | null; created_at: string; balance_after: number };
        Relationships: [];
      };
    };
    Functions: {
      is_active_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_admin_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      create_customer: { Args: { p_name: string; p_phone: string | null; p_address: string | null; p_opening_due: number; p_opening_advance: number; p_operation_key: string }; Returns: string };
      create_bill: { Args: { p_customer_id: string; p_bill_number: string; p_bill_date: string; p_description: string; p_amount: number; p_operation_key: string }; Returns: string };
      create_payment: { Args: { p_customer_id: string; p_amount: number; p_payment_date: string; p_method: string; p_reference: string | null; p_operation_key: string }; Returns: string };
      record_adjustment: { Args: { p_customer_id: string; p_amount_signed: number; p_reason: string; p_operation_key: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

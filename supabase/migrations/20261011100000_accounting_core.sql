-- BTNT Bill Book accounting foundation (clean-room migration).
-- Apply to a verified, dedicated Supabase project/test branch first.
-- Financial records are append-only from the client; bills/payments are created through locked, idempotent RPCs.

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'accountant', 'operator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  phone text,
  address text,
  operation_key text not null unique,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  bill_number text not null unique check (length(trim(bill_number)) between 1 and 80),
  bill_date date not null default current_date,
  description text not null check (length(trim(description)) between 1 and 2000),
  amount numeric(12,2) not null check (amount > 0),
  is_opening_balance boolean not null default false,
  operation_key text not null unique,
  request_fingerprint text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null default current_date,
  method text not null check (method in ('cash', 'bank_transfer', 'mobile_banking', 'other')),
  reference text,
  operation_key text not null unique,
  request_fingerprint text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Signed ledger convention: debit/amount due is positive; payment/advance credit is negative.
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  entry_type text not null check (entry_type in ('opening_due', 'opening_advance', 'bill', 'payment', 'adjustment')),
  entry_date date not null default current_date,
  amount_signed numeric(12,2) not null check (amount_signed <> 0),
  bill_id uuid references public.bills(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  notes text,
  operation_key text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (entry_type in ('opening_due', 'bill') and amount_signed > 0 and bill_id is not null and payment_id is null)
    or (entry_type = 'payment' and amount_signed < 0 and payment_id is not null and bill_id is null)
    or (entry_type = 'opening_advance' and amount_signed < 0 and bill_id is null and payment_id is null)
    or (entry_type = 'adjustment' and bill_id is null and payment_id is null)
  )
);

-- Credits can be allocated across bills. An unallocated remainder is the customer's advance.
create table if not exists public.invoice_allocations (
  id uuid primary key default gen_random_uuid(),
  credit_entry_id uuid not null references public.ledger_entries(id) on delete restrict,
  bill_id uuid not null references public.bills(id) on delete restrict,
  allocated_amount numeric(12,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  unique (credit_entry_id, bill_id)
);

create index if not exists customers_name_idx on public.customers (name);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists bills_customer_date_idx on public.bills (customer_id, bill_date, created_at);
create index if not exists payments_customer_date_idx on public.payments (customer_id, payment_date desc, created_at desc);
create index if not exists ledger_customer_created_idx on public.ledger_entries (customer_id, created_at, id);
create index if not exists allocations_bill_idx on public.invoice_allocations (bill_id);
create index if not exists allocations_credit_idx on public.invoice_allocations (credit_entry_id);

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active = true
  );
$$;

create or replace function public.is_admin_staff()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active = true and s.role = 'admin'
  );
$$;

alter table public.staff_members enable row level security;
alter table public.customers enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.invoice_allocations enable row level security;

drop policy if exists staff_can_read_staff_directory on public.staff_members;
create policy staff_can_read_staff_directory on public.staff_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin_staff());

drop policy if exists active_staff_read_customers on public.customers;
create policy active_staff_read_customers on public.customers
  for select to authenticated using (public.is_active_staff());

drop policy if exists active_staff_read_bills on public.bills;
create policy active_staff_read_bills on public.bills
  for select to authenticated using (public.is_active_staff());

drop policy if exists active_staff_read_payments on public.payments;
create policy active_staff_read_payments on public.payments
  for select to authenticated using (public.is_active_staff());

drop policy if exists active_staff_read_ledger on public.ledger_entries;
create policy active_staff_read_ledger on public.ledger_entries
  for select to authenticated using (public.is_active_staff());

drop policy if exists active_staff_read_allocations on public.invoice_allocations;
create policy active_staff_read_allocations on public.invoice_allocations
  for select to authenticated using (public.is_active_staff());

-- These views execute with the caller's permissions so underlying table RLS still applies.
create or replace view public.customer_balance_summary
with (security_invoker = true)
as
with ledger as (
  select customer_id, sum(amount_signed)::numeric(12,2) as net_balance
  from public.ledger_entries
  group by customer_id
), bill_counts as (
  select customer_id, count(*) filter (where is_opening_balance = false)::bigint as bill_count
  from public.bills
  group by customer_id
)
select
  c.id as customer_id,
  c.name as customer_name,
  c.phone,
  c.address,
  coalesce(l.net_balance, 0)::numeric(12,2) as net_balance,
  greatest(coalesce(l.net_balance, 0), 0)::numeric(12,2) as due_balance,
  greatest(-coalesce(l.net_balance, 0), 0)::numeric(12,2) as advance_balance,
  coalesce(b.bill_count, 0)::bigint as bill_count,
  c.created_at
from public.customers c
left join ledger l on l.customer_id = c.id
left join bill_counts b on b.customer_id = c.id;

create or replace view public.bill_balance_summary
with (security_invoker = true)
as
select
  b.id,
  b.customer_id,
  b.bill_number,
  b.bill_date,
  b.description,
  b.amount,
  b.is_opening_balance,
  coalesce(sum(a.allocated_amount), 0)::numeric(12,2) as allocated_amount,
  greatest(b.amount - coalesce(sum(a.allocated_amount), 0), 0)::numeric(12,2) as outstanding_amount,
  b.created_at
from public.bills b
left join public.invoice_allocations a on a.bill_id = b.id
group by b.id, b.customer_id, b.bill_number, b.bill_date, b.description, b.amount, b.is_opening_balance, b.created_at;

create or replace view public.customer_ledger_statement
with (security_invoker = true)
as
select
  le.id,
  le.customer_id,
  c.name as customer_name,
  le.entry_type,
  le.entry_date,
  le.amount_signed,
  le.notes,
  le.bill_id,
  le.payment_id,
  le.created_at,
  sum(le.amount_signed) over (
    partition by le.customer_id order by le.entry_date, le.created_at, le.id
    rows between unbounded preceding and current row
  )::numeric(12,2) as balance_after
from public.ledger_entries le
join public.customers c on c.id = le.customer_id;

create or replace function public.create_customer(
  p_name text,
  p_phone text,
  p_address text,
  p_opening_due numeric,
  p_opening_advance numeric,
  p_operation_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_customer_id uuid;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_opening_bill_id uuid;
  v_opening_credit_id uuid;
  v_alloc numeric(12,2);
begin
  if not public.is_active_staff() then raise exception 'Active staff access required.' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Customer name is required.'; end if;
  if p_opening_due is null or p_opening_advance is null or p_opening_due < 0 or p_opening_advance < 0 then
    raise exception 'Opening due and opening advance must be non-negative.';
  end if;
  if p_opening_due > 9999999999.99 or p_opening_advance > 9999999999.99 then raise exception 'Opening balance is too large.'; end if;
  if nullif(trim(p_operation_key), '') is null then raise exception 'Operation key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('create_customer:' || p_operation_key, 0));

  v_fingerprint := concat_ws(chr(31), trim(p_name), coalesce(trim(p_phone), ''), coalesce(trim(p_address), ''),
    to_char(p_opening_due, 'FM999999999999990.00'), to_char(p_opening_advance, 'FM999999999999990.00'));

  select id, request_fingerprint into v_customer_id, v_existing_fingerprint
  from public.customers where operation_key = p_operation_key;
  if found then
    if v_existing_fingerprint <> v_fingerprint then raise exception 'Idempotency key was already used with different customer details.'; end if;
    return v_customer_id;
  end if;

  insert into public.customers(name, phone, address, operation_key, request_fingerprint)
  values (trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_address), ''), p_operation_key, v_fingerprint)
  returning id into v_customer_id;

  if p_opening_due > 0 then
    insert into public.bills(customer_id, bill_number, bill_date, description, amount, is_opening_balance,
      operation_key, request_fingerprint, created_by)
    values (v_customer_id, 'OPEN-' || upper(replace(v_customer_id::text, '-', '')), current_date,
      'Opening balance due', round(p_opening_due, 2), true, 'opening-due:' || v_customer_id,
      'opening-due:' || v_customer_id || ':' || round(p_opening_due, 2)::text, auth.uid())
    returning id into v_opening_bill_id;

    insert into public.ledger_entries(customer_id, entry_type, amount_signed, bill_id, notes, operation_key, created_by)
    values (v_customer_id, 'opening_due', round(p_opening_due, 2), v_opening_bill_id, 'Opening balance due',
      'opening-due-ledger:' || v_customer_id, auth.uid());
  end if;

  if p_opening_advance > 0 then
    insert into public.ledger_entries(customer_id, entry_type, amount_signed, notes, operation_key, created_by)
    values (v_customer_id, 'opening_advance', -round(p_opening_advance, 2), 'Opening balance advance',
      'opening-advance-ledger:' || v_customer_id, auth.uid())
    returning id into v_opening_credit_id;

    if v_opening_bill_id is not null then
      v_alloc := least(round(p_opening_due, 2), round(p_opening_advance, 2));
      if v_alloc > 0 then
        insert into public.invoice_allocations(credit_entry_id, bill_id, allocated_amount)
        values (v_opening_credit_id, v_opening_bill_id, v_alloc);
      end if;
    end if;
  end if;

  return v_customer_id;
end;
$$;

create or replace function public.create_bill(
  p_customer_id uuid,
  p_bill_number text,
  p_bill_date date,
  p_description text,
  p_amount numeric,
  p_operation_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_bill_id uuid;
  v_customer_lock uuid;
  v_old record;
  v_credit record;
  v_ledger_id uuid;
  v_remaining numeric(12,2);
  v_take numeric(12,2);
  v_fingerprint text;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required.' using errcode = '42501'; end if;
  if p_customer_id is null or nullif(trim(p_bill_number), '') is null or p_bill_date is null or nullif(trim(p_description), '') is null then
    raise exception 'Customer, bill number, date, and description are required.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 then raise exception 'Bill amount must be positive and within the supported limit.'; end if;
  if nullif(trim(p_operation_key), '') is null then raise exception 'Operation key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('create_bill:' || p_operation_key, 0));

  select id into v_customer_lock from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found.'; end if;

  v_fingerprint := concat_ws(chr(31), p_customer_id::text, upper(trim(p_bill_number)), p_bill_date::text,
    trim(p_description), round(p_amount, 2)::text);
  select id, customer_id, bill_number, bill_date, description, amount, request_fingerprint
    into v_old from public.bills where operation_key = p_operation_key;
  if found then
    if v_old.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key was already used with different bill details.'; end if;
    return v_old.id;
  end if;

  insert into public.bills(customer_id, bill_number, bill_date, description, amount, operation_key, request_fingerprint, created_by)
  values (p_customer_id, trim(p_bill_number), p_bill_date, trim(p_description), round(p_amount, 2),
    p_operation_key, v_fingerprint, auth.uid())
  returning id into v_bill_id;

  insert into public.ledger_entries(customer_id, entry_type, entry_date, amount_signed, bill_id, notes, operation_key, created_by)
  values (p_customer_id, 'bill', p_bill_date, round(p_amount, 2), v_bill_id, trim(p_description), p_operation_key || ':ledger', auth.uid())
  returning id into v_ledger_id;

  -- Apply any unused historic credits/advances to this new invoice, oldest credit first.
  v_remaining := round(p_amount, 2);
  for v_credit in
    select le.id,
      (-le.amount_signed - coalesce(sum(ia.allocated_amount), 0))::numeric(12,2) as available
    from public.ledger_entries le
    left join public.invoice_allocations ia on ia.credit_entry_id = le.id
    where le.customer_id = p_customer_id and le.amount_signed < 0
      and le.entry_type in ('payment', 'opening_advance', 'adjustment')
    group by le.id, le.amount_signed, le.created_at
    having -le.amount_signed - coalesce(sum(ia.allocated_amount), 0) > 0
    order by le.created_at, le.id
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_credit.available);
    if v_take > 0 then
      insert into public.invoice_allocations(credit_entry_id, bill_id, allocated_amount)
      values (v_credit.id, v_bill_id, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  return v_bill_id;
end;
$$;

create or replace function public.create_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_method text,
  p_reference text,
  p_operation_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_payment_id uuid;
  v_customer_lock uuid;
  v_old record;
  v_credit_id uuid;
  v_bill record;
  v_remaining numeric(12,2);
  v_take numeric(12,2);
  v_fingerprint text;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required.' using errcode = '42501'; end if;
  if p_customer_id is null or p_payment_date is null then raise exception 'Customer and payment date are required.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 then raise exception 'Payment amount must be positive and within the supported limit.'; end if;
  if p_method not in ('cash', 'bank_transfer', 'mobile_banking', 'other') then raise exception 'Unsupported payment method.'; end if;
  if nullif(trim(p_operation_key), '') is null then raise exception 'Operation key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('create_payment:' || p_operation_key, 0));

  select id into v_customer_lock from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found.'; end if;

  v_fingerprint := concat_ws(chr(31), p_customer_id::text, round(p_amount, 2)::text, p_payment_date::text,
    p_method, coalesce(trim(p_reference), ''));
  select id, request_fingerprint into v_old from public.payments where operation_key = p_operation_key;
  if found then
    if v_old.request_fingerprint <> v_fingerprint then raise exception 'Idempotency key was already used with different payment details.'; end if;
    return v_old.id;
  end if;

  insert into public.payments(customer_id, amount, payment_date, method, reference, operation_key, request_fingerprint, created_by)
  values (p_customer_id, round(p_amount, 2), p_payment_date, p_method, nullif(trim(p_reference), ''),
    p_operation_key, v_fingerprint, auth.uid())
  returning id into v_payment_id;

  insert into public.ledger_entries(customer_id, entry_type, entry_date, amount_signed, payment_id, notes, operation_key, created_by)
  values (p_customer_id, 'payment', p_payment_date, -round(p_amount, 2), v_payment_id,
    'Payment via ' || replace(p_method, '_', ' '), p_operation_key || ':ledger', auth.uid())
  returning id into v_credit_id;

  -- Apply payment to oldest outstanding invoices first. Any remainder stays as customer advance.
  v_remaining := round(p_amount, 2);
  for v_bill in
    select b.id,
      (b.amount - coalesce(sum(a.allocated_amount), 0))::numeric(12,2) as outstanding
    from public.bills b
    left join public.invoice_allocations a on a.bill_id = b.id
    where b.customer_id = p_customer_id
    group by b.id, b.amount, b.bill_date, b.created_at
    having b.amount - coalesce(sum(a.allocated_amount), 0) > 0
    order by b.bill_date, b.created_at, b.id
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_bill.outstanding);
    if v_take > 0 then
      insert into public.invoice_allocations(credit_entry_id, bill_id, allocated_amount)
      values (v_credit_id, v_bill.id, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  return v_payment_id;
end;
$$;

create or replace function public.record_adjustment(
  p_customer_id uuid,
  p_amount_signed numeric,
  p_reason text,
  p_operation_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_entry_id uuid;
  v_customer_lock uuid;
  v_old record;
  v_credit record;
  v_remaining numeric(12,2);
  v_take numeric(12,2);
  v_fingerprint text;
  v_adjustment_bill_id uuid;
  v_adjustment_bill_number text;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active = true and s.role in ('admin', 'accountant')
  ) then raise exception 'Administrator or accountant access required for adjustments.' using errcode = '42501'; end if;
  if p_customer_id is null or nullif(trim(p_reason), '') is null then raise exception 'Customer and adjustment reason are required.'; end if;
  if p_amount_signed is null or p_amount_signed = 0 or abs(p_amount_signed) > 9999999999.99 then raise exception 'Adjustment must be non-zero and within the supported limit.'; end if;
  if nullif(trim(p_operation_key), '') is null then raise exception 'Operation key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('record_adjustment:' || p_operation_key, 0));

  select id into v_customer_lock from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found.'; end if;

  v_fingerprint := concat_ws(chr(31), p_customer_id::text, round(p_amount_signed, 2)::text, trim(p_reason));
  select id, customer_id, amount_signed, notes, entry_type into v_old from public.ledger_entries
    where operation_key = p_operation_key;
  if found then
    if concat_ws(chr(31), v_old.customer_id::text, round(v_old.amount_signed, 2)::text, coalesce(v_old.notes, '')) <> v_fingerprint
      then raise exception 'Idempotency key was already used with different adjustment details.'; end if;
    return v_old.id;
  end if;

  if p_amount_signed > 0 then
    -- A positive adjustment is a charge. Give it its own bill so later payments can settle it FIFO.
    v_adjustment_bill_number := 'ADJ-' || upper(replace(gen_random_uuid()::text, '-', ''));
    insert into public.bills(customer_id, bill_number, bill_date, description, amount, is_opening_balance,
      operation_key, request_fingerprint, created_by)
    values (p_customer_id, v_adjustment_bill_number, current_date, 'Adjustment: ' || trim(p_reason),
      round(p_amount_signed, 2), false, p_operation_key || ':bill', v_fingerprint, auth.uid())
    returning id into v_adjustment_bill_id;

    insert into public.ledger_entries(customer_id, entry_type, entry_date, amount_signed, bill_id, notes, operation_key, created_by)
    values (p_customer_id, 'bill', current_date, round(p_amount_signed, 2), v_adjustment_bill_id,
      trim(p_reason), p_operation_key, auth.uid())
    returning id into v_entry_id;

    -- Apply any advance balance to this new charge, matching create_bill behavior.
    v_remaining := round(p_amount_signed, 2);
    for v_credit in
      select le.id,
        (-le.amount_signed - coalesce(sum(ia.allocated_amount), 0))::numeric(12,2) as available
      from public.ledger_entries le
      left join public.invoice_allocations ia on ia.credit_entry_id = le.id
      where le.customer_id = p_customer_id and le.amount_signed < 0
        and le.entry_type in ('payment', 'opening_advance', 'adjustment')
      group by le.id, le.amount_signed, le.created_at
      having -le.amount_signed - coalesce(sum(ia.allocated_amount), 0) > 0
      order by le.created_at, le.id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_credit.available);
      if v_take > 0 then
        insert into public.invoice_allocations(credit_entry_id, bill_id, allocated_amount)
        values (v_credit.id, v_adjustment_bill_id, v_take);
        v_remaining := v_remaining - v_take;
      end if;
    end loop;
  else
    insert into public.ledger_entries(customer_id, entry_type, amount_signed, notes, operation_key, created_by)
    values (p_customer_id, 'adjustment', round(p_amount_signed, 2), trim(p_reason), p_operation_key, auth.uid())
    returning id into v_entry_id;
  end if;

  if p_amount_signed < 0 then
    v_remaining := -round(p_amount_signed, 2);
    for v_credit in
      select b.id, (b.amount - coalesce(sum(a.allocated_amount), 0))::numeric(12,2) as outstanding
      from public.bills b
      left join public.invoice_allocations a on a.bill_id = b.id
      where b.customer_id = p_customer_id
      group by b.id, b.amount, b.bill_date, b.created_at
      having b.amount - coalesce(sum(a.allocated_amount), 0) > 0
      order by b.bill_date, b.created_at, b.id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_credit.outstanding);
      if v_take > 0 then
        insert into public.invoice_allocations(credit_entry_id, bill_id, allocated_amount)
        values (v_entry_id, v_credit.id, v_take);
        v_remaining := v_remaining - v_take;
      end if;
    end loop;
  end if;

  return v_entry_id;
end;
$$;

-- RLS grants are intentionally read-only. Writes must go through the transactional RPCs.
revoke all on public.staff_members, public.customers, public.bills, public.payments,
  public.ledger_entries, public.invoice_allocations from anon, authenticated;
grant select on public.staff_members, public.customers, public.bills, public.payments,
  public.ledger_entries, public.invoice_allocations to authenticated;
grant select on public.customer_balance_summary, public.bill_balance_summary, public.customer_ledger_statement to authenticated;

revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.is_admin_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.is_admin_staff() to authenticated;

revoke all on function public.create_customer(text, text, text, numeric, numeric, text) from public, anon;
revoke all on function public.create_bill(uuid, text, date, text, numeric, text) from public, anon;
revoke all on function public.create_payment(uuid, numeric, date, text, text, text) from public, anon;
revoke all on function public.record_adjustment(uuid, numeric, text, text) from public, anon;
grant execute on function public.create_customer(text, text, text, numeric, numeric, text) to authenticated;
grant execute on function public.create_bill(uuid, text, date, text, numeric, text) to authenticated;
grant execute on function public.create_payment(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.record_adjustment(uuid, numeric, text, text) to authenticated;

comment on table public.ledger_entries is 'Append-only signed customer ledger: positive = receivable, negative = credit/advance.';
comment on table public.invoice_allocations is 'FIFO allocation of payment/opening-credit/adjustment ledger entries to invoices.';
comment on function public.create_bill(uuid, text, date, text, numeric, text) is 'Transaction-safe, idempotent bill creation with historic advance application.';
comment on function public.create_payment(uuid, numeric, date, text, text, text) is 'Transaction-safe, idempotent payment creation and FIFO invoice allocation.';

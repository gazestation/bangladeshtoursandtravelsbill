\set ON_ERROR_STOP on

-- Seed an administrator in the isolated CI database.
INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO auth.users (id) VALUES ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.staff_members (user_id, display_name, role, active)
VALUES ('11111111-1111-4111-8111-111111111111', 'CI Admin', 'admin', true);

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SET ROLE authenticated;

DO $$
DECLARE
  v_customer uuid;
  v_customer_retry uuid;
  v_b1 uuid;
  v_b2 uuid;
  v_b3 uuid;
  v_b4 uuid;
  v_payment uuid;
  v_payment_retry uuid;
  v_due numeric(12,2);
  v_advance numeric(12,2);
  v_opening_outstanding numeric(12,2);
  v_b1_outstanding numeric(12,2);
  v_b2_outstanding numeric(12,2);
  v_b3_outstanding numeric(12,2);
  v_adjustment_count integer;
BEGIN
  -- Opening due 10,000 minus opening advance 3,000 = due 7,000.
  v_customer := public.create_customer(
    'CI Customer', '+8801700000000', 'CI-only address', 10000, 3000, 'ci-customer-001'
  );
  v_customer_retry := public.create_customer(
    'CI Customer', '+8801700000000', 'CI-only address', 10000, 3000, 'ci-customer-001'
  );
  IF v_customer <> v_customer_retry THEN
    RAISE EXCEPTION 'Customer idempotency failed';
  END IF;

  SELECT due_balance, advance_balance INTO v_due, v_advance
  FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 7000 OR v_advance <> 0 THEN
    RAISE EXCEPTION 'Opening due/advance mismatch: due %, advance %', v_due, v_advance;
  END IF;

  SELECT outstanding_amount INTO v_opening_outstanding
  FROM public.bill_balance_summary
  WHERE customer_id = v_customer AND is_opening_balance = true;
  IF v_opening_outstanding <> 7000 THEN
    RAISE EXCEPTION 'Opening bill outstanding expected 7000, got %', v_opening_outstanding;
  END IF;

  v_b1 := public.create_bill(v_customer, 'CI-BILL-001', DATE '2026-10-11', 'Oldest ticket', 5000, 'ci-bill-001');
  v_b2 := public.create_bill(v_customer, 'CI-BILL-002', DATE '2026-10-11', 'Second ticket', 5000, 'ci-bill-002');

  v_payment := public.create_payment(v_customer, 7000, DATE '2026-10-11', 'cash', 'CI payment 1', 'ci-payment-001');
  v_payment_retry := public.create_payment(v_customer, 7000, DATE '2026-10-11', 'cash', 'CI payment 1', 'ci-payment-001');
  IF v_payment <> v_payment_retry THEN
    RAISE EXCEPTION 'Payment idempotency failed';
  END IF;

  SELECT outstanding_amount INTO v_opening_outstanding
  FROM public.bill_balance_summary WHERE id = (
    SELECT id FROM public.bills WHERE customer_id = v_customer AND is_opening_balance = true
  );
  SELECT outstanding_amount INTO v_b1 FROM public.bill_balance_summary WHERE id = v_b1;
  SELECT outstanding_amount INTO v_b2 FROM public.bill_balance_summary WHERE id = v_b2;
  IF v_opening_outstanding <> 0 OR v_b1 <> 5000 OR v_b2 <> 5000 THEN
    RAISE EXCEPTION 'FIFO check failed: opening %, bill1 %, bill2 %', v_opening_outstanding, v_b1, v_b2;
  END IF;

  SELECT due_balance, advance_balance INTO v_due, v_advance
  FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 10000 OR v_advance <> 0 THEN
    RAISE EXCEPTION 'Expected due 10000 after initial payment, got due %, advance %', v_due, v_advance;
  END IF;

  -- Payment exceeds open bills by 2,000; that remainder becomes advance.
  PERFORM public.create_payment(v_customer, 12000, DATE '2026-10-11', 'bank_transfer', 'CI payment 2', 'ci-payment-002');
  SELECT due_balance, advance_balance INTO v_due, v_advance
  FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 0 OR v_advance <> 2000 THEN
    RAISE EXCEPTION 'Overpayment should create advance: due %, advance %', v_due, v_advance;
  END IF;

  -- Advance is auto-applied when a later bill is created.
  v_b3 := public.create_bill(v_customer, 'CI-BILL-003', DATE '2026-10-11', 'Later ticket', 3000, 'ci-bill-003');
  SELECT outstanding_amount INTO v_b3 FROM public.bill_balance_summary WHERE id = v_b3;
  IF v_b3 <> 1000 THEN
    RAISE EXCEPTION 'Expected later bill outstanding 1000 after using advance, got %', v_b3;
  END IF;
  SELECT due_balance, advance_balance INTO v_due, v_advance
  FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 1000 OR v_advance <> 0 THEN
    RAISE EXCEPTION 'Advance carry-forward mismatch: due %, advance %', v_due, v_advance;
  END IF;

  -- Positive adjustment creates a separate charge invoice and a ledger movement.
  PERFORM public.record_adjustment(v_customer, 500, 'CI approved charge', 'ci-adjustment-plus');
  SELECT due_balance INTO v_due FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 1500 THEN
    RAISE EXCEPTION 'Positive adjustment expected due 1500, got %', v_due;
  END IF;
  SELECT count(*) INTO v_adjustment_count
  FROM public.bills WHERE customer_id = v_customer AND description = 'Adjustment: CI approved charge';
  IF v_adjustment_count <> 1 THEN
    RAISE EXCEPTION 'Positive adjustment charge bill missing';
  END IF;

  -- Negative adjustment credits oldest outstanding bills first.
  PERFORM public.record_adjustment(v_customer, -200, 'CI approved credit', 'ci-adjustment-minus');
  SELECT due_balance, advance_balance INTO v_due, v_advance
  FROM public.customer_balance_summary WHERE customer_id = v_customer;
  IF v_due <> 1300 OR v_advance <> 0 THEN
    RAISE EXCEPTION 'Negative adjustment mismatch: due %, advance %', v_due, v_advance;
  END IF;

  -- Same operation key + same arguments returns the original record; changed arguments are rejected.
  v_b4 := public.create_bill(v_customer, 'CI-BILL-004', DATE '2026-10-11', 'Idempotent ticket', 50, 'ci-bill-004');
  IF v_b4 <> public.create_bill(v_customer, 'CI-BILL-004', DATE '2026-10-11', 'Idempotent ticket', 50, 'ci-bill-004') THEN
    RAISE EXCEPTION 'Bill idempotency failed';
  END IF;
  BEGIN
    PERFORM public.create_bill(v_customer, 'CI-BILL-004', DATE '2026-10-11', 'Idempotent ticket', 60, 'ci-bill-004');
    RAISE EXCEPTION 'Changed payload reused idempotency key but was not rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Changed payload reused idempotency key but was not rejected' THEN
      RAISE;
    END IF;
    IF position('Idempotency key' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- An Auth user who is not active staff cannot read the staff directory or invoke an accounting RPC.
  PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
  BEGIN
    PERFORM public.create_customer('Should be denied', NULL, NULL, 0, 0, 'ci-unauthorized');
    RAISE EXCEPTION 'Non-staff customer creation was not denied';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.customer_balance_summary;
    -- A denied SELECT would throw before this line.
    RAISE EXCEPTION 'Non-staff read was not denied';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

RESET ROLE;

-- Assert no duplicate financial records were created by exact retries.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.customers WHERE operation_key = 'ci-customer-001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate customer count: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.payments WHERE operation_key = 'ci-payment-001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate payment count: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.bills WHERE operation_key = 'ci-bill-004';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate bill count: %', v_count; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bill_balance_summary
    WHERE allocated_amount < 0 OR outstanding_amount < 0 OR allocated_amount + outstanding_amount <> amount
  ) THEN
    RAISE EXCEPTION 'Invoice allocation reconciliation failed';
  END IF;
END
$$;

SELECT 'PostgreSQL accounting integration checks passed.' AS result;

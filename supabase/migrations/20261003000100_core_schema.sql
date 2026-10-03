-- SmartStation Pro — core schema
-- Builds on the kickoff schema (tanks, pump_readings, shop_inventory,
-- financial_transactions) and adds the tables needed to run a station:
-- staff profiles, fuel products/prices, pumps, shifts, dips, deliveries,
-- shop movements and a double-entry ledger.

-- ---------------------------------------------------------------------------
-- Staff & settings
-- ---------------------------------------------------------------------------

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text not null default '',
    email text,
    -- 'pending' accounts can sign in but see nothing until the owner assigns a role.
    role text not null default 'pending'
        check (role in ('owner', 'manager', 'attendant', 'pending')),
    created_at timestamp with time zone not null default now()
);

-- Single-row table of station-wide settings.
create table public.station_settings (
    id boolean primary key default true check (id),
    station_name text not null default 'Peak Energy',
    currency_code text not null default 'SLE',
    -- Shifts whose shortage is within this amount are not flagged.
    shortage_tolerance numeric(14, 2) not null default 0 check (shortage_tolerance >= 0),
    -- Daily wet-stock variance (as % of litres sold) above which a tank is flagged.
    dip_variance_tolerance_percent numeric(6, 2) not null default 0.5
        check (dip_variance_tolerance_percent >= 0),
    updated_at timestamp with time zone not null default now()
);

insert into public.station_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Wet stock
-- ---------------------------------------------------------------------------

create table public.fuel_products (
    code text primary key check (code ~ '^[A-Z0-9]{2,10}$'), -- e.g. 'PMS', 'AGO'
    name text not null,
    price_per_liter numeric(14, 2) not null default 0 check (price_per_liter >= 0),
    -- Weighted average cost, maintained by fuel deliveries. Drives COGS.
    avg_cost_per_liter numeric(14, 4) not null default 0 check (avg_cost_per_liter >= 0),
    updated_at timestamp with time zone not null default now()
);

create table public.fuel_price_history (
    id uuid primary key default gen_random_uuid(),
    fuel_type text not null references public.fuel_products (code) on update cascade,
    old_price numeric(14, 2),
    new_price numeric(14, 2) not null,
    changed_by uuid references public.profiles (id) on delete set null default auth.uid(),
    changed_at timestamp with time zone not null default now()
);

-- 1. Tanks Table (Wet Stock)
create table public.tanks (
    id uuid primary key default gen_random_uuid(),
    tank_name text not null unique,
    fuel_type text not null references public.fuel_products (code) on update cascade,
    capacity_liters numeric not null check (capacity_liters > 0),
    -- Book stock. Changed only by meter sales, deliveries and closing dips.
    current_volume numeric not null default 0 check (current_volume >= 0),
    reorder_level_liters numeric not null check (reorder_level_liters >= 0),
    is_active boolean not null default true,
    updated_at timestamp with time zone default now(),
    constraint tanks_volume_within_capacity check (current_volume <= capacity_liters)
);

-- A pump here is one metered nozzle drawing from one tank.
create table public.pumps (
    id uuid primary key default gen_random_uuid(),
    pump_number text not null unique,
    tank_id uuid not null references public.tanks (id),
    -- Last closing totaliser reading; pre-fills the next opening reading.
    current_meter numeric not null default 0 check (current_meter >= 0),
    is_active boolean not null default true,
    created_at timestamp with time zone not null default now()
);

create table public.tank_dips (
    id uuid primary key default gen_random_uuid(),
    tank_id uuid not null references public.tanks (id),
    dip_date date not null default current_date,
    dip_type text not null check (dip_type in ('OPENING', 'CLOSING')),
    dip_reading_cm numeric check (dip_reading_cm >= 0), -- optional raw stick reading
    volume_liters numeric not null check (volume_liters >= 0),
    -- Filled by trigger: system (book) volume at the moment of the dip and the gap.
    book_volume numeric,
    variance_liters numeric,
    journal_entry_id uuid,
    notes text,
    recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone not null default now(),
    unique (tank_id, dip_date, dip_type)
);

create table public.fuel_deliveries (
    id uuid primary key default gen_random_uuid(),
    tank_id uuid not null references public.tanks (id),
    delivery_date date not null default current_date,
    supplier text not null,
    waybill_number text,
    invoiced_liters numeric not null check (invoiced_liters > 0),
    received_liters numeric not null check (received_liters > 0),
    unit_cost numeric(14, 4) not null check (unit_cost >= 0),
    total_cost numeric generated always as (round(invoiced_liters * unit_cost, 2)) stored,
    transit_loss_liters numeric generated always as (invoiced_liters - received_liters) stored,
    -- CREDIT = owed to supplier (Accounts Payable); CASH/BANK = paid on delivery.
    payment_method text not null default 'CREDIT' check (payment_method in ('CASH', 'BANK', 'CREDIT')),
    journal_entry_id uuid,
    notes text,
    recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Shifts & pump meter sales
-- ---------------------------------------------------------------------------

create table public.shifts (
    id uuid primary key default gen_random_uuid(),
    shift_date date not null default current_date,
    shift_label text not null default 'Day'
        check (shift_label in ('Morning', 'Afternoon', 'Night', 'Day')),
    attendant_id uuid not null references public.profiles (id),
    status text not null default 'OPEN' check (status in ('OPEN', 'SUBMITTED', 'RECONCILED')),
    -- Handover declared by the attendant.
    cash_on_hand numeric(14, 2) not null default 0 check (cash_on_hand >= 0),
    credit_slips_amount numeric(14, 2) not null default 0 check (credit_slips_amount >= 0),
    digital_transfers_amount numeric(14, 2) not null default 0 check (digital_transfers_amount >= 0),
    -- Computed by trigger from pump readings when the shift is submitted.
    expected_liters numeric(14, 3),
    expected_sales numeric(14, 2),
    variance numeric(14, 2), -- collected − expected; negative = shortage
    notes text,
    opened_at timestamp with time zone not null default now(),
    submitted_at timestamp with time zone,
    reconciled_at timestamp with time zone,
    reconciled_by uuid references public.profiles (id) on delete set null,
    journal_entry_id uuid,
    unique (shift_date, shift_label, attendant_id)
);

-- 2. Pump Meter Readings (Daily Sales)
create table public.pump_readings (
    id uuid primary key default gen_random_uuid(),
    shift_id uuid not null references public.shifts (id) on delete cascade,
    pump_number text not null references public.pumps (pump_number) on update cascade,
    tank_id uuid references public.tanks (id), -- snapshot, set by trigger
    fuel_type text not null,                    -- snapshot, set by trigger
    opening_meter numeric not null check (opening_meter >= 0),
    closing_meter numeric not null,
    price_per_liter numeric not null check (price_per_liter >= 0),
    cost_per_liter numeric not null default 0,  -- weighted average cost snapshot
    liters_sold numeric generated always as (closing_meter - opening_meter) stored,
    sales_amount numeric generated always as (round((closing_meter - opening_meter) * price_per_liter, 2)) stored,
    reading_date date default current_date,     -- set to the shift date by trigger
    recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone default now(),
    constraint pump_readings_closing_after_opening check (closing_meter >= opening_meter),
    unique (shift_id, pump_number)
);

create index pump_readings_reading_date_idx on public.pump_readings (reading_date);
create index pump_readings_tank_date_idx on public.pump_readings (tank_id, reading_date);
create index shifts_shift_date_idx on public.shifts (shift_date);

-- ---------------------------------------------------------------------------
-- Dry stock (shop & lubricants)
-- ---------------------------------------------------------------------------

-- 3. Shop Inventory (Dry Stock)
create table public.shop_inventory (
    id uuid primary key default gen_random_uuid(),
    item_name text not null,
    sku text unique not null,
    category text not null default 'Lubricants',
    -- Changed only by restocks and sales.
    quantity_in_stock int not null default 0 check (quantity_in_stock >= 0),
    cost_price numeric not null check (cost_price >= 0), -- weighted average cost
    selling_price numeric not null check (selling_price >= 0),
    reorder_threshold int not null default 0 check (reorder_threshold >= 0),
    is_active boolean not null default true,
    updated_at timestamp with time zone not null default now()
);

create table public.shop_sales (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.shop_inventory (id),
    quantity int not null check (quantity > 0),
    unit_price numeric not null check (unit_price >= 0),
    unit_cost numeric not null default 0, -- cost snapshot, set by trigger
    total_amount numeric generated always as (round(quantity * unit_price, 2)) stored,
    payment_method text not null default 'CASH' check (payment_method in ('CASH', 'BANK', 'CREDIT')),
    sale_date date not null default current_date,
    journal_entry_id uuid,
    recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone not null default now()
);

create table public.shop_restocks (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.shop_inventory (id),
    quantity int not null check (quantity > 0),
    unit_cost numeric not null check (unit_cost >= 0),
    total_cost numeric generated always as (round(quantity * unit_cost, 2)) stored,
    supplier text,
    payment_method text not null default 'CASH' check (payment_method in ('CASH', 'BANK', 'CREDIT')),
    restock_date date not null default current_date,
    journal_entry_id uuid,
    recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone not null default now()
);

create index shop_sales_sale_date_idx on public.shop_sales (sale_date);

-- ---------------------------------------------------------------------------
-- Accounting
-- ---------------------------------------------------------------------------

create table public.accounts (
    code text primary key,
    name text not null,
    account_type text not null
        check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
    -- Where the account lands on the profit & loss statement (null = balance sheet).
    report_group text check (report_group in ('REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME'))
);

-- Maps the user-facing categories of the cash book onto ledger accounts.
create table public.transaction_categories (
    name text primary key,
    transaction_type text not null check (transaction_type in ('INCOME', 'EXPENSE')),
    account_code text not null references public.accounts (code),
    description text,
    is_active boolean not null default true
);

-- 4. Financial Transactions & Ledger
-- The cash book: money in / money out entered by managers. Every row is
-- posted to the double-entry journal automatically.
create table public.financial_transactions (
    id uuid primary key default gen_random_uuid(),
    transaction_date date not null default current_date,
    category text not null references public.transaction_categories (name) on update cascade,
    amount numeric not null check (amount > 0),
    transaction_type text not null check (transaction_type in ('INCOME', 'EXPENSE')),
    -- CREDIT = on account (receivable for income, payable for expenses).
    payment_method text not null default 'CASH' check (payment_method in ('CASH', 'BANK', 'CREDIT')),
    description text,
    recorded_by text,
    created_by uuid references public.profiles (id) on delete set null default auth.uid(),
    journal_entry_id uuid,
    created_at timestamp with time zone not null default now()
);

create index financial_transactions_date_idx on public.financial_transactions (transaction_date);

create table public.journal_entries (
    id uuid primary key default gen_random_uuid(),
    entry_date date not null,
    description text not null,
    source_type text not null check (source_type in (
        'SHIFT', 'FUEL_DELIVERY', 'TANK_DIP', 'SHOP_SALE', 'SHOP_RESTOCK',
        'TRANSACTION', 'OPENING_BALANCE'
    )),
    source_id uuid,
    created_by uuid references public.profiles (id) on delete set null default auth.uid(),
    created_at timestamp with time zone not null default now()
);

create table public.journal_lines (
    id bigint generated always as identity primary key,
    entry_id uuid not null references public.journal_entries (id) on delete cascade,
    account_code text not null references public.accounts (code),
    debit numeric(14, 2) not null default 0 check (debit >= 0),
    credit numeric(14, 2) not null default 0 check (credit >= 0),
    memo text,
    constraint journal_lines_one_side check ((debit > 0 and credit = 0) or (debit = 0 and credit > 0))
);

create index journal_entries_entry_date_idx on public.journal_entries (entry_date);
create index journal_entries_source_idx on public.journal_entries (source_type, source_id);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account_code);

-- Link source documents to the journal entry they generated.
alter table public.shifts
    add constraint shifts_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;
alter table public.tank_dips
    add constraint tank_dips_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;
alter table public.fuel_deliveries
    add constraint fuel_deliveries_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;
alter table public.shop_sales
    add constraint shop_sales_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;
alter table public.shop_restocks
    add constraint shop_restocks_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;
alter table public.financial_transactions
    add constraint financial_transactions_journal_entry_fk foreign key (journal_entry_id)
    references public.journal_entries (id) on delete set null;

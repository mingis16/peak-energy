-- Station customisation and access by role.
--
-- Stations differ in how they run shifts, how customers pay, what they sell
-- besides fuel and how tightly they control staff. These are now settings:
-- the owner answers them in the setup questions on first sign-in and can
-- change them later in Settings. Only the owner changes them.
--
--   * shifts carry the station's own names (Day/Night, Morning/Afternoon/Night…)
--     and the owner decides whether attendants open their own;
--   * credit customers and bank/mobile money can each be switched off, and
--     digital payments named ("Orange Money");
--   * the bar module holds whatever the station sells besides fuel: it can be
--     renamed (a shop, a lubricants counter…), given its own categories, or
--     switched off;
--   * the owner sets how far from today attendants may date records and
--     whether they may record closing dips;
--   * unused fuels can be removed, and the owner adds cash-book categories.
--
-- Access by role: attendants never see the cash book, the accounts or the
-- activity log. Managers see the cash book and the accounts (profit, ledger,
-- balances) only if the owner allows it; meter corrections are the owner's.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

alter table public.station_settings
    -- Null until the owner has been through the setup questions.
    add column setup_completed_at timestamp with time zone,
    add column shift_names text[] not null default '{Morning,Afternoon,Night,Full day}',
    add column attendants_open_shifts boolean not null default true,
    add column accepts_customer_credit boolean not null default true,
    add column accepts_digital_payments boolean not null default true,
    add column digital_payments_label text not null default 'Bank / mobile money',
    -- The bar module: what the station sells besides fuel, and what it calls it.
    add column bar_enabled boolean not null default true,
    add column bar_name text not null default 'Shop',
    add column bar_item_label text not null default 'item', -- one thing sold, e.g. 'drink'
    add column bar_categories text[] not null default '{Drinks,Snacks,Lubricants,Car care,Other}',
    -- Attendants may date shifts, sales and dips this many days either side of today.
    add column attendant_date_window_days int not null default 1
        check (attendant_date_window_days between 0 and 7),
    add column attendants_record_closing_dips boolean not null default false,
    add column managers_view_finances boolean not null default false,
    add column managers_use_cash_book boolean not null default false;

-- A station already in use was set up before these settings existed, as a
-- club bar; its owner is not sent through the setup questions. Triggers are
-- off so this does not show in the activity log as somebody's change.
alter table public.station_settings disable trigger user;
update public.station_settings
set setup_completed_at = now(),
    bar_name = 'Bar',
    bar_item_label = 'drink',
    bar_categories = '{Beer,Ciders,Malt drinks,Soft drinks,Energy drinks,Water,Spirits,Wine & champagne,Snacks,Other}'
where exists (select 1 from public.tanks)
   or exists (select 1 from public.pumps)
   or exists (select 1 from public.shifts)
   or exists (select 1 from public.bar_inventory);
alter table public.station_settings enable trigger user;

-- Trims a list a person typed: drops blanks and repeats (ignoring case) and
-- keeps the order.
create or replace function public.clean_list(p_items text[])
returns text[]
language sql immutable
as $$
    select coalesce(array_agg(item order by first_seen), '{}')
    from (
        select (array_agg(item order by ord))[1] as item, min(ord) as first_seen
        from (
            select regexp_replace(btrim(x), '\s+', ' ', 'g') as item, ord
            from unnest(p_items) with ordinality as u (x, ord)
        ) typed
        where item <> ''
        group by lower(item)
    ) kept
$$;

-- Only the owner changes how the station is set up. Tolerances and controls
-- in particular can hide shortages and losses.
create or replace function public.station_settings_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if auth.uid() is not null and not public.is_owner() then
        raise exception 'Only the owner can change the station settings.';
    end if;

    new.station_name := btrim(new.station_name);
    if new.station_name = '' then
        raise exception 'Enter the station''s name.';
    end if;

    new.shift_names := public.clean_list(new.shift_names);
    if cardinality(new.shift_names) = 0 then
        raise exception 'The station needs at least one shift.';
    end if;
    if cardinality(new.shift_names) > 6 or exists (select 1 from unnest(new.shift_names) n where length(n) > 30) then
        raise exception 'Use at most 6 shifts, with names of up to 30 characters.';
    end if;

    new.digital_payments_label := btrim(new.digital_payments_label);
    if new.digital_payments_label = '' then
        raise exception 'Name the bank or mobile money payments, for example "Orange Money".';
    end if;

    new.bar_name := regexp_replace(btrim(new.bar_name), '\s+', ' ', 'g');
    new.bar_item_label := lower(regexp_replace(btrim(new.bar_item_label), '\s+', ' ', 'g'));
    if new.bar_name = '' or new.bar_item_label = '' then
        raise exception 'Name what you sell besides fuel, and what one thing sold is called (for example "drink").';
    end if;
    if length(new.bar_name) > 30 or length(new.bar_item_label) > 20 then
        raise exception 'Keep the name to 30 characters and the word for one thing sold to 20.';
    end if;
    new.bar_categories := public.clean_list(new.bar_categories);
    return new;
end;
$$;

-- The bar's ledger accounts, and the cash-book category for paying its
-- suppliers, carry its name.
create or replace function public.rename_bar_accounts(p_old_name text, p_new_name text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    update public.accounts set name = format('%s Inventory', p_new_name) where code = '1210';
    update public.accounts set name = format('%s Sales', p_new_name) where code = '4010';
    update public.accounts set name = format('Cost of %s Sales', p_new_name) where code = '5010';

    -- Entries already in the cash book follow through the key's on-update cascade.
    update public.transaction_categories
    set name = format('%s Supplier Payment', p_new_name),
        description = format('Payment to a supplier for %s stock bought on credit.', p_new_name)
    where name = format('%s Supplier Payment', p_old_name)
      and not exists (
          select 1 from public.transaction_categories where name = format('%s Supplier Payment', p_new_name));
end;
$$;

create or replace function public.station_settings_after_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.bar_name is distinct from old.bar_name then
        perform public.rename_bar_accounts(old.bar_name, new.bar_name);
    end if;
    return null;
end;
$$;

create trigger station_settings_after_update
    after update on public.station_settings
    for each row execute function public.station_settings_after_update();

-- A new station's bar starts with the generic name.
select public.rename_bar_accounts('Bar', bar_name) from public.station_settings;

revoke update on public.station_settings from authenticated;
grant update (
    station_name, currency_code, shortage_tolerance, dip_variance_tolerance_percent,
    setup_completed_at, shift_names, attendants_open_shifts,
    accepts_customer_credit, accepts_digital_payments, digital_payments_label,
    bar_enabled, bar_name, bar_item_label, bar_categories,
    attendant_date_window_days, attendants_record_closing_dips,
    managers_view_finances, managers_use_cash_book
) on public.station_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

alter table public.shifts drop constraint shifts_shift_label_check;
alter table public.shifts add constraint shifts_shift_label_check
    check (btrim(shift_label) <> '' and length(shift_label) <= 30);

-- 'Day' was shown as "Full day"; it is now stored that way, so a station can
-- call its daytime shift "Day". Triggers are off: reconciled shifts are
-- locked, and the rename is not an edit anyone made.
alter table public.shifts disable trigger user;
update public.shifts set shift_label = 'Full day' where shift_label = 'Day';
alter table public.shifts enable trigger user;

-- What the station's settings allow. Named to run before the other triggers.
create or replace function public.shifts_allowed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_settings public.station_settings%rowtype;
begin
    select * into v_settings from public.station_settings;

    if tg_op = 'INSERT' and auth.uid() is not null and not public.is_manager()
        and not v_settings.attendants_open_shifts then
        raise exception 'A manager opens shifts at this station. Ask a manager to open yours.';
    end if;

    -- Shifts already open keep their name when the station renames its shifts.
    if (tg_op = 'INSERT' or new.shift_label is distinct from old.shift_label)
        and not (new.shift_label = any (v_settings.shift_names)) then
        raise exception '"%" is not one of this station''s shifts: %.',
            new.shift_label, array_to_string(v_settings.shift_names, ', ');
    end if;

    -- A payment the station does not take stays at zero; amounts declared
    -- before it was switched off can stand.
    if not v_settings.accepts_customer_credit and new.credit_slips_amount <> 0
        and (tg_op = 'INSERT' or new.credit_slips_amount is distinct from old.credit_slips_amount) then
        raise exception 'This station does not sell on credit, so there are no credit slips to declare.';
    end if;
    if not v_settings.accepts_digital_payments and new.digital_transfers_amount <> 0
        and (tg_op = 'INSERT' or new.digital_transfers_amount is distinct from old.digital_transfers_amount) then
        raise exception 'This station does not take % payments.', v_settings.digital_payments_label;
    end if;
    return new;
end;
$$;

create trigger shifts_allowed
    before insert or update on public.shifts
    for each row execute function public.shifts_allowed();

-- ---------------------------------------------------------------------------
-- Dates and dips follow the owner's controls
-- ---------------------------------------------------------------------------

create or replace function public.assert_recent_date(p_date date, p_what text)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare
    v_days int := coalesce((select attendant_date_window_days from public.station_settings), 1);
begin
    if auth.uid() is not null and not public.is_manager()
        and p_date not between current_date - v_days and current_date + v_days then
        raise exception 'Attendants can only record % for today%. Ask a manager to record % dated %.',
            p_what,
            case when v_days = 1 then ' or a day either side'
                 when v_days > 1 then format(' or up to %s days either side', v_days)
                 else '' end,
            p_what, p_date;
    end if;
end;
$$;

-- Whoever sold from a tank should not be the one measuring what is left,
-- unless the owner allows it (a small station with one person on duty).
create or replace function public.tank_dips_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.dip_type = 'CLOSING' and auth.uid() is not null and not public.is_manager()
        and not coalesce((select attendants_record_closing_dips from public.station_settings), false) then
        raise exception 'Closing dips set the tank''s stock and show any losses, so a manager records them.';
    end if;
    perform public.assert_recent_date(new.dip_date, 'dips');
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The bar module: switched on or off, and described by its own name
-- ---------------------------------------------------------------------------

create or replace function public.bar_label()
returns text
language sql stable security definer set search_path = public
as $$
    select bar_name from public.station_settings
$$;

-- Named to run before the other triggers.
create or replace function public.bar_allowed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_settings public.station_settings%rowtype;
begin
    select * into v_settings from public.station_settings;
    if not v_settings.bar_enabled then
        raise exception 'Sales besides fuel (%) are switched off in Settings.', v_settings.bar_name;
    end if;
    if tg_table_name = 'bar_sales' then
        if new.payment_method = 'CREDIT' and not v_settings.accepts_customer_credit then
            raise exception 'This station does not sell on credit.';
        end if;
        if new.payment_method = 'BANK' and not v_settings.accepts_digital_payments then
            raise exception 'This station does not take % payments.', v_settings.digital_payments_label;
        end if;
    end if;
    return new;
end;
$$;

create trigger bar_inventory_allowed before insert on public.bar_inventory
    for each row execute function public.bar_allowed();
create trigger bar_sales_allowed before insert on public.bar_sales
    for each row execute function public.bar_allowed();
create trigger bar_restocks_allowed before insert on public.bar_restocks
    for each row execute function public.bar_allowed();

create or replace function public.bar_inventory_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_value numeric := round(new.quantity_in_stock * new.cost_price, 2);
begin
    perform public.post_journal(
        current_date,
        format('%s opening stock — %s × %s', public.bar_label(), new.quantity_in_stock, new.item_name),
        'OPENING_BALANCE', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_value),
            jsonb_build_object('account', '3000', 'amount', -v_value)
        )
    );
    return null;
end;
$$;

create or replace function public.bar_sales_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_item public.bar_inventory%rowtype;
    v_total numeric;
    v_cogs numeric;
begin
    if tg_op = 'UPDATE' then
        raise exception 'Sales cannot be edited. Delete the sale and record it again.';
    end if;

    if tg_op = 'DELETE' then
        update public.bar_inventory
        set quantity_in_stock = quantity_in_stock + old.quantity
        where id = old.item_id;
        return old;
    end if;

    select * into v_item from public.bar_inventory where id = new.item_id for update;
    if not found then
        raise exception 'Item % not found', new.item_id;
    end if;
    if not v_item.is_active then
        raise exception '"%" is no longer sold.', v_item.item_name;
    end if;
    if v_item.quantity_in_stock < new.quantity then
        raise exception 'Only % × "%" left in stock.', v_item.quantity_in_stock, v_item.item_name;
    end if;

    -- Only managers may override the menu price.
    if new.unit_price is null or not public.is_manager() then
        new.unit_price := v_item.selling_price;
    end if;
    new.unit_cost := v_item.cost_price;
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();

    update public.bar_inventory
    set quantity_in_stock = quantity_in_stock - new.quantity
    where id = new.item_id;

    v_total := round(new.quantity * new.unit_price, 2);
    v_cogs := round(new.quantity * new.unit_cost, 2);

    new.journal_entry_id := public.post_journal(
        new.sale_date,
        format('%s sale — %s × %s', public.bar_label(), new.quantity, v_item.item_name),
        'BAR_SALE', new.id,
        jsonb_build_array(
            jsonb_build_object('account', public.payment_account(new.payment_method, 'IN'), 'amount', v_total),
            jsonb_build_object('account', '4010', 'amount', -v_total),
            jsonb_build_object('account', '5010', 'amount', v_cogs),
            jsonb_build_object('account', '1210', 'amount', -v_cogs)
        )
    );
    return new;
end;
$$;

create or replace function public.bar_restocks_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_item public.bar_inventory%rowtype;
    v_total numeric;
    v_opening boolean;
begin
    if tg_op = 'UPDATE' then
        raise exception 'Restocks cannot be edited. Delete the restock and record it again.';
    end if;

    if tg_op = 'DELETE' then
        select * into v_item from public.bar_inventory where id = old.item_id for update;
        if v_item.quantity_in_stock < old.quantity then
            raise exception 'Some of this restock has already been sold, so it cannot be deleted.';
        end if;
        update public.bar_inventory
        set quantity_in_stock = quantity_in_stock - old.quantity,
            cost_price = case when quantity_in_stock - old.quantity > 0
                then greatest(round((quantity_in_stock * cost_price - old.total_cost)
                                    / (quantity_in_stock - old.quantity), 4), 0)
                else cost_price end
        where id = old.item_id;
        return old;
    end if;

    select * into v_item from public.bar_inventory where id = new.item_id for update;
    if not found then
        raise exception 'Item % not found', new.item_id;
    end if;

    v_total := round(new.quantity * new.unit_cost, 2);
    v_opening := new.payment_method = 'OPENING';

    update public.bar_inventory
    set cost_price = round((quantity_in_stock * cost_price + v_total) / (quantity_in_stock + new.quantity), 4),
        quantity_in_stock = quantity_in_stock + new.quantity
    where id = new.item_id;

    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();
    new.journal_entry_id := public.post_journal(
        new.restock_date,
        case when v_opening
            then format('%s opening stock — %s × %s', public.bar_label(), new.quantity, v_item.item_name)
            else format('%s restock — %s × %s%s', public.bar_label(), new.quantity, v_item.item_name,
                        coalesce(' from ' || nullif(new.supplier, ''), ''))
        end,
        'BAR_RESTOCK', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_total),
            jsonb_build_object('account',
                case when v_opening then '3000' else public.payment_account(new.payment_method, 'OUT') end,
                'amount', -v_total)
        )
    );
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fuels
-- ---------------------------------------------------------------------------

-- A fuel the station does not sell can go, as long as no tank holds it and
-- none has been sold.
create or replace function public.remove_fuel_product(p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a fuel.';
    end if;
    if exists (select 1 from public.tanks where fuel_type = p_code) then
        raise exception 'Tanks hold %, so it cannot be removed. Remove those tanks or change their fuel first.', p_code;
    end if;
    if exists (select 1 from public.pump_readings where fuel_type = p_code) then
        raise exception '% has been sold, so it stays in the records.', p_code;
    end if;
    delete from public.fuel_price_history where fuel_type = p_code;
    delete from public.fuel_products where code = p_code;
    if not found then
        raise exception 'Fuel % not found.', p_code;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cash-book categories
-- ---------------------------------------------------------------------------

alter table public.transaction_categories add constraint transaction_categories_name_check
    check (btrim(name) <> '');

-- Adds a cash-book category. Without an account it gets its own line on the
-- profit & loss: an operating expense (6000–6890) or other income (4900–4990).
create or replace function public.add_cash_category(
    p_name text,
    p_type text,
    p_description text default null,
    p_account_code text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
    v_code text := p_account_code;
    v_low int;
    v_high int;
begin
    if not public.is_owner() then
        raise exception 'Only the owner can add cash-book categories.';
    end if;
    if v_name = '' then
        raise exception 'Enter a name for the category.';
    end if;
    if p_type is null or p_type not in ('INCOME', 'EXPENSE') then
        raise exception 'Choose whether the category is money in or money out.';
    end if;
    if exists (select 1 from public.transaction_categories where lower(name) = lower(v_name)) then
        raise exception 'There is already a category called "%".', v_name;
    end if;

    if v_code is null then
        if p_type = 'EXPENSE' then
            v_low := 6000; v_high := 6890;
        else
            v_low := 4900; v_high := 4990;
        end if;
        -- The next free number after the last one in use, then any gap.
        select c::text into v_code
        from generate_series(v_low, v_high, 10) c
        where not exists (select 1 from public.accounts where code = c::text)
        order by c <= coalesce((select max(code::int) from public.accounts
                                where code ~ '^[0-9]+$' and code::int between v_low and v_high), v_low), c
        limit 1;
        if v_code is null then
            raise exception 'There is no room for another account of this kind. Post the category to an existing account instead.';
        end if;
        insert into public.accounts (code, name, account_type, report_group)
        values (v_code, v_name,
                case p_type when 'EXPENSE' then 'EXPENSE' else 'INCOME' end,
                case p_type when 'EXPENSE' then 'OPEX' else 'OTHER_INCOME' end);
    elsif not exists (select 1 from public.accounts where code = v_code) then
        raise exception 'Unknown account %.', v_code;
    end if;

    insert into public.transaction_categories (name, transaction_type, account_code, description)
    values (v_name, p_type, v_code, nullif(btrim(coalesce(p_description, '')), ''));
end;
$$;

-- A category with a ledger account of its own keeps the account's name in step.
create or replace function public.transaction_categories_after_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.name <> old.name then
        update public.accounts a set name = new.name
        where a.code = new.account_code
          and a.name = old.name
          and not exists (
              select 1 from public.transaction_categories c
              where c.account_code = a.code and c.name <> new.name);
    end if;
    return null;
end;
$$;

create trigger transaction_categories_after_update
    after update on public.transaction_categories
    for each row execute function public.transaction_categories_after_update();

create trigger transaction_categories_audit after insert or update or delete on public.transaction_categories
    for each row execute function public.audit_row();

-- Categories are added through add_cash_category; the type and account never change.
drop policy "transaction_categories_insert" on public.transaction_categories;
revoke insert, update on public.transaction_categories from authenticated;
grant update (name, description, is_active) on public.transaction_categories to authenticated;

-- ---------------------------------------------------------------------------
-- Access by role
-- ---------------------------------------------------------------------------

-- Profit, the ledger and balances: the owner, and managers if the owner allows.
create or replace function public.can_view_finances()
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.is_owner()
        or (public.is_manager() and coalesce((select managers_view_finances from public.station_settings), false))
$$;

-- Recording money in and out: the owner, and managers if the owner allows.
create or replace function public.can_use_cash_book()
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.is_owner()
        or (public.is_manager() and coalesce((select managers_use_cash_book from public.station_settings), false))
$$;

drop policy "accounts_select" on public.accounts;
create policy "accounts_select" on public.accounts for select to authenticated
    using (public.can_view_finances());

drop policy "transaction_categories_select" on public.transaction_categories;
drop policy "transaction_categories_update" on public.transaction_categories;
create policy "transaction_categories_select" on public.transaction_categories for select to authenticated
    using (public.can_use_cash_book() or public.can_view_finances());
create policy "transaction_categories_update" on public.transaction_categories for update to authenticated
    using (public.is_owner()) with check (public.is_owner());

drop policy "financial_transactions_select" on public.financial_transactions;
drop policy "financial_transactions_insert" on public.financial_transactions;
drop policy "financial_transactions_update" on public.financial_transactions;
drop policy "financial_transactions_delete" on public.financial_transactions;
create policy "financial_transactions_select" on public.financial_transactions for select to authenticated
    using (public.can_use_cash_book() or public.can_view_finances());
create policy "financial_transactions_insert" on public.financial_transactions for insert to authenticated
    with check (public.can_use_cash_book());
create policy "financial_transactions_update" on public.financial_transactions for update to authenticated
    using (public.can_use_cash_book()) with check (public.can_use_cash_book());
create policy "financial_transactions_delete" on public.financial_transactions for delete to authenticated
    using (public.can_use_cash_book());

drop policy "journal_entries_select" on public.journal_entries;
drop policy "journal_lines_select" on public.journal_lines;
create policy "journal_entries_select" on public.journal_entries for select to authenticated
    using (public.can_view_finances());
create policy "journal_lines_select" on public.journal_lines for select to authenticated
    using (public.can_view_finances());

drop policy "meter_corrections_select" on public.meter_corrections;
create policy "meter_corrections_select" on public.meter_corrections for select to authenticated
    using (public.is_owner());

-- Live figures for the dashboard. Costs and profit are left out for anyone
-- who may not see the accounts.
create or replace function public.get_dashboard_kpis(p_date date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
    with fuel as (
        select coalesce(sum(liters_sold), 0) as liters,
               coalesce(sum(sales_amount), 0) as sales,
               coalesce(round(sum(liters_sold * cost_per_liter), 2), 0) as cogs
        from public.pump_readings where reading_date = p_date
    ),
    fuel_by_type as (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'fuel_type', fuel_type, 'liters', liters, 'sales', sales) order by fuel_type), '[]'::jsonb) as items
        from (
            select fuel_type, sum(liters_sold) as liters, sum(sales_amount) as sales
            from public.pump_readings where reading_date = p_date
            group by fuel_type
        ) x
    ),
    handover as (
        select count(*) as shifts,
               coalesce(sum(cash_on_hand + credit_slips_amount + digital_transfers_amount), 0) as collected,
               coalesce(sum(cash_on_hand), 0) as cash,
               coalesce(sum(credit_slips_amount), 0) as credit,
               coalesce(sum(digital_transfers_amount), 0) as digital,
               coalesce(sum(expected_sales), 0) as expected,
               coalesce(sum(variance), 0) as variance
        from public.shifts where shift_date = p_date and status <> 'OPEN'
    ),
    shift_counts as (
        select count(*) filter (where s.status = 'OPEN') as open,
               count(*) filter (where s.status = 'SUBMITTED') as awaiting_review,
               count(*) filter (where s.status = 'RECONCILED') as reconciled,
               count(*) filter (where s.status <> 'OPEN' and s.variance < -st.shortage_tolerance) as short
        from public.shifts s cross join public.station_settings st
        where s.shift_date = p_date
    ),
    open_sales as (
        select coalesce(sum(r.sales_amount), 0) as amount
        from public.pump_readings r join public.shifts s on s.id = r.shift_id
        where s.shift_date = p_date and s.status = 'OPEN'
    ),
    bar as (
        select coalesce(sum(total_amount), 0) as sales,
               coalesce(round(sum(quantity * unit_cost), 2), 0) as cogs
        from public.bar_sales where sale_date = p_date
    ),
    ledger as (
        select coalesce(sum(jl.debit - jl.credit) filter (where a.report_group = 'OPEX'), 0) as opex,
               coalesce(sum(jl.credit - jl.debit) filter (where a.report_group = 'OTHER_INCOME'), 0) as other_income,
               coalesce(sum(jl.debit - jl.credit) filter (where a.code = '5100'), 0) as stock_loss
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.entry_id
        join public.accounts a on a.code = jl.account_code
        -- Shift postings are represented live by meter readings and handovers.
        where je.entry_date = p_date and je.source_type <> 'SHIFT'
    ),
    tanks as (
        select count(*) filter (where stock_status <> 'OK') as low,
               count(*) as total
        from public.v_tank_status where is_active
    ),
    bar_stock as (
        select count(*) filter (where stock_status <> 'OK') as low
        from public.v_bar_stock where is_active
    ),
    viewer as (
        select public.can_view_finances() as finances
    )
    select jsonb_build_object(
        'date', p_date,
        'fuel_liters', fuel.liters,
        'fuel_sales', fuel.sales,
        'fuel_cogs', case when viewer.finances then fuel.cogs end,
        'fuel_by_type', fuel_by_type.items,
        'bar_sales', bar.sales,
        'bar_cogs', case when viewer.finances then bar.cogs end,
        'stock_loss', case when viewer.finances then ledger.stock_loss end,
        'gross_profit', case when viewer.finances
            then fuel.sales + bar.sales - fuel.cogs - bar.cogs - ledger.stock_loss end,
        'operating_expenses', case when viewer.finances then ledger.opex end,
        'other_income', case when viewer.finances then ledger.other_income end,
        'cash_variance', handover.variance,
        'net_profit', case when viewer.finances
            then fuel.sales + bar.sales - fuel.cogs - bar.cogs - ledger.stock_loss
                 - ledger.opex + ledger.other_income + handover.variance end,
        'handover', jsonb_build_object(
            'shifts', handover.shifts,
            'collected', handover.collected,
            'cash', handover.cash,
            'credit', handover.credit,
            'digital', handover.digital,
            'expected', handover.expected,
            'variance', handover.variance),
        'open_shift_sales', open_sales.amount,
        'shifts', jsonb_build_object(
            'open', shift_counts.open,
            'awaiting_review', shift_counts.awaiting_review,
            'reconciled', shift_counts.reconciled,
            'short', shift_counts.short),
        'tanks_low', tanks.low,
        'tanks_total', tanks.total,
        'bar_items_low', bar_stock.low
    )
    from fuel, fuel_by_type, handover, shift_counts, open_sales, bar, ledger, tanks, bar_stock, viewer
$$;

-- Daily sales for charts; gross profit only for those who may see the accounts.
create or replace function public.get_daily_trend(p_from date, p_to date)
returns table (day date, fuel_liters numeric, fuel_sales numeric, bar_sales numeric, gross_profit numeric)
language sql stable security invoker set search_path = public
as $$
    select d::date,
           coalesce(f.liters, 0),
           coalesce(f.sales, 0),
           coalesce(b.sales, 0),
           case when public.can_view_finances()
               then coalesce(f.sales, 0) - coalesce(f.cogs, 0) + coalesce(b.sales, 0) - coalesce(b.cogs, 0) end
    from generate_series(p_from, p_to, interval '1 day') d
    left join (
        select reading_date, sum(liters_sold) as liters, sum(sales_amount) as sales,
               round(sum(liters_sold * cost_per_liter), 2) as cogs
        from public.pump_readings
        where reading_date between p_from and p_to
        group by reading_date
    ) f on f.reading_date = d::date
    left join (
        select sale_date, sum(total_amount) as sales, round(sum(quantity * unit_cost), 2) as cogs
        from public.bar_sales
        where sale_date between p_from and p_to
        group by sale_date
    ) b on b.sale_date = d::date
    order by 1
$$;

-- ---------------------------------------------------------------------------
-- Privileges: new functions start out executable by everyone
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
    public.current_app_role(),
    public.is_owner(),
    public.is_manager(),
    public.is_staff(),
    public.can_view_finances(),
    public.can_use_cash_book(),
    public.get_profit_and_loss(date, date),
    public.get_trial_balance(date),
    public.get_dashboard_kpis(date),
    public.get_daily_trend(date, date),
    public.tank_has_activity(uuid),
    public.pump_has_readings(text),
    public.update_tank_stock(uuid, text, numeric),
    public.set_pump_meter(uuid, numeric, text),
    public.remove_tank(uuid),
    public.remove_pump(uuid),
    public.remove_fuel_product(text),
    public.add_cash_category(text, text, text, text)
to authenticated;

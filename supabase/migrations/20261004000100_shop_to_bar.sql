-- The station runs a nightclub bar, not a lubricants shop, so dry stock
-- becomes bar stock. Tables, accounts and journal source types are renamed in
-- place: existing items, sales, restocks and their postings carry over.

-- ---------------------------------------------------------------------------
-- Tables and the names derived from them
-- ---------------------------------------------------------------------------

alter table public.shop_inventory rename to bar_inventory;
alter table public.shop_sales rename to bar_sales;
alter table public.shop_restocks rename to bar_restocks;
alter view public.v_shop_stock rename to v_bar_stock;

alter table public.bar_inventory alter column category set default 'Beer';

-- Constraints, indexes and policies still named shop_*.
do $$
declare
    r record;
begin
    for r in
        select conrelid::regclass as tbl, conname from pg_constraint
        where connamespace = 'public'::regnamespace and conname like 'shop\_%'
    loop
        execute format('alter table %s rename constraint %I to %I',
                       r.tbl, r.conname, 'bar_' || substr(r.conname, 6));
    end loop;

    for r in
        select indexname from pg_indexes
        where schemaname = 'public' and indexname like 'shop\_%'
    loop
        execute format('alter index public.%I rename to %I',
                       r.indexname, 'bar_' || substr(r.indexname, 6));
    end loop;

    for r in
        select tablename, policyname from pg_policies
        where schemaname = 'public' and policyname like 'shop\_%'
    loop
        execute format('alter policy %I on public.%I rename to %I',
                       r.policyname, r.tablename, 'bar_' || substr(r.policyname, 6));
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger: accounts, cash-book categories and journal source types
-- ---------------------------------------------------------------------------

update public.accounts set name = 'Bar Inventory' where code = '1210';
update public.accounts set name = 'Bar Sales' where code = '4010';
update public.accounts set name = 'Cost of Bar Sales' where code = '5010';

-- Cash-book entries follow the new name through their on-update-cascade key.
update public.transaction_categories
set name = 'Bar Supplier Payment',
    description = 'Payment to a drinks supplier for bar stock bought on credit.'
where name = 'Shop Supplier Payment';

update public.transaction_categories
set description = 'Income that is not fuel or bar sales (e.g. car wash, rentals).'
where name = 'Other Income'
  and description = 'Income that is not fuel or shop sales (e.g. car wash, rentals).';

alter table public.journal_entries drop constraint journal_entries_source_type_check;
update public.journal_entries set source_type = 'BAR_SALE' where source_type = 'SHOP_SALE';
update public.journal_entries set source_type = 'BAR_RESTOCK' where source_type = 'SHOP_RESTOCK';
alter table public.journal_entries add constraint journal_entries_source_type_check check (source_type in (
    'SHIFT', 'FUEL_DELIVERY', 'TANK_DIP', 'BAR_SALE', 'BAR_RESTOCK',
    'TRANSACTION', 'OPENING_BALANCE'
));

-- ---------------------------------------------------------------------------
-- Bar: opening stock, sales and restocks
-- ---------------------------------------------------------------------------

drop trigger shop_inventory_after_insert on public.bar_inventory;
drop trigger shop_sales_before_write on public.bar_sales;
drop trigger shop_restocks_before_write on public.bar_restocks;
drop function public.shop_inventory_after_insert();
drop function public.shop_sales_before_write();
drop function public.shop_restocks_before_write();

alter trigger shop_inventory_touch on public.bar_inventory rename to bar_inventory_touch;
alter trigger shop_sales_cleanup_journal on public.bar_sales rename to bar_sales_cleanup_journal;
alter trigger shop_restocks_cleanup_journal on public.bar_restocks rename to bar_restocks_cleanup_journal;

create or replace function public.bar_inventory_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_value numeric := round(new.quantity_in_stock * new.cost_price, 2);
begin
    perform public.post_journal(
        current_date,
        format('Opening bar stock — %s × %s', new.quantity_in_stock, new.item_name),
        'OPENING_BALANCE', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_value),
            jsonb_build_object('account', '3000', 'amount', -v_value)
        )
    );
    return null;
end;
$$;

create trigger bar_inventory_after_insert
    after insert on public.bar_inventory
    for each row execute function public.bar_inventory_after_insert();

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
        raise exception 'Bar sales cannot be edited. Delete the sale and record it again.';
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
        format('Bar sale — %s × %s', new.quantity, v_item.item_name),
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

create trigger bar_sales_before_write
    before insert or update or delete on public.bar_sales
    for each row execute function public.bar_sales_before_write();

create or replace function public.bar_restocks_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_item public.bar_inventory%rowtype;
    v_total numeric;
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

    update public.bar_inventory
    set cost_price = round((quantity_in_stock * cost_price + v_total) / (quantity_in_stock + new.quantity), 4),
        quantity_in_stock = quantity_in_stock + new.quantity
    where id = new.item_id;

    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();
    new.journal_entry_id := public.post_journal(
        new.restock_date,
        format('Bar restock — %s × %s%s', new.quantity, v_item.item_name,
               coalesce(' from ' || nullif(new.supplier, ''), '')),
        'BAR_RESTOCK', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_total),
            jsonb_build_object('account', public.payment_account(new.payment_method, 'OUT'), 'amount', -v_total)
        )
    );
    return new;
end;
$$;

create trigger bar_restocks_before_write
    before insert or update or delete on public.bar_restocks
    for each row execute function public.bar_restocks_before_write();

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

-- Live figures for the owner/manager dashboard. Fuel sales come straight
-- from meter readings (including shifts still open), so the numbers move as
-- attendants work. Once every shift is reconciled they match the posted P&L.
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
    )
    select jsonb_build_object(
        'date', p_date,
        'fuel_liters', fuel.liters,
        'fuel_sales', fuel.sales,
        'fuel_cogs', fuel.cogs,
        'fuel_by_type', fuel_by_type.items,
        'bar_sales', bar.sales,
        'bar_cogs', bar.cogs,
        'stock_loss', ledger.stock_loss,
        'gross_profit', fuel.sales + bar.sales - fuel.cogs - bar.cogs - ledger.stock_loss,
        'operating_expenses', ledger.opex,
        'other_income', ledger.other_income,
        'cash_variance', handover.variance,
        'net_profit', fuel.sales + bar.sales - fuel.cogs - bar.cogs - ledger.stock_loss
                      - ledger.opex + ledger.other_income + handover.variance,
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
    from fuel, fuel_by_type, handover, shift_counts, open_sales, bar, ledger, tanks, bar_stock
$$;

-- The output column changes name, so the function is recreated.
drop function public.get_daily_trend(date, date);

-- Daily sales and gross profit for charts, one row per day (gaps filled).
create function public.get_daily_trend(p_from date, p_to date)
returns table (day date, fuel_liters numeric, fuel_sales numeric, bar_sales numeric, gross_profit numeric)
language sql stable security invoker set search_path = public
as $$
    select d::date,
           coalesce(f.liters, 0),
           coalesce(f.sales, 0),
           coalesce(b.sales, 0),
           coalesce(f.sales, 0) - coalesce(f.cogs, 0) + coalesce(b.sales, 0) - coalesce(b.cogs, 0)
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
    public.get_profit_and_loss(date, date),
    public.get_trial_balance(date),
    public.get_dashboard_kpis(date),
    public.get_daily_trend(date, date)
to authenticated;

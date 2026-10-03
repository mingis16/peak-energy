-- Reporting views and RPCs. Views run with the caller's permissions
-- (security_invoker), so row level security still applies.

create view public.v_tank_status with (security_invoker = true) as
select
    t.id,
    t.tank_name,
    t.fuel_type,
    fp.name as fuel_name,
    t.capacity_liters,
    t.current_volume,
    t.reorder_level_liters,
    t.is_active,
    t.updated_at,
    round(100 * t.current_volume / t.capacity_liters, 1) as fill_percent,
    t.capacity_liters - t.current_volume as ullage_liters,
    case
        when t.current_volume <= t.reorder_level_liters * 0.5 then 'CRITICAL'
        when t.current_volume <= t.reorder_level_liters then 'LOW'
        else 'OK'
    end as stock_status,
    round(t.current_volume * fp.avg_cost_per_liter, 2) as stock_value,
    round(coalesce(s.liters_7d, 0) / 7, 1) as avg_daily_sales_liters,
    case when coalesce(s.liters_7d, 0) > 0 then round(t.current_volume / (s.liters_7d / 7), 1) end as days_of_cover
from public.tanks t
join public.fuel_products fp on fp.code = t.fuel_type
left join lateral (
    select sum(r.liters_sold) as liters_7d
    from public.pump_readings r
    where r.tank_id = t.id and r.reading_date > current_date - 7
) s on true;

create view public.v_shift_summary with (security_invoker = true) as
select
    s.id,
    s.shift_date,
    s.shift_label,
    s.attendant_id,
    coalesce(nullif(p.full_name, ''), p.email) as attendant_name,
    s.status,
    s.cash_on_hand,
    s.credit_slips_amount,
    s.digital_transfers_amount,
    s.cash_on_hand + s.credit_slips_amount + s.digital_transfers_amount as total_collected,
    coalesce(s.expected_liters, r.liters, 0) as liters_sold,
    coalesce(s.expected_sales, r.amount, 0) as expected_sales,
    s.variance,
    coalesce(s.status <> 'OPEN' and s.variance < -st.shortage_tolerance, false) as is_short,
    coalesce(r.reading_count, 0) as reading_count,
    s.notes,
    s.opened_at,
    s.submitted_at,
    s.reconciled_at,
    s.journal_entry_id
from public.shifts s
join public.profiles p on p.id = s.attendant_id
cross join public.station_settings st
left join lateral (
    select sum(liters_sold) as liters, sum(sales_amount) as amount, count(*) as reading_count
    from public.pump_readings
    where shift_id = s.id
) r on true;

-- Daily wet-stock reconciliation per tank:
-- opening dip (or previous closing dip) + deliveries − meter sales = expected closing,
-- compared with the physical closing dip.
create view public.v_wetstock_daily with (security_invoker = true) as
with days as (
    select tank_id, dip_date as day from public.tank_dips
    union
    select tank_id, reading_date from public.pump_readings where tank_id is not null
    union
    select tank_id, delivery_date from public.fuel_deliveries
)
select
    d.tank_id,
    t.tank_name,
    t.fuel_type,
    d.day,
    coalesce(od.volume_liters, prev.volume_liters) as opening_stock,
    case when od.volume_liters is not null then 'OPENING_DIP'
         when prev.volume_liters is not null then 'PREVIOUS_CLOSING_DIP' end as opening_source,
    coalesce(del.liters, 0) as deliveries_liters,
    coalesce(sales.liters, 0) as meter_sales_liters,
    coalesce(od.volume_liters, prev.volume_liters) + coalesce(del.liters, 0) - coalesce(sales.liters, 0)
        as expected_closing,
    cd.volume_liters as closing_dip,
    cd.volume_liters
        - (coalesce(od.volume_liters, prev.volume_liters) + coalesce(del.liters, 0) - coalesce(sales.liters, 0))
        as variance_liters,
    round(100 * (cd.volume_liters
        - (coalesce(od.volume_liters, prev.volume_liters) + coalesce(del.liters, 0) - coalesce(sales.liters, 0)))
        / nullif(sales.liters, 0), 2) as variance_percent_of_sales
from days d
join public.tanks t on t.id = d.tank_id
left join public.tank_dips od
    on od.tank_id = d.tank_id and od.dip_date = d.day and od.dip_type = 'OPENING'
left join public.tank_dips cd
    on cd.tank_id = d.tank_id and cd.dip_date = d.day and cd.dip_type = 'CLOSING'
left join lateral (
    select volume_liters from public.tank_dips
    where tank_id = d.tank_id and dip_type = 'CLOSING' and dip_date < d.day
    order by dip_date desc
    limit 1
) prev on true
left join lateral (
    select sum(received_liters) as liters from public.fuel_deliveries
    where tank_id = d.tank_id and delivery_date = d.day
) del on true
left join lateral (
    select sum(liters_sold) as liters from public.pump_readings
    where tank_id = d.tank_id and reading_date = d.day
) sales on true;

create view public.v_shop_stock with (security_invoker = true) as
select
    i.id,
    i.item_name,
    i.sku,
    i.category,
    i.quantity_in_stock,
    i.cost_price,
    i.selling_price,
    i.reorder_threshold,
    i.is_active,
    i.updated_at,
    round(i.quantity_in_stock * i.cost_price, 2) as stock_value,
    round(i.selling_price - i.cost_price, 2) as unit_margin,
    case
        when i.quantity_in_stock = 0 then 'OUT'
        when i.quantity_in_stock <= i.reorder_threshold then 'LOW'
        else 'OK'
    end as stock_status
from public.shop_inventory i;

create view public.v_ledger with (security_invoker = true) as
select
    jl.id as line_id,
    je.id as entry_id,
    je.entry_date,
    je.description,
    je.source_type,
    je.source_id,
    jl.account_code,
    a.name as account_name,
    a.account_type,
    a.report_group,
    jl.debit,
    jl.credit,
    jl.memo,
    je.created_at
from public.journal_lines jl
join public.journal_entries je on je.id = jl.entry_id
join public.accounts a on a.code = jl.account_code;

-- Posted profit & loss by account for a date range. Income accounts are
-- credit-positive, expense accounts debit-positive.
create or replace function public.get_profit_and_loss(p_from date, p_to date)
returns table (report_group text, account_code text, account_name text, amount numeric)
language sql stable security invoker set search_path = public
as $$
    select a.report_group, a.code, a.name,
           sum(case when a.account_type = 'INCOME' then jl.credit - jl.debit else jl.debit - jl.credit end)
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.accounts a on a.code = jl.account_code
    where a.report_group is not null
      and je.entry_date between p_from and p_to
    group by a.report_group, a.code, a.name
    order by a.code
$$;

-- Account balances up to a date. Balance is shown on the account's normal
-- side (debit for assets and expenses, credit for the rest).
create or replace function public.get_trial_balance(p_as_of date)
returns table (account_code text, account_name text, account_type text,
               total_debit numeric, total_credit numeric, balance numeric)
language sql stable security invoker set search_path = public
as $$
    select a.code, a.name, a.account_type,
           coalesce(t.debit, 0),
           coalesce(t.credit, 0),
           case when a.account_type in ('ASSET', 'EXPENSE')
                then coalesce(t.debit, 0) - coalesce(t.credit, 0)
                else coalesce(t.credit, 0) - coalesce(t.debit, 0) end
    from public.accounts a
    left join (
        select jl.account_code, sum(jl.debit) as debit, sum(jl.credit) as credit
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.entry_id
        where je.entry_date <= p_as_of
        group by jl.account_code
    ) t on t.account_code = a.code
    order by a.code
$$;

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
    shop as (
        select coalesce(sum(total_amount), 0) as sales,
               coalesce(round(sum(quantity * unit_cost), 2), 0) as cogs
        from public.shop_sales where sale_date = p_date
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
    shop_stock as (
        select count(*) filter (where stock_status <> 'OK') as low
        from public.v_shop_stock where is_active
    )
    select jsonb_build_object(
        'date', p_date,
        'fuel_liters', fuel.liters,
        'fuel_sales', fuel.sales,
        'fuel_cogs', fuel.cogs,
        'fuel_by_type', fuel_by_type.items,
        'shop_sales', shop.sales,
        'shop_cogs', shop.cogs,
        'stock_loss', ledger.stock_loss,
        'gross_profit', fuel.sales + shop.sales - fuel.cogs - shop.cogs - ledger.stock_loss,
        'operating_expenses', ledger.opex,
        'other_income', ledger.other_income,
        'cash_variance', handover.variance,
        'net_profit', fuel.sales + shop.sales - fuel.cogs - shop.cogs - ledger.stock_loss
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
        'shop_items_low', shop_stock.low
    )
    from fuel, fuel_by_type, handover, shift_counts, open_sales, shop, ledger, tanks, shop_stock
$$;

-- Daily sales and gross profit for charts, one row per day (gaps filled).
create or replace function public.get_daily_trend(p_from date, p_to date)
returns table (day date, fuel_liters numeric, fuel_sales numeric, shop_sales numeric, gross_profit numeric)
language sql stable security invoker set search_path = public
as $$
    select d::date,
           coalesce(f.liters, 0),
           coalesce(f.sales, 0),
           coalesce(s.sales, 0),
           coalesce(f.sales, 0) - coalesce(f.cogs, 0) + coalesce(s.sales, 0) - coalesce(s.cogs, 0)
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
        from public.shop_sales
        where sale_date between p_from and p_to
        group by sale_date
    ) s on s.sale_date = d::date
    order by 1
$$;

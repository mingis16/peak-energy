-- Row level security, column privileges and realtime.
--
-- Roles (profiles.role):
--   owner     — everything, including staff roles
--   manager   — operations, pricing, deliveries, accounting
--   attendant — own shifts and meter readings, tank dips, shop sales
--   pending   — signed up but not yet approved; sees only their own profile

alter table public.profiles enable row level security;
alter table public.station_settings enable row level security;
alter table public.fuel_products enable row level security;
alter table public.fuel_price_history enable row level security;
alter table public.tanks enable row level security;
alter table public.pumps enable row level security;
alter table public.tank_dips enable row level security;
alter table public.fuel_deliveries enable row level security;
alter table public.shifts enable row level security;
alter table public.pump_readings enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.shop_sales enable row level security;
alter table public.shop_restocks enable row level security;
alter table public.accounts enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

-- Profiles ------------------------------------------------------------------
create policy "profiles_select" on public.profiles for select to authenticated
    using (id = auth.uid() or public.is_staff());
create policy "profiles_update" on public.profiles for update to authenticated
    using (id = auth.uid() or public.is_owner())
    with check (id = auth.uid() or public.is_owner());

-- Settings & reference data -------------------------------------------------
create policy "station_settings_select" on public.station_settings for select to authenticated
    using (public.is_staff());
create policy "station_settings_update" on public.station_settings for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

create policy "fuel_products_select" on public.fuel_products for select to authenticated
    using (public.is_staff());
create policy "fuel_products_insert" on public.fuel_products for insert to authenticated
    with check (public.is_manager());
create policy "fuel_products_update" on public.fuel_products for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

create policy "fuel_price_history_select" on public.fuel_price_history for select to authenticated
    using (public.is_manager());

create policy "accounts_select" on public.accounts for select to authenticated
    using (public.is_manager());

create policy "transaction_categories_select" on public.transaction_categories for select to authenticated
    using (public.is_manager());
create policy "transaction_categories_insert" on public.transaction_categories for insert to authenticated
    with check (public.is_manager());
create policy "transaction_categories_update" on public.transaction_categories for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

-- Wet stock -----------------------------------------------------------------
create policy "tanks_select" on public.tanks for select to authenticated
    using (public.is_staff());
create policy "tanks_insert" on public.tanks for insert to authenticated
    with check (public.is_manager());
create policy "tanks_update" on public.tanks for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

create policy "pumps_select" on public.pumps for select to authenticated
    using (public.is_staff());
create policy "pumps_insert" on public.pumps for insert to authenticated
    with check (public.is_manager());
create policy "pumps_update" on public.pumps for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

create policy "tank_dips_select" on public.tank_dips for select to authenticated
    using (public.is_staff());
create policy "tank_dips_insert" on public.tank_dips for insert to authenticated
    with check (public.is_staff());
create policy "tank_dips_delete" on public.tank_dips for delete to authenticated
    using (public.is_manager());

create policy "fuel_deliveries_select" on public.fuel_deliveries for select to authenticated
    using (public.is_manager());
create policy "fuel_deliveries_insert" on public.fuel_deliveries for insert to authenticated
    with check (public.is_manager());
create policy "fuel_deliveries_delete" on public.fuel_deliveries for delete to authenticated
    using (public.is_manager());

-- Shifts & readings ---------------------------------------------------------
create policy "shifts_select" on public.shifts for select to authenticated
    using (public.is_manager() or attendant_id = auth.uid());
create policy "shifts_insert" on public.shifts for insert to authenticated
    with check (public.is_manager() or (public.is_staff() and attendant_id = auth.uid()));
-- Attendants may edit their own shift while it is open and hand it over;
-- the trigger enforces which status changes need a manager.
create policy "shifts_update" on public.shifts for update to authenticated
    using (public.is_manager() or (attendant_id = auth.uid() and status = 'OPEN'))
    with check (public.is_manager() or (attendant_id = auth.uid() and status in ('OPEN', 'SUBMITTED')));
create policy "shifts_delete" on public.shifts for delete to authenticated
    using (public.is_manager() or (attendant_id = auth.uid() and status = 'OPEN'));

create policy "pump_readings_select" on public.pump_readings for select to authenticated
    using (public.is_manager() or exists (
        select 1 from public.shifts s where s.id = shift_id and s.attendant_id = auth.uid()));
create policy "pump_readings_insert" on public.pump_readings for insert to authenticated
    with check (public.is_manager() or exists (
        select 1 from public.shifts s where s.id = shift_id and s.attendant_id = auth.uid() and s.status = 'OPEN'));
create policy "pump_readings_update" on public.pump_readings for update to authenticated
    using (public.is_manager() or exists (
        select 1 from public.shifts s where s.id = shift_id and s.attendant_id = auth.uid() and s.status = 'OPEN'))
    with check (public.is_manager() or exists (
        select 1 from public.shifts s where s.id = shift_id and s.attendant_id = auth.uid() and s.status = 'OPEN'));
create policy "pump_readings_delete" on public.pump_readings for delete to authenticated
    using (public.is_manager() or exists (
        select 1 from public.shifts s where s.id = shift_id and s.attendant_id = auth.uid() and s.status = 'OPEN'));

-- Dry stock -----------------------------------------------------------------
create policy "shop_inventory_select" on public.shop_inventory for select to authenticated
    using (public.is_staff());
create policy "shop_inventory_insert" on public.shop_inventory for insert to authenticated
    with check (public.is_manager());
create policy "shop_inventory_update" on public.shop_inventory for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

create policy "shop_sales_select" on public.shop_sales for select to authenticated
    using (public.is_manager() or recorded_by = auth.uid());
create policy "shop_sales_insert" on public.shop_sales for insert to authenticated
    with check (public.is_staff());
create policy "shop_sales_delete" on public.shop_sales for delete to authenticated
    using (public.is_manager());

create policy "shop_restocks_select" on public.shop_restocks for select to authenticated
    using (public.is_manager());
create policy "shop_restocks_insert" on public.shop_restocks for insert to authenticated
    with check (public.is_manager());
create policy "shop_restocks_delete" on public.shop_restocks for delete to authenticated
    using (public.is_manager());

-- Accounting ----------------------------------------------------------------
create policy "financial_transactions_select" on public.financial_transactions for select to authenticated
    using (public.is_manager());
create policy "financial_transactions_insert" on public.financial_transactions for insert to authenticated
    with check (public.is_manager());
create policy "financial_transactions_update" on public.financial_transactions for update to authenticated
    using (public.is_manager()) with check (public.is_manager());
create policy "financial_transactions_delete" on public.financial_transactions for delete to authenticated
    using (public.is_manager());

-- The journal is written only by the posting triggers.
create policy "journal_entries_select" on public.journal_entries for select to authenticated
    using (public.is_manager());
create policy "journal_lines_select" on public.journal_lines for select to authenticated
    using (public.is_manager());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

-- Stock levels, costs and identifiers only change through the triggers.
revoke update on public.tanks from authenticated;
grant update (tank_name, capacity_liters, reorder_level_liters, is_active) on public.tanks to authenticated;

revoke update on public.pumps from authenticated;
grant update (pump_number, tank_id, current_meter, is_active) on public.pumps to authenticated;

revoke update on public.shop_inventory from authenticated;
grant update (item_name, sku, category, selling_price, reorder_threshold, is_active)
    on public.shop_inventory to authenticated;

revoke update on public.fuel_products from authenticated;
grant update (name, price_per_liter, avg_cost_per_liter) on public.fuel_products to authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, role) on public.profiles to authenticated;

revoke update on public.station_settings from authenticated;
grant update (station_name, currency_code, shortage_tolerance, dip_variance_tolerance_percent)
    on public.station_settings to authenticated;

revoke insert, update, delete on public.journal_entries, public.journal_lines, public.accounts,
    public.fuel_price_history from authenticated;

-- Internal functions are not callable over the API.
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

-- ---------------------------------------------------------------------------
-- Realtime: live dashboard updates
-- ---------------------------------------------------------------------------

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table
            public.tanks,
            public.shifts,
            public.pump_readings,
            public.tank_dips,
            public.fuel_deliveries,
            public.shop_inventory,
            public.shop_sales,
            public.financial_transactions;
    end if;
end;
$$;

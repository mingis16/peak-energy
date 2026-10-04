-- Equipment setup and anti-fraud controls.
--
-- Setup: a tank's fuel and stock, and a pump's number, tank and meter, can be
-- corrected until the equipment is first used. After that, stock changes only
-- through readings, dips and deliveries, and a pump meter only through the
-- owner's logged correction.
--
-- Fraud controls:
--   * every reading opens where the pump's last reading closed, and a reading
--     cannot change once a later one builds on it, so no litres go missing
--     between shifts;
--   * attendants cannot date shifts, bar sales or dips away from today;
--   * closing dips, which reveal stock losses, are recorded by managers;
--   * only the owner changes the shortage and dip tolerances;
--   * an append-only audit log, readable by the owner, records edits and
--     deletions across the station.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
    id bigint generated always as identity primary key,
    happened_at timestamp with time zone not null default now(),
    actor_id uuid references public.profiles (id) on delete set null,
    actor_name text,              -- snapshot, kept if the profile goes
    table_name text not null,
    action text not null,         -- INSERT, UPDATE, DELETE or a named event
    record_id text,
    old_data jsonb,               -- for updates, only the fields that changed
    new_data jsonb
);

create index audit_log_happened_at_idx on public.audit_log (happened_at desc);

create or replace function public.log_event(p_table text, p_action text, p_record_id text, p_old jsonb, p_new jsonb)
returns void
language sql security definer set search_path = public
as $$
    insert into public.audit_log (actor_id, actor_name, table_name, action, record_id, old_data, new_data)
    select auth.uid(),
           (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()),
           p_table, p_action, p_record_id, p_old, p_new
$$;

-- Trigger arguments name columns that other records' triggers move routinely
-- (stock levels, totalisers); a change to only those is not logged.
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_ignore text[] := case when tg_nargs > 0 then tg_argv else '{}' end;
    v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_old jsonb;
    v_new jsonb;
begin
    if tg_op = 'INSERT' then
        v_new := v_row;
    elsif tg_op = 'DELETE' then
        v_old := v_row;
    else
        select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
        into v_old, v_new
        from jsonb_each(to_jsonb(new)) n
        join jsonb_each(to_jsonb(old)) o on o.key = n.key
        where n.value is distinct from o.value and n.key <> all (v_ignore);
        if v_new is null then
            return null;
        end if;
    end if;

    perform public.log_event(tg_table_name, tg_op, coalesce(v_row ->> 'id', v_row ->> 'code'), v_old, v_new);
    return null;
end;
$$;

create trigger tanks_audit after insert or update or delete on public.tanks
    for each row execute function public.audit_row('current_volume', 'updated_at');
create trigger pumps_audit after insert or update or delete on public.pumps
    for each row execute function public.audit_row('current_meter');
create trigger fuel_products_audit after insert or update or delete on public.fuel_products
    for each row execute function public.audit_row('updated_at');
create trigger station_settings_audit after update on public.station_settings
    for each row execute function public.audit_row('updated_at');
create trigger profiles_audit after update or delete on public.profiles
    for each row execute function public.audit_row();
create trigger shifts_audit after update or delete on public.shifts
    for each row execute function public.audit_row('journal_entry_id');
create trigger pump_readings_audit after update or delete on public.pump_readings
    for each row execute function public.audit_row();
create trigger tank_dips_audit after delete on public.tank_dips
    for each row execute function public.audit_row();
create trigger fuel_deliveries_audit after delete on public.fuel_deliveries
    for each row execute function public.audit_row();
create trigger bar_inventory_audit after insert or update or delete on public.bar_inventory
    for each row execute function public.audit_row('quantity_in_stock', 'cost_price', 'updated_at');
create trigger bar_sales_audit after delete on public.bar_sales
    for each row execute function public.audit_row();
create trigger bar_restocks_audit after delete on public.bar_restocks
    for each row execute function public.audit_row();
create trigger financial_transactions_audit after update or delete on public.financial_transactions
    for each row execute function public.audit_row('journal_entry_id');

-- ---------------------------------------------------------------------------
-- Equipment setup
-- ---------------------------------------------------------------------------

create table public.meter_corrections (
    id uuid primary key default gen_random_uuid(),
    pump_id uuid references public.pumps (id) on delete set null,
    pump_number text not null,
    old_meter numeric not null,
    new_meter numeric not null,
    reason text,
    -- Set before the pump's first reading: entering the real meter, no reason needed.
    during_setup boolean not null,
    corrected_by uuid references public.profiles (id) on delete set null default auth.uid(),
    corrected_at timestamp with time zone not null default now()
);

create index meter_corrections_pump_idx on public.meter_corrections (pump_number, corrected_at);

create or replace function public.tank_has_activity(p_tank_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from public.pump_readings where tank_id = p_tank_id)
        or exists (select 1 from public.fuel_deliveries where tank_id = p_tank_id)
        or exists (select 1 from public.tank_dips where tank_id = p_tank_id)
$$;

create or replace function public.pump_has_readings(p_pump_number text)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from public.pump_readings where pump_number = p_pump_number)
$$;

-- Which tanks and pumps are unused, and so still open to setup changes.
create view public.v_equipment_setup with (security_invoker = true) as
select 'TANK' as kind, id, not public.tank_has_activity(id) as in_setup from public.tanks
union all
select 'PUMP', id, not public.pump_has_readings(pump_number) from public.pumps;

-- Sets an unused tank's fuel and opening stock, re-posting the opening value.
create or replace function public.update_tank_stock(p_tank_id uuid, p_fuel_type text, p_volume numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
    v_value numeric;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can change a tank''s stock.';
    end if;
    select * into v_tank from public.tanks where id = p_tank_id for update;
    if not found then
        raise exception 'Tank not found.';
    end if;
    if p_volume is null or p_volume < 0 then
        raise exception 'Enter a stock level of 0 L or more.';
    end if;
    if (p_fuel_type, p_volume) is not distinct from (v_tank.fuel_type, v_tank.current_volume) then
        return;
    end if;
    if public.tank_has_activity(p_tank_id) then
        raise exception 'Tank "%" already has meter readings, dips or deliveries, so its stock changes only through those. Record a closing dip to correct it.',
            v_tank.tank_name;
    end if;
    if p_volume > v_tank.capacity_liters then
        raise exception 'Tank "%" holds at most % L.', v_tank.tank_name, v_tank.capacity_liters;
    end if;
    if not exists (select 1 from public.fuel_products where code = p_fuel_type) then
        raise exception 'Unknown fuel %.', p_fuel_type;
    end if;

    update public.tanks set fuel_type = p_fuel_type, current_volume = p_volume where id = p_tank_id;
    perform public.log_event('tanks', 'STOCK_SET', p_tank_id::text,
        jsonb_build_object('fuel_type', v_tank.fuel_type, 'current_volume', v_tank.current_volume),
        jsonb_build_object('fuel_type', p_fuel_type, 'current_volume', p_volume));

    delete from public.journal_entries where source_type = 'OPENING_BALANCE' and source_id = p_tank_id;
    select round(p_volume * avg_cost_per_liter, 2) into v_value from public.fuel_products where code = p_fuel_type;
    perform public.post_journal(
        current_date,
        format('Opening fuel stock — %s (%s L)', v_tank.tank_name, p_volume),
        'OPENING_BALANCE', p_tank_id,
        jsonb_build_array(
            jsonb_build_object('account', '1200', 'amount', v_value),
            jsonb_build_object('account', '3000', 'amount', -v_value)
        )
    );
end;
$$;

-- Before a pump's first reading a manager sets its meter freely. After that
-- only the owner can, with a reason (meter replaced, repaired, reset).
create or replace function public.set_pump_meter(p_pump_id uuid, p_meter numeric, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_pump public.pumps%rowtype;
    v_setup boolean;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can change a pump meter.';
    end if;
    select * into v_pump from public.pumps where id = p_pump_id for update;
    if not found then
        raise exception 'Pump not found.';
    end if;
    if p_meter is null or p_meter < 0 then
        raise exception 'Enter a meter reading of 0 or more.';
    end if;
    if p_meter = v_pump.current_meter then
        return;
    end if;

    v_setup := not public.pump_has_readings(v_pump.pump_number);
    if not v_setup then
        if not public.is_owner() then
            raise exception 'Pump % already has meter readings, so only the owner can correct its meter.', v_pump.pump_number;
        end if;
        if coalesce(btrim(p_reason), '') = '' then
            raise exception 'Give a reason for the meter correction, for example "meter replaced".';
        end if;
        if exists (
            select 1 from public.pump_readings r join public.shifts s on s.id = r.shift_id
            where r.pump_number = v_pump.pump_number and s.status = 'OPEN'
        ) then
            raise exception 'Pump % has a reading in a shift that is still open. Hand that shift over first.', v_pump.pump_number;
        end if;
    end if;

    insert into public.meter_corrections (pump_id, pump_number, old_meter, new_meter, reason, during_setup)
    values (p_pump_id, v_pump.pump_number, v_pump.current_meter, p_meter, nullif(btrim(p_reason), ''), v_setup);
    update public.pumps set current_meter = p_meter where id = p_pump_id;
end;
$$;

create or replace function public.remove_tank(p_tank_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a tank.';
    end if;
    select * into v_tank from public.tanks where id = p_tank_id for update;
    if not found then
        raise exception 'Tank not found.';
    end if;
    if public.tank_has_activity(p_tank_id) then
        raise exception 'Tank "%" has been used, so it cannot be removed. Untick "In use" instead.', v_tank.tank_name;
    end if;
    if exists (select 1 from public.pumps where tank_id = p_tank_id) then
        raise exception 'Pumps still draw from tank "%". Remove them or move them to another tank first.', v_tank.tank_name;
    end if;
    delete from public.journal_entries where source_type = 'OPENING_BALANCE' and source_id = p_tank_id;
    delete from public.tanks where id = p_tank_id;
end;
$$;

create or replace function public.remove_pump(p_pump_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_pump public.pumps%rowtype;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a pump.';
    end if;
    select * into v_pump from public.pumps where id = p_pump_id for update;
    if not found then
        raise exception 'Pump not found.';
    end if;
    if public.pump_has_readings(v_pump.pump_number) then
        raise exception 'Pump % has meter readings, so it cannot be removed. Untick "In use" instead.', v_pump.pump_number;
    end if;
    delete from public.pumps where id = p_pump_id;
end;
$$;

-- A used pump keeps its number and tank: readings refer to them.
create or replace function public.pumps_before_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if (new.pump_number, new.tank_id) is distinct from (old.pump_number, old.tank_id)
        and public.pump_has_readings(old.pump_number) then
        raise exception 'Pump % already has meter readings, so its number and tank are fixed. Add a new pump instead.',
            old.pump_number;
    end if;
    return new;
end;
$$;

create trigger pumps_before_update
    before update on public.pumps
    for each row execute function public.pumps_before_update();

-- Meters move only through readings and set_pump_meter.
revoke update on public.pumps from authenticated;
grant update (pump_number, tank_id, is_active) on public.pumps to authenticated;

-- ---------------------------------------------------------------------------
-- Meter chain: readings open where the pump last closed
-- ---------------------------------------------------------------------------

-- A reading's closing meter is where the pump's next reading (or a later meter
-- correction) starts, so only the newest reading on a pump may change.
create or replace function public.assert_reading_is_latest(p_reading public.pump_readings)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
    if exists (
        select 1 from public.pump_readings
        where pump_number = p_reading.pump_number and id <> p_reading.id and created_at >= p_reading.created_at
    ) or exists (
        select 1 from public.meter_corrections
        where pump_number = p_reading.pump_number and corrected_at >= p_reading.created_at
    ) then
        raise exception 'A later reading on pump % starts from this one''s closing meter, so it can no longer change.',
            p_reading.pump_number;
    end if;
end;
$$;

create or replace function public.pump_readings_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_shift public.shifts%rowtype;
    v_pump public.pumps%rowtype;
    v_tank public.tanks%rowtype;
    v_product public.fuel_products%rowtype;
begin
    if tg_op = 'DELETE' then
        select * into v_shift from public.shifts where id = old.shift_id;
        -- Not found means the whole (open) shift is being deleted.
        if found and v_shift.status <> 'OPEN' then
            raise exception 'This shift is % — its meter readings are locked.', lower(v_shift.status);
        end if;
        perform public.assert_reading_is_latest(old);
        perform public.assert_no_closing_dip(old.tank_id, old.reading_date);
        return old;
    end if;

    select * into v_shift from public.shifts where id = new.shift_id;
    if not found then
        raise exception 'Shift % not found', new.shift_id;
    end if;
    if v_shift.status <> 'OPEN' then
        raise exception 'This shift is % — its meter readings are locked.', lower(v_shift.status);
    end if;

    if tg_op = 'UPDATE' then
        if new.shift_id <> old.shift_id or new.pump_number <> old.pump_number then
            raise exception 'A meter reading cannot move to another shift or pump. Delete it and enter it again.';
        end if;
        perform public.assert_reading_is_latest(old);
        -- The opening meter and snapshots are fixed when the reading is made.
        new.opening_meter := old.opening_meter;
        new.tank_id := old.tank_id;
        new.fuel_type := old.fuel_type;
        new.cost_per_liter := old.cost_per_liter;
        if not public.is_manager() then
            new.price_per_liter := old.price_per_liter;
        end if;
        new.recorded_by := old.recorded_by;
        new.created_at := old.created_at;
    else
        select * into v_pump from public.pumps where pump_number = new.pump_number for update;
        if not found then
            raise exception 'Pump % does not exist.', new.pump_number;
        end if;
        if not v_pump.is_active then
            raise exception 'Pump % is inactive.', new.pump_number;
        end if;
        select * into v_tank from public.tanks where id = v_pump.tank_id;
        select * into v_product from public.fuel_products where code = v_tank.fuel_type;

        -- Opens where the pump's last reading (or the owner's last meter
        -- correction) closed, whatever the client sent.
        new.opening_meter := v_pump.current_meter;
        new.tank_id := v_tank.id;
        new.fuel_type := v_tank.fuel_type;
        new.cost_per_liter := v_product.avg_cost_per_liter;
        -- Only managers may override the pump price.
        if new.price_per_liter is null or not public.is_manager() then
            new.price_per_liter := v_product.price_per_liter;
        end if;
        new.recorded_by := coalesce(auth.uid(), new.recorded_by);
        new.created_at := now();
    end if;

    if new.closing_meter < new.opening_meter then
        raise exception 'Pump %: the closing meter (%) is below the opening meter (%), where the last reading closed.',
            new.pump_number, new.closing_meter, new.opening_meter;
    end if;

    new.reading_date := v_shift.shift_date;
    perform public.assert_no_closing_dip(new.tank_id, new.reading_date);
    return new;
end;
$$;

-- Meter sales draw down the tank's book stock and move the pump's totaliser.
-- Only the newest reading on a pump can be written, so the totaliser is its
-- closing meter, or its opening meter once it is deleted.
create or replace function public.pump_readings_after_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        perform public.adjust_tank_volume(old.tank_id, old.liters_sold);
        update public.pumps set current_meter = old.opening_meter where pump_number = old.pump_number;
    else
        perform public.adjust_tank_volume(new.tank_id,
            case when tg_op = 'UPDATE' then old.liters_sold else 0 end - new.liters_sold);
        update public.pumps set current_meter = new.closing_meter where pump_number = new.pump_number;
    end if;
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dates, dips and tolerances
-- ---------------------------------------------------------------------------

-- Attendants work in the present: today, or a day either side for night
-- shifts and time zones. Managers can record earlier days.
create or replace function public.assert_recent_date(p_date date, p_what text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
    if auth.uid() is not null and not public.is_manager()
        and p_date not between current_date - 1 and current_date + 1 then
        raise exception 'Attendants can only record % for today. Ask a manager to record % dated %.', p_what, p_what, p_date;
    end if;
end;
$$;

create or replace function public.shifts_date_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if tg_op = 'INSERT' or new.shift_date is distinct from old.shift_date then
        perform public.assert_recent_date(new.shift_date, 'shifts');
    end if;
    return new;
end;
$$;

create trigger shifts_date_guard
    before insert or update on public.shifts
    for each row execute function public.shifts_date_guard();

create or replace function public.bar_sales_date_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    perform public.assert_recent_date(new.sale_date, 'bar sales');
    return new;
end;
$$;

create trigger bar_sales_date_guard
    before insert on public.bar_sales
    for each row execute function public.bar_sales_date_guard();

-- Whoever sold from a tank should not be the one measuring what is left.
create or replace function public.tank_dips_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.dip_type = 'CLOSING' and auth.uid() is not null and not public.is_manager() then
        raise exception 'Closing dips set the tank''s stock and show any losses, so a manager records them.';
    end if;
    perform public.assert_recent_date(new.dip_date, 'dips');
    return new;
end;
$$;

create trigger tank_dips_guard
    before insert on public.tank_dips
    for each row execute function public.tank_dips_guard();

-- Raising a tolerance hides shortages and losses, so it is the owner's call.
create or replace function public.station_settings_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if (new.shortage_tolerance, new.dip_variance_tolerance_percent)
            is distinct from (old.shortage_tolerance, old.dip_variance_tolerance_percent)
        and auth.uid() is not null and not public.is_owner() then
        raise exception 'Only the owner can change the shortage and dip tolerances.';
    end if;
    return new;
end;
$$;

create trigger station_settings_guard
    before update on public.station_settings
    for each row execute function public.station_settings_guard();

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.audit_log enable row level security;
alter table public.meter_corrections enable row level security;

create policy "audit_log_select" on public.audit_log for select to authenticated
    using (public.is_owner());
create policy "meter_corrections_select" on public.meter_corrections for select to authenticated
    using (public.is_manager());

-- Both are written only by triggers and functions, and never changed.
revoke insert, update, delete, truncate on public.audit_log, public.meter_corrections from anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
    public.current_app_role(),
    public.is_owner(),
    public.is_manager(),
    public.is_staff(),
    public.get_profit_and_loss(date, date),
    public.get_trial_balance(date),
    public.get_dashboard_kpis(date),
    public.get_daily_trend(date, date),
    public.tank_has_activity(uuid),
    public.pump_has_readings(text),
    public.update_tank_stock(uuid, text, numeric),
    public.set_pump_meter(uuid, numeric, text),
    public.remove_tank(uuid),
    public.remove_pump(uuid)
to authenticated;

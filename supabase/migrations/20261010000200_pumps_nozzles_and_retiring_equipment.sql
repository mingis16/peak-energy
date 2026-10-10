-- Pumps and nozzles, and removing equipment without losing its history.
--
-- A forecourt is tanks, pumps and nozzles: each pump (dispenser) has one or
-- more nozzles, and each nozzle draws from one tank and has its own meter.
-- The table that has always held the meters, public.pumps, holds the
-- nozzles; public.dispensers holds the pumps they sit on. Nozzles can have
-- any name, up to 30 characters.
--
-- Removing a tank or nozzle that was never used deletes it. One with
-- readings, dips or deliveries is retired instead: it leaves daily use and
-- the settings lists, every shift and delivery that refers to it stays as it
-- was, and it can be restored. Removing a pump removes its nozzles the same
-- way.

-- ---------------------------------------------------------------------------
-- Pumps (dispensers)
-- ---------------------------------------------------------------------------

create table public.dispensers (
    id uuid primary key default gen_random_uuid(),
    name text not null check (btrim(name) <> '' and length(name) <= 30),
    created_at timestamp with time zone not null default now()
);

create unique index dispensers_name_key on public.dispensers (lower(name));

alter table public.pumps
    -- Nozzles from before pumps were recorded have none until one is chosen.
    add column dispenser_id uuid references public.dispensers (id) on delete set null,
    add column retired_at timestamp with time zone;

alter table public.pumps add constraint pumps_pump_number_check
    check (btrim(pump_number) <> '' and length(pump_number) <= 30);
create unique index pumps_pump_number_lower_key on public.pumps (lower(pump_number));

alter table public.tanks add column retired_at timestamp with time zone;

create trigger dispensers_audit after insert or update or delete on public.dispensers
    for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Retired equipment stays out of use
-- ---------------------------------------------------------------------------

create or replace function public.tanks_in_service()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.is_active and new.retired_at is not null then
        raise exception 'Tank "%" has been removed. Restore it before putting it back in use.', new.tank_name;
    end if;
    return new;
end;
$$;

create trigger tanks_in_service
    before update on public.tanks
    for each row execute function public.tanks_in_service();

create or replace function public.pumps_in_service()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
begin
    if new.retired_at is not null then
        if new.is_active then
            raise exception 'Nozzle % has been removed. Restore it before putting it back in use.', new.pump_number;
        end if;
        return new;
    end if;
    select * into v_tank from public.tanks where id = new.tank_id;
    if v_tank.retired_at is not null then
        raise exception 'Tank "%" has been removed, so no nozzle can draw from it. Restore the tank first.', v_tank.tank_name;
    end if;
    return new;
end;
$$;

create trigger pumps_in_service
    before insert or update on public.pumps
    for each row execute function public.pumps_in_service();

-- ---------------------------------------------------------------------------
-- Removing and restoring
-- ---------------------------------------------------------------------------

-- Return 'DELETED' for equipment never used, 'RETIRED' for equipment kept for its history.
drop function public.remove_pump(uuid);
create function public.remove_pump(p_pump_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
    v_pump public.pumps%rowtype;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a nozzle.';
    end if;
    select * into v_pump from public.pumps where id = p_pump_id for update;
    if not found then
        raise exception 'Nozzle not found.';
    end if;
    if not public.pump_has_readings(v_pump.pump_number) then
        delete from public.pumps where id = p_pump_id;
        return 'DELETED';
    end if;
    if v_pump.retired_at is not null then
        return 'RETIRED';
    end if;
    if exists (
        select 1 from public.pump_readings r join public.shifts s on s.id = r.shift_id
        where r.pump_number = v_pump.pump_number and s.status = 'OPEN'
    ) then
        raise exception 'Nozzle % has a reading in a shift that is still open. Hand that shift over first.', v_pump.pump_number;
    end if;
    -- Its readings refer to it, so it is retired rather than deleted.
    update public.pumps set is_active = false, retired_at = now() where id = p_pump_id;
    return 'RETIRED';
end;
$$;

-- Back on the list, but not in use until it is ticked again.
create function public.restore_pump(p_pump_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    if not public.is_manager() then
        raise exception 'Only a manager can restore a nozzle.';
    end if;
    update public.pumps set retired_at = null where id = p_pump_id and retired_at is not null;
    if not found then
        raise exception 'Nozzle not found, or it was not removed.';
    end if;
end;
$$;

drop function public.remove_tank(uuid);
create function public.remove_tank(p_tank_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
    v_nozzles text[];
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a tank.';
    end if;
    select * into v_tank from public.tanks where id = p_tank_id for update;
    if not found then
        raise exception 'Tank not found.';
    end if;

    select array_agg(pump_number order by pump_number) into v_nozzles
    from public.pumps where tank_id = p_tank_id and retired_at is null;
    if v_nozzles is not null then
        raise exception '% % from tank "%". Move % to another tank or remove % first.',
            case when cardinality(v_nozzles) = 1 then 'Nozzle' else 'Nozzles' end,
            array_to_string(v_nozzles, ', ') || case when cardinality(v_nozzles) = 1 then ' draws' else ' draw' end,
            v_tank.tank_name,
            case when cardinality(v_nozzles) = 1 then 'it' else 'them' end,
            case when cardinality(v_nozzles) = 1 then 'it' else 'them' end;
    end if;

    if not public.tank_has_activity(p_tank_id) then
        delete from public.journal_entries where source_type = 'OPENING_BALANCE' and source_id = p_tank_id;
        delete from public.tanks where id = p_tank_id;
        return 'DELETED';
    end if;
    -- Readings, dips and deliveries refer to it, so it is retired. Its book
    -- stock stays in the accounts until a closing dip says otherwise.
    update public.tanks set is_active = false, retired_at = coalesce(retired_at, now()) where id = p_tank_id;
    return 'RETIRED';
end;
$$;

create function public.restore_tank(p_tank_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    if not public.is_manager() then
        raise exception 'Only a manager can restore a tank.';
    end if;
    update public.tanks set retired_at = null where id = p_tank_id and retired_at is not null;
    if not found then
        raise exception 'Tank not found, or it was not removed.';
    end if;
end;
$$;

-- Removes a pump with its nozzles: unused ones are deleted, used ones
-- retired with their history. Returns how many were retired.
create function public.remove_dispenser(p_dispenser_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
    v_pump_id uuid;
    v_retired int := 0;
begin
    if not public.is_manager() then
        raise exception 'Only a manager can remove a pump.';
    end if;
    perform 1 from public.dispensers where id = p_dispenser_id for update;
    if not found then
        raise exception 'Pump not found.';
    end if;
    for v_pump_id in
        select id from public.pumps where dispenser_id = p_dispenser_id and retired_at is null
    loop
        if public.remove_pump(v_pump_id) = 'RETIRED' then
            v_retired := v_retired + 1;
        end if;
    end loop;
    -- Retired nozzles keep their readings; they no longer need a pump.
    delete from public.dispensers where id = p_dispenser_id;
    return v_retired;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting: tank status carries the retired date
-- ---------------------------------------------------------------------------

create or replace view public.v_tank_status with (security_invoker = true) as
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
    case when coalesce(s.liters_7d, 0) > 0 then round(t.current_volume / (s.liters_7d / 7), 1) end as days_of_cover,
    t.retired_at
from public.tanks t
join public.fuel_products fp on fp.code = t.fuel_type
left join lateral (
    select sum(r.liters_sold) as liters_7d
    from public.pump_readings r
    where r.tank_id = t.id and r.reading_date > current_date - 7
) s on true;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.dispensers enable row level security;

create policy "dispensers_select" on public.dispensers for select to authenticated
    using (public.is_staff());
create policy "dispensers_insert" on public.dispensers for insert to authenticated
    with check (public.is_manager());
create policy "dispensers_update" on public.dispensers for update to authenticated
    using (public.is_manager()) with check (public.is_manager());

-- Pumps are removed through remove_dispenser; retiring goes through the functions above.
revoke delete, truncate on public.dispensers from anon, authenticated;
revoke update on public.dispensers from authenticated;
grant update (name) on public.dispensers to authenticated;

revoke update on public.pumps from authenticated;
grant update (pump_number, tank_id, is_active, dispenser_id) on public.pumps to authenticated;

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
    public.restore_tank(uuid),
    public.remove_pump(uuid),
    public.restore_pump(uuid),
    public.remove_dispenser(uuid),
    public.remove_fuel_product(text),
    public.add_cash_category(text, text, text, text)
to authenticated;

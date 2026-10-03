-- Business rules: role helpers, the journal posting engine, and the triggers
-- that keep stock levels and the ledger in step with day-to-day operations.
--
-- Posting rules (debit / credit):
--   Fuel delivery         Fuel Inventory          / Payable, Cash or Bank
--   Shift reconciled      Cash, Bank, Receivable  / Fuel Sales
--                         Cash Shortage (if short)/ Cash Overage (if over)
--                         Cost of Fuel Sold       / Fuel Inventory
--   Closing dip variance  Stock Losses            / Fuel Inventory (reversed for gains)
--   Shop sale             Cash, Bank, Receivable  / Shop Sales
--                         Cost of Shop Goods Sold / Shop Inventory
--   Shop restock          Shop Inventory          / Cash, Bank or Payable
--   Cash-book income      Cash, Bank, Receivable  / category account
--   Cash-book expense     category account        / Cash, Bank or Payable

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so RLS policies can call them safely)
-- ---------------------------------------------------------------------------

create or replace function public.current_app_role()
returns text
language sql stable security definer set search_path = public
as $$
    select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
    select coalesce(public.current_app_role() = 'owner', false)
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
    select coalesce(public.current_app_role() in ('owner', 'manager'), false)
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
    select coalesce(public.current_app_role() in ('owner', 'manager', 'attendant'), false)
$$;

-- ---------------------------------------------------------------------------
-- Journal posting engine
-- ---------------------------------------------------------------------------

-- Ledger account that receives (IN) or pays (OUT) money for a payment method.
create or replace function public.payment_account(p_method text, p_direction text)
returns text
language sql immutable
as $$
    select case p_method
        when 'CASH' then '1000'
        when 'BANK' then '1010'
        when 'CREDIT' then case p_direction when 'IN' then '1100' else '2000' end
    end
$$;

-- Creates a journal entry. p_lines is a JSON array of
-- {"account": "1000", "amount": 125.5, "memo": "..."}; a positive amount is a
-- debit and a negative amount a credit. Zero lines are skipped; returns null
-- when nothing is left to post.
create or replace function public.post_journal(
    p_date date,
    p_description text,
    p_source_type text,
    p_source_id uuid,
    p_lines jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
    v_entry_id uuid;
begin
    if not exists (
        select 1 from jsonb_array_elements(p_lines) e
        where round(coalesce((e ->> 'amount')::numeric, 0), 2) <> 0
    ) then
        return null;
    end if;

    insert into public.journal_entries (entry_date, description, source_type, source_id)
    values (p_date, p_description, p_source_type, p_source_id)
    returning id into v_entry_id;

    insert into public.journal_lines (entry_id, account_code, debit, credit, memo)
    select v_entry_id, e ->> 'account', greatest(x.amount, 0), greatest(-x.amount, 0), e ->> 'memo'
    from jsonb_array_elements(p_lines) e,
         lateral (select round(coalesce((e ->> 'amount')::numeric, 0), 2) as amount) x
    where x.amount <> 0;

    return v_entry_id;
end;
$$;

-- Every journal entry must balance by the end of the transaction.
create or replace function public.check_journal_balanced()
returns trigger
language plpgsql
as $$
declare
    v_entry_id uuid := coalesce(new.entry_id, old.entry_id);
    v_difference numeric;
begin
    select coalesce(sum(debit), 0) - coalesce(sum(credit), 0)
    into v_difference
    from public.journal_lines
    where entry_id = v_entry_id;

    if v_difference <> 0 then
        raise exception 'Journal entry % is unbalanced by %', v_entry_id, v_difference;
    end if;
    return null;
end;
$$;

create constraint trigger journal_lines_balanced
    after insert or update or delete on public.journal_lines
    deferrable initially deferred
    for each row execute function public.check_journal_balanced();

-- Deletes the journal entry a source row pointed to once that row is deleted
-- or re-posted. Runs AFTER so the ON DELETE SET NULL foreign key has nothing
-- left to touch on the row being changed.
create or replace function public.cleanup_replaced_journal()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        if old.journal_entry_id is not null then
            delete from public.journal_entries where id = old.journal_entry_id;
        end if;
    elsif old.journal_entry_id is not null
        and old.journal_entry_id is distinct from new.journal_entry_id then
        delete from public.journal_entries where id = old.journal_entry_id;
    end if;
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock helpers
-- ---------------------------------------------------------------------------

create or replace function public.adjust_tank_volume(p_tank_id uuid, p_delta numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
begin
    if p_delta = 0 then
        return;
    end if;

    select * into v_tank from public.tanks where id = p_tank_id for update;
    if not found then
        raise exception 'Tank % not found', p_tank_id;
    end if;

    if v_tank.current_volume + p_delta < 0 then
        raise exception 'Tank "%" only holds % L in book stock, but this needs % L. Record a dip or delivery first.',
            v_tank.tank_name, round(v_tank.current_volume, 2), round(-p_delta, 2);
    end if;
    if v_tank.current_volume + p_delta > v_tank.capacity_liters then
        raise exception 'Tank "%" would hold % L, above its % L capacity.',
            v_tank.tank_name, round(v_tank.current_volume + p_delta, 2), round(v_tank.capacity_liters, 2);
    end if;

    update public.tanks
    set current_volume = current_volume + p_delta, updated_at = now()
    where id = p_tank_id;
end;
$$;

-- Book stock is reset to the physical dip at each closing dip, so nothing may
-- change a tank's movements on or before its latest closing dip.
create or replace function public.assert_no_closing_dip(p_tank_id uuid, p_date date)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare
    v_dip_date date;
begin
    select max(dip_date) into v_dip_date
    from public.tank_dips
    where tank_id = p_tank_id and dip_type = 'CLOSING' and dip_date >= p_date;

    if v_dip_date is not null then
        raise exception 'A closing dip was recorded for this tank on %. Delete that dip before changing stock movements dated %.',
            v_dip_date, p_date;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff profiles
-- ---------------------------------------------------------------------------

-- The very first account becomes the owner; everyone after starts as
-- 'pending' until the owner assigns a role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    lock table public.profiles in share row exclusive mode;

    insert into public.profiles (id, full_name, email, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        new.email,
        case when exists (select 1 from public.profiles where role = 'owner') then 'pending' else 'owner' end
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace function public.profiles_before_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    new.id := old.id;
    new.created_at := old.created_at;

    if new.role is distinct from old.role then
        if auth.uid() is not null and not public.is_owner() then
            raise exception 'Only the owner can change staff roles.';
        end if;
        if old.role = 'owner' and not exists (
            select 1 from public.profiles where role = 'owner' and id <> old.id
        ) then
            raise exception 'The station must keep at least one owner.';
        end if;
    end if;
    return new;
end;
$$;

create trigger profiles_before_update
    before update on public.profiles
    for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------------
-- Fuel products & tanks
-- ---------------------------------------------------------------------------

create or replace function public.fuel_products_after_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.price_per_liter is distinct from old.price_per_liter then
        insert into public.fuel_price_history (fuel_type, old_price, new_price)
        values (new.code, old.price_per_liter, new.price_per_liter);
    end if;
    return null;
end;
$$;

create trigger fuel_products_after_update
    after update on public.fuel_products
    for each row execute function public.fuel_products_after_update();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger fuel_products_touch before update on public.fuel_products
    for each row execute function public.touch_updated_at();
create trigger tanks_touch before update on public.tanks
    for each row execute function public.touch_updated_at();
create trigger shop_inventory_touch before update on public.shop_inventory
    for each row execute function public.touch_updated_at();
create trigger station_settings_touch before update on public.station_settings
    for each row execute function public.touch_updated_at();

-- Stock a tank starts with is opening inventory, valued at the product's
-- current average cost and balanced against owner's equity.
create or replace function public.tanks_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_value numeric;
begin
    select round(new.current_volume * avg_cost_per_liter, 2) into v_value
    from public.fuel_products where code = new.fuel_type;

    perform public.post_journal(
        current_date,
        format('Opening fuel stock — %s (%s L)', new.tank_name, new.current_volume),
        'OPENING_BALANCE', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1200', 'amount', v_value),
            jsonb_build_object('account', '3000', 'amount', -v_value)
        )
    );
    return null;
end;
$$;

create trigger tanks_after_insert
    after insert on public.tanks
    for each row execute function public.tanks_after_insert();

-- ---------------------------------------------------------------------------
-- Pump meter readings
-- ---------------------------------------------------------------------------

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
        perform public.assert_no_closing_dip(old.tank_id, old.reading_date);
        return old;
    end if;

    if tg_op = 'UPDATE' and new.shift_id <> old.shift_id then
        raise exception 'Meter readings cannot be moved between shifts.';
    end if;

    select * into v_shift from public.shifts where id = new.shift_id;
    if not found then
        raise exception 'Shift % not found', new.shift_id;
    end if;
    if v_shift.status <> 'OPEN' then
        raise exception 'This shift is % — its meter readings are locked.', lower(v_shift.status);
    end if;

    if tg_op = 'INSERT' or new.pump_number is distinct from old.pump_number then
        select * into v_pump from public.pumps where pump_number = new.pump_number;
        if not found then
            raise exception 'Pump % does not exist.', new.pump_number;
        end if;
        if not v_pump.is_active then
            raise exception 'Pump % is inactive.', new.pump_number;
        end if;
        select * into v_tank from public.tanks where id = v_pump.tank_id;
        select * into v_product from public.fuel_products where code = v_tank.fuel_type;

        new.tank_id := v_tank.id;
        new.fuel_type := v_tank.fuel_type;
        new.cost_per_liter := v_product.avg_cost_per_liter;
        -- Only managers may override the pump price.
        if new.price_per_liter is null or not public.is_manager() then
            new.price_per_liter := v_product.price_per_liter;
        end if;
    else
        new.tank_id := old.tank_id;
        new.fuel_type := old.fuel_type;
        new.cost_per_liter := old.cost_per_liter;
        if not public.is_manager() then
            new.price_per_liter := old.price_per_liter;
        end if;
    end if;

    new.reading_date := v_shift.shift_date;
    if tg_op = 'INSERT' then
        new.recorded_by := coalesce(auth.uid(), new.recorded_by);
        new.created_at := now();
    else
        new.recorded_by := old.recorded_by;
        new.created_at := old.created_at;
        perform public.assert_no_closing_dip(old.tank_id, old.reading_date);
    end if;
    perform public.assert_no_closing_dip(new.tank_id, new.reading_date);
    return new;
end;
$$;

create trigger pump_readings_before_write
    before insert or update or delete on public.pump_readings
    for each row execute function public.pump_readings_before_write();

-- Meter sales draw down the tank's book stock and move the pump's totaliser.
create or replace function public.pump_readings_after_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_pump_number text;
begin
    if tg_op = 'UPDATE' and new.tank_id = old.tank_id then
        perform public.adjust_tank_volume(new.tank_id, old.liters_sold - new.liters_sold);
    else
        if tg_op in ('UPDATE', 'DELETE') then
            perform public.adjust_tank_volume(old.tank_id, old.liters_sold);
        end if;
        if tg_op in ('INSERT', 'UPDATE') then
            perform public.adjust_tank_volume(new.tank_id, -new.liters_sold);
        end if;
    end if;

    foreach v_pump_number in array array_remove(array[
        case when tg_op <> 'DELETE' then new.pump_number end,
        case when tg_op <> 'INSERT' then old.pump_number end
    ], null) loop
        update public.pumps p
        set current_meter = coalesce(
            (select r.closing_meter from public.pump_readings r
             where r.pump_number = v_pump_number
             order by r.reading_date desc, r.created_at desc
             limit 1),
            case when tg_op = 'DELETE' then old.opening_meter else p.current_meter end
        )
        where p.pump_number = v_pump_number;
    end loop;

    return null;
end;
$$;

create trigger pump_readings_after_write
    after insert or update or delete on public.pump_readings
    for each row execute function public.pump_readings_after_write();

-- ---------------------------------------------------------------------------
-- Shifts: handover, reconciliation and posting
-- ---------------------------------------------------------------------------

create or replace function public.shifts_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_privileged boolean := public.is_manager() or auth.uid() is null;
    v_attendant public.profiles%rowtype;
    v_liters numeric;
    v_sales numeric;
    v_cogs numeric;
begin
    if tg_op = 'DELETE' then
        if old.status <> 'OPEN' then
            raise exception 'Only open shifts can be deleted.';
        end if;
        return old;
    end if;

    select * into v_attendant from public.profiles where id = new.attendant_id;
    if not found or v_attendant.role = 'pending' then
        raise exception 'Shifts can only be assigned to approved staff.';
    end if;

    if tg_op = 'INSERT' then
        new.status := 'OPEN';
        new.expected_liters := null;
        new.expected_sales := null;
        new.variance := null;
        new.opened_at := now();
        new.submitted_at := null;
        new.reconciled_at := null;
        new.reconciled_by := null;
        new.journal_entry_id := null;
        return new;
    end if;

    -- System-managed columns never come from the client.
    new.expected_liters := old.expected_liters;
    new.expected_sales := old.expected_sales;
    new.variance := old.variance;
    new.opened_at := old.opened_at;
    new.submitted_at := old.submitted_at;
    new.reconciled_at := old.reconciled_at;
    new.reconciled_by := old.reconciled_by;
    new.journal_entry_id := old.journal_entry_id;

    if (new.shift_date, new.attendant_id) is distinct from (old.shift_date, old.attendant_id)
        and exists (select 1 from public.pump_readings where shift_id = old.id) then
        raise exception 'A shift''s date and attendant cannot change once meter readings exist.';
    end if;

    if old.status = 'RECONCILED' and new.status = 'RECONCILED' then
        raise exception 'This shift is reconciled and locked. Re-open it for review to make changes.';
    end if;

    if new.status <> old.status then
        if (old.status, new.status) = ('OPEN', 'SUBMITTED') then
            null; -- the attendant hands over
        elsif (old.status, new.status) in (('SUBMITTED', 'RECONCILED'), ('SUBMITTED', 'OPEN'), ('RECONCILED', 'SUBMITTED')) then
            if not v_privileged then
                raise exception 'Only a manager can move a shift from % to %.', old.status, new.status;
            end if;
        else
            raise exception 'A shift cannot move from % to %.', old.status, new.status;
        end if;
    end if;

    if new.status = 'OPEN' then
        new.expected_liters := null;
        new.expected_sales := null;
        new.variance := null;
        new.submitted_at := null;
    else
        -- Readings are locked once a shift leaves OPEN, so these figures are final.
        select coalesce(sum(liters_sold), 0),
               coalesce(sum(sales_amount), 0),
               coalesce(round(sum(liters_sold * cost_per_liter), 2), 0)
        into v_liters, v_sales, v_cogs
        from public.pump_readings
        where shift_id = new.id;

        new.expected_liters := v_liters;
        new.expected_sales := v_sales;
        new.variance := new.cash_on_hand + new.credit_slips_amount + new.digital_transfers_amount - v_sales;
        if old.status = 'OPEN' then
            new.submitted_at := now();
        end if;
    end if;

    if new.status = 'RECONCILED' and old.status <> 'RECONCILED' then
        new.reconciled_at := now();
        new.reconciled_by := auth.uid();
        new.journal_entry_id := public.post_journal(
            new.shift_date,
            format('%s shift %s — %s', new.shift_label, new.shift_date,
                   coalesce(nullif(v_attendant.full_name, ''), v_attendant.email)),
            'SHIFT', new.id,
            jsonb_build_array(
                jsonb_build_object('account', '1000', 'amount', new.cash_on_hand, 'memo', 'Cash collected'),
                jsonb_build_object('account', '1100', 'amount', new.credit_slips_amount, 'memo', 'Credit slips'),
                jsonb_build_object('account', '1010', 'amount', new.digital_transfers_amount, 'memo', 'Bank / mobile money transfers'),
                jsonb_build_object('account', '4000', 'amount', -v_sales, 'memo', format('%s L per pump meters', v_liters)),
                jsonb_build_object('account', '6500', 'amount', greatest(-new.variance, 0), 'memo', 'Cash shortage'),
                jsonb_build_object('account', '4910', 'amount', -greatest(new.variance, 0), 'memo', 'Cash overage'),
                jsonb_build_object('account', '5000', 'amount', v_cogs, 'memo', 'Fuel at average cost'),
                jsonb_build_object('account', '1200', 'amount', -v_cogs)
            )
        );
    elsif old.status = 'RECONCILED' and new.status <> 'RECONCILED' then
        new.reconciled_at := null;
        new.reconciled_by := null;
        new.journal_entry_id := null;
    end if;

    return new;
end;
$$;

create trigger shifts_before_write
    before insert or update or delete on public.shifts
    for each row execute function public.shifts_before_write();

create trigger shifts_cleanup_journal
    after update or delete on public.shifts
    for each row execute function public.cleanup_replaced_journal();

-- ---------------------------------------------------------------------------
-- Tank dips (wet-stock reconciliation)
-- ---------------------------------------------------------------------------

-- A closing dip resets book stock to the physical measurement and posts the
-- gap as a stock loss (or gain) at average cost. Opening dips are recorded
-- for reference only.
create or replace function public.tank_dips_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
    v_value numeric;
begin
    if tg_op = 'DELETE' then
        if old.dip_type = 'CLOSING' then
            if exists (
                select 1 from public.tank_dips
                where tank_id = old.tank_id and dip_type = 'CLOSING' and dip_date > old.dip_date
            ) then
                raise exception 'Only the most recent closing dip for a tank can be deleted.';
            end if;
            perform public.adjust_tank_volume(old.tank_id, -old.variance_liters);
        end if;
        return old;
    end if;

    if tg_op = 'UPDATE' then
        raise exception 'Dips cannot be edited. Delete the dip and record it again.';
    end if;

    select * into v_tank from public.tanks where id = new.tank_id for update;
    if not found then
        raise exception 'Tank % not found', new.tank_id;
    end if;
    if new.volume_liters > v_tank.capacity_liters then
        raise exception 'A dip of % L is more than tank "%" can hold (% L).',
            new.volume_liters, v_tank.tank_name, v_tank.capacity_liters;
    end if;

    new.book_volume := v_tank.current_volume;
    new.variance_liters := new.volume_liters - v_tank.current_volume;
    new.journal_entry_id := null;
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();

    if new.dip_type = 'CLOSING' then
        if exists (
            select 1 from public.tank_dips
            where tank_id = new.tank_id and dip_type = 'CLOSING' and dip_date > new.dip_date
        ) then
            raise exception 'A later closing dip already exists for this tank. Closing dips must be recorded in date order.';
        end if;
        if exists (
            select 1 from public.pump_readings where tank_id = new.tank_id and reading_date > new.dip_date
        ) or exists (
            select 1 from public.fuel_deliveries where tank_id = new.tank_id and delivery_date > new.dip_date
        ) then
            raise exception 'This tank already has stock movements after %. Record closing dips on the day they are taken.', new.dip_date;
        end if;

        select round(new.variance_liters * avg_cost_per_liter, 2) into v_value
        from public.fuel_products where code = v_tank.fuel_type;

        update public.tanks set current_volume = new.volume_liters where id = new.tank_id;

        new.journal_entry_id := public.post_journal(
            new.dip_date,
            format('Closing dip variance — %s (%s L)', v_tank.tank_name, round(new.variance_liters, 2)),
            'TANK_DIP', new.id,
            jsonb_build_array(
                jsonb_build_object('account', '1200', 'amount', v_value),
                jsonb_build_object('account', '5100', 'amount', -v_value,
                    'memo', case when v_value < 0 then 'Stock loss' else 'Stock gain' end)
            )
        );
    end if;

    return new;
end;
$$;

create trigger tank_dips_before_write
    before insert or update or delete on public.tank_dips
    for each row execute function public.tank_dips_before_write();

create trigger tank_dips_cleanup_journal
    after delete on public.tank_dips
    for each row execute function public.cleanup_replaced_journal();

-- ---------------------------------------------------------------------------
-- Fuel deliveries
-- ---------------------------------------------------------------------------

-- A delivery adds the received litres to the tank and updates the fuel's
-- weighted average cost. The supplier invoices the waybill litres, so any
-- transit loss is absorbed into the cost per litre actually received.
create or replace function public.fuel_deliveries_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_tank public.tanks%rowtype;
    v_total numeric;
    v_stock numeric;
begin
    if tg_op = 'UPDATE' then
        raise exception 'Deliveries cannot be edited. Delete the delivery and record it again.';
    end if;

    if tg_op = 'DELETE' then
        select * into v_tank from public.tanks where id = old.tank_id;
        perform public.assert_no_closing_dip(old.tank_id, old.delivery_date);
        perform public.adjust_tank_volume(old.tank_id, -old.received_liters);

        -- Back the delivery out of the average cost.
        perform 1 from public.fuel_products where code = v_tank.fuel_type for update;
        select coalesce(sum(current_volume), 0) into v_stock
        from public.tanks where fuel_type = v_tank.fuel_type;
        if v_stock > 0 then
            update public.fuel_products
            set avg_cost_per_liter = greatest(round(
                ((v_stock + old.received_liters) * avg_cost_per_liter - old.total_cost) / v_stock, 4), 0)
            where code = v_tank.fuel_type;
        end if;
        return old;
    end if;

    select * into v_tank from public.tanks where id = new.tank_id;
    if not found then
        raise exception 'Tank % not found', new.tank_id;
    end if;
    if not v_tank.is_active then
        raise exception 'Tank "%" is inactive.', v_tank.tank_name;
    end if;
    perform public.assert_no_closing_dip(new.tank_id, new.delivery_date);

    v_total := round(new.invoiced_liters * new.unit_cost, 2);

    perform 1 from public.fuel_products where code = v_tank.fuel_type for update;
    select coalesce(sum(current_volume), 0) into v_stock
    from public.tanks where fuel_type = v_tank.fuel_type;

    update public.fuel_products
    set avg_cost_per_liter = round((v_stock * avg_cost_per_liter + v_total) / (v_stock + new.received_liters), 4)
    where code = v_tank.fuel_type;

    perform public.adjust_tank_volume(new.tank_id, new.received_liters);

    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();
    new.journal_entry_id := public.post_journal(
        new.delivery_date,
        format('Fuel delivery — %s L %s from %s', new.received_liters, v_tank.fuel_type, new.supplier),
        'FUEL_DELIVERY', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1200', 'amount', v_total,
                'memo', format('Waybill %s: %s L invoiced', coalesce(new.waybill_number, '—'), new.invoiced_liters)),
            jsonb_build_object('account', public.payment_account(new.payment_method, 'OUT'), 'amount', -v_total)
        )
    );
    return new;
end;
$$;

create trigger fuel_deliveries_before_write
    before insert or update or delete on public.fuel_deliveries
    for each row execute function public.fuel_deliveries_before_write();

create trigger fuel_deliveries_cleanup_journal
    after delete on public.fuel_deliveries
    for each row execute function public.cleanup_replaced_journal();

-- ---------------------------------------------------------------------------
-- Shop: opening stock, sales and restocks
-- ---------------------------------------------------------------------------

create or replace function public.shop_inventory_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_value numeric := round(new.quantity_in_stock * new.cost_price, 2);
begin
    perform public.post_journal(
        current_date,
        format('Opening shop stock — %s × %s', new.quantity_in_stock, new.item_name),
        'OPENING_BALANCE', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_value),
            jsonb_build_object('account', '3000', 'amount', -v_value)
        )
    );
    return null;
end;
$$;

create trigger shop_inventory_after_insert
    after insert on public.shop_inventory
    for each row execute function public.shop_inventory_after_insert();

create or replace function public.shop_sales_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_item public.shop_inventory%rowtype;
    v_total numeric;
    v_cogs numeric;
begin
    if tg_op = 'UPDATE' then
        raise exception 'Shop sales cannot be edited. Delete the sale and record it again.';
    end if;

    if tg_op = 'DELETE' then
        update public.shop_inventory
        set quantity_in_stock = quantity_in_stock + old.quantity
        where id = old.item_id;
        return old;
    end if;

    select * into v_item from public.shop_inventory where id = new.item_id for update;
    if not found then
        raise exception 'Item % not found', new.item_id;
    end if;
    if not v_item.is_active then
        raise exception '"%" is no longer sold.', v_item.item_name;
    end if;
    if v_item.quantity_in_stock < new.quantity then
        raise exception 'Only % × "%" left in stock.', v_item.quantity_in_stock, v_item.item_name;
    end if;

    -- Only managers may override the shelf price.
    if new.unit_price is null or not public.is_manager() then
        new.unit_price := v_item.selling_price;
    end if;
    new.unit_cost := v_item.cost_price;
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();

    update public.shop_inventory
    set quantity_in_stock = quantity_in_stock - new.quantity
    where id = new.item_id;

    v_total := round(new.quantity * new.unit_price, 2);
    v_cogs := round(new.quantity * new.unit_cost, 2);

    new.journal_entry_id := public.post_journal(
        new.sale_date,
        format('Shop sale — %s × %s', new.quantity, v_item.item_name),
        'SHOP_SALE', new.id,
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

create trigger shop_sales_before_write
    before insert or update or delete on public.shop_sales
    for each row execute function public.shop_sales_before_write();

create trigger shop_sales_cleanup_journal
    after delete on public.shop_sales
    for each row execute function public.cleanup_replaced_journal();

create or replace function public.shop_restocks_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_item public.shop_inventory%rowtype;
    v_total numeric;
begin
    if tg_op = 'UPDATE' then
        raise exception 'Restocks cannot be edited. Delete the restock and record it again.';
    end if;

    if tg_op = 'DELETE' then
        select * into v_item from public.shop_inventory where id = old.item_id for update;
        if v_item.quantity_in_stock < old.quantity then
            raise exception 'Some of this restock has already been sold, so it cannot be deleted.';
        end if;
        update public.shop_inventory
        set quantity_in_stock = quantity_in_stock - old.quantity,
            cost_price = case when quantity_in_stock - old.quantity > 0
                then greatest(round((quantity_in_stock * cost_price - old.total_cost)
                                    / (quantity_in_stock - old.quantity), 4), 0)
                else cost_price end
        where id = old.item_id;
        return old;
    end if;

    select * into v_item from public.shop_inventory where id = new.item_id for update;
    if not found then
        raise exception 'Item % not found', new.item_id;
    end if;

    v_total := round(new.quantity * new.unit_cost, 2);

    update public.shop_inventory
    set cost_price = round((quantity_in_stock * cost_price + v_total) / (quantity_in_stock + new.quantity), 4),
        quantity_in_stock = quantity_in_stock + new.quantity
    where id = new.item_id;

    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.created_at := now();
    new.journal_entry_id := public.post_journal(
        new.restock_date,
        format('Shop restock — %s × %s%s', new.quantity, v_item.item_name,
               coalesce(' from ' || nullif(new.supplier, ''), '')),
        'SHOP_RESTOCK', new.id,
        jsonb_build_array(
            jsonb_build_object('account', '1210', 'amount', v_total),
            jsonb_build_object('account', public.payment_account(new.payment_method, 'OUT'), 'amount', -v_total)
        )
    );
    return new;
end;
$$;

create trigger shop_restocks_before_write
    before insert or update or delete on public.shop_restocks
    for each row execute function public.shop_restocks_before_write();

create trigger shop_restocks_cleanup_journal
    after delete on public.shop_restocks
    for each row execute function public.cleanup_replaced_journal();

-- ---------------------------------------------------------------------------
-- Cash book (financial_transactions)
-- ---------------------------------------------------------------------------

create or replace function public.financial_transactions_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    v_category public.transaction_categories%rowtype;
    v_payment_account text;
    v_amount numeric;
begin
    select * into v_category from public.transaction_categories where name = new.category;
    if not found then
        raise exception 'Unknown category "%".', new.category;
    end if;

    new.transaction_type := coalesce(new.transaction_type, v_category.transaction_type);
    if new.transaction_type <> v_category.transaction_type then
        raise exception '"%" is an % category.', new.category, lower(v_category.transaction_type);
    end if;

    v_payment_account := public.payment_account(
        new.payment_method, case new.transaction_type when 'INCOME' then 'IN' else 'OUT' end);
    if v_payment_account = v_category.account_code then
        raise exception 'Choose a different payment method for "%".', new.category;
    end if;

    if tg_op = 'INSERT' then
        new.created_by := coalesce(auth.uid(), new.created_by);
        new.created_at := now();
    else
        new.created_by := old.created_by;
        new.created_at := old.created_at;
    end if;
    if coalesce(btrim(new.recorded_by), '') = '' then
        new.recorded_by := (
            select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()
        );
    end if;

    v_amount := round(new.amount, 2);
    new.journal_entry_id := public.post_journal(
        new.transaction_date,
        coalesce(nullif(btrim(new.description), ''), new.category),
        'TRANSACTION', new.id,
        case new.transaction_type
            when 'INCOME' then jsonb_build_array(
                jsonb_build_object('account', v_payment_account, 'amount', v_amount),
                jsonb_build_object('account', v_category.account_code, 'amount', -v_amount, 'memo', new.category))
            else jsonb_build_array(
                jsonb_build_object('account', v_category.account_code, 'amount', v_amount, 'memo', new.category),
                jsonb_build_object('account', v_payment_account, 'amount', -v_amount))
        end
    );
    return new;
end;
$$;

create trigger financial_transactions_before_write
    before insert or update on public.financial_transactions
    for each row execute function public.financial_transactions_before_write();

create trigger financial_transactions_cleanup_journal
    after update or delete on public.financial_transactions
    for each row execute function public.cleanup_replaced_journal();

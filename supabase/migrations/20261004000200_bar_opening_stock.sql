-- Receiving stock that is already on the shelf (the bar's opening count)
-- rather than bought: it is valued at cost against owner's equity, the same
-- way a drink added with opening stock is, instead of reducing cash or adding
-- a supplier debt.

alter table public.bar_restocks drop constraint bar_restocks_payment_method_check;
alter table public.bar_restocks add constraint bar_restocks_payment_method_check
    check (payment_method in ('CASH', 'BANK', 'CREDIT', 'OPENING'));

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
            then format('Opening bar stock — %s × %s', new.quantity, v_item.item_name)
            else format('Bar restock — %s × %s%s', new.quantity, v_item.item_name,
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

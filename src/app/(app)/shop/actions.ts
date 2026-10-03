"use server";

import {
  ActionError,
  authorize,
  check,
  PAYMENT_METHODS,
  readChoice,
  readDate,
  readInteger,
  readNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth";
import { formatMoney } from "@/lib/format";

export async function recordSale(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const quantity = readInteger(form, "quantity", "Quantity", 1);

    const { data, error } = await supabase
      .from("shop_sales")
      .insert({
        item_id: readText(form, "item_id", "Item"),
        quantity,
        sale_date: readDate(form, "sale_date"),
        payment_method: readChoice(form, "payment_method", PAYMENT_METHODS, "Payment method"),
      })
      .select("total_amount")
      .single();
    check(error);
    const { data: settings } = await supabase.from("station_settings").select("currency_code").single();
    return `Sale recorded: ${quantity} item${quantity === 1 ? "" : "s"}, ${formatMoney(data!.total_amount, settings?.currency_code ?? "SLE")}.`;
  });
}

export async function deleteSale(saleId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("shop_sales").delete().eq("id", saleId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Sale not found.");
    return "Sale deleted and stock returned.";
  });
}

export async function addItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.from("shop_inventory").insert({
      item_name: readText(form, "item_name", "Item name"),
      sku: readText(form, "sku", "SKU").toUpperCase(),
      category: readText(form, "category", "Category"),
      quantity_in_stock: readInteger(form, "quantity_in_stock", "Opening quantity"),
      cost_price: readNumber(form, "cost_price", "Cost price"),
      selling_price: readNumber(form, "selling_price", "Selling price"),
      reorder_threshold: readInteger(form, "reorder_threshold", "Reorder level"),
    });
    if (error?.code === "23505") throw new ActionError("An item with that SKU already exists.");
    check(error);
    return "Item added.";
  });
}

export async function updateItem(itemId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase
      .from("shop_inventory")
      .update({
        item_name: readText(form, "item_name", "Item name"),
        category: readText(form, "category", "Category"),
        selling_price: readNumber(form, "selling_price", "Selling price"),
        reorder_threshold: readInteger(form, "reorder_threshold", "Reorder level"),
        is_active: form.get("is_active") === "on",
      })
      .eq("id", itemId);
    check(error);
    return "Item updated.";
  });
}

export async function restockItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.from("shop_restocks").insert({
      item_id: readText(form, "item_id", "Item"),
      quantity: readInteger(form, "quantity", "Quantity", 1),
      unit_cost: readNumber(form, "unit_cost", "Unit cost"),
      supplier: readOptionalText(form, "supplier"),
      payment_method: readChoice(form, "payment_method", PAYMENT_METHODS, "Payment method"),
      restock_date: readDate(form, "restock_date"),
    });
    check(error);
    return "Stock received. Average cost updated.";
  });
}

export async function deleteRestock(restockId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("shop_restocks").delete().eq("id", restockId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Restock not found.");
    return "Restock deleted.";
  });
}

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
  readOptionalNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth";
import { formatMoney, todayISO } from "@/lib/format";

export async function recordSale(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const quantity = readInteger(form, "quantity", "Quantity", 1);

    const { data, error } = await supabase
      .from("bar_sales")
      .insert({
        item_id: readText(form, "item_id", "Drink"),
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
    const { data, error } = await supabase.from("bar_sales").delete().eq("id", saleId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Sale not found.");
    return "Sale deleted and stock returned.";
  });
}

type Supabase = Awaited<ReturnType<typeof authorize>>["supabase"];

/** Where a new drink's stock came from: already on the shelf, or just bought. */
const STOCK_SOURCES = ["OPENING", ...PAYMENT_METHODS] as const;

export async function addDrink(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const name = readText(form, "item_name", "Drink name");
    const quantity = readInteger(form, "quantity", "Quantity");
    const source = readChoice(form, "stock_source", STOCK_SOURCES, "Where the stock came from");
    // The cost only matters once there is stock to value.
    const unitCost = quantity > 0
      ? readNumber(form, "cost_price", "Cost per unit")
      : (readOptionalNumber(form, "cost_price", "Cost per unit") ?? 0);
    const opening = source === "OPENING";

    const { data: existing } = await supabase
      .from("bar_inventory")
      .select("id")
      .ilike("item_name", name.replace(/[%_\\]/g, "\\$&"))
      .limit(1);
    if (existing?.length) throw new ActionError(`"${name}" is already on the list. Use Receive stock to add more.`);

    const itemId = await insertWithFreeSku(supabase, skuFrom(name), {
      item_name: name,
      category: readText(form, "category", "Category"),
      selling_price: readNumber(form, "selling_price", "Menu price"),
      reorder_threshold: readInteger(form, "reorder_threshold", "Reorder level"),
      cost_price: unitCost,
      // Bought stock arrives as a restock instead, so its payment reaches the ledger.
      quantity_in_stock: opening ? quantity : 0,
    });

    if (!opening && quantity > 0) {
      const { error } = await supabase.from("bar_restocks").insert({
        item_id: itemId,
        quantity,
        unit_cost: unitCost,
        payment_method: source,
        restock_date: todayISO(),
      });
      try {
        check(error);
      } catch (e) {
        throw new ActionError(`"${name}" was added, but its stock was not recorded: ${(e as Error).message} Use Receive stock to add it.`);
      }
    }
    return quantity > 0 ? `"${name}" added with ${quantity} in stock.` : `"${name}" added. Use Receive stock when it arrives.`;
  });
}

/** Bars don't use product codes, so one is made from the name: "Star beer, 60 cl" → "STAR-BEER-60-CL". */
function skuFrom(name: string): string {
  const sku = name
    .normalize("NFKD")
    .replace(/[̀-ͯ'’]/g, "") // accents and apostrophes: "Moët", "Gordon's"
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sku.slice(0, 32) || "DRINK";
}

async function insertWithFreeSku(supabase: Supabase, sku: string, item: Record<string, unknown>): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const { data, error } = await supabase
      .from("bar_inventory")
      .insert({ ...item, sku: n === 1 ? sku : `${sku}-${n}` })
      .select("id")
      .single();
    if (error?.code === "23505") continue;
    check(error);
    return data!.id;
  }
  throw new ActionError("Could not save this drink. Try a slightly different name.");
}

export async function updateItem(itemId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase
      .from("bar_inventory")
      .update({
        item_name: readText(form, "item_name", "Drink name"),
        category: readText(form, "category", "Category"),
        selling_price: readNumber(form, "selling_price", "Menu price"),
        reorder_threshold: readInteger(form, "reorder_threshold", "Reorder level"),
        is_active: form.get("is_active") === "on",
      })
      .eq("id", itemId);
    check(error);
    return "Drink updated.";
  });
}

export async function restockItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.from("bar_restocks").insert({
      item_id: readText(form, "item_id", "Drink"),
      quantity: readInteger(form, "quantity", "Quantity", 1),
      unit_cost: readNumber(form, "unit_cost", "Unit cost"),
      supplier: readOptionalText(form, "supplier"),
      payment_method: readChoice(form, "payment_method", STOCK_SOURCES, "Payment method"),
      restock_date: readDate(form, "restock_date"),
    });
    check(error);
    return "Stock received. Average cost updated.";
  });
}

export async function deleteRestock(restockId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("bar_restocks").delete().eq("id", restockId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Restock not found.");
    return "Restock deleted.";
  });
}

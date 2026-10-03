"use server";

import {
  ActionError,
  authorize,
  check,
  PAYMENT_METHODS,
  readChoice,
  readDate,
  readNumber,
  readOptionalNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth";
import { formatLiters } from "@/lib/format";

export async function recordDip(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const dipType = readChoice(form, "dip_type", ["OPENING", "CLOSING"] as const, "Dip type");

    const { data, error } = await supabase
      .from("tank_dips")
      .insert({
        tank_id: readText(form, "tank_id", "Tank"),
        dip_date: readDate(form, "dip_date"),
        dip_type: dipType,
        volume_liters: readNumber(form, "volume_liters", "Volume"),
        dip_reading_cm: readOptionalNumber(form, "dip_reading_cm", "Dip reading"),
        notes: readOptionalText(form, "notes"),
      })
      .select("variance_liters")
      .single();
    if (error?.code === "23505") {
      throw new ActionError(`An ${dipType.toLowerCase()} dip is already recorded for this tank on that date.`);
    }
    check(error);

    if (dipType === "OPENING") return "Opening dip recorded.";
    const variance = Number(data!.variance_liters);
    if (variance === 0) return "Closing dip recorded. Physical stock matches the book exactly.";
    return `Closing dip recorded. ${variance < 0 ? "Loss" : "Gain"} of ${formatLiters(Math.abs(variance), 2)} against book stock was posted.`;
  });
}

export async function deleteDip(dipId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("tank_dips").delete().eq("id", dipId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Dip not found.");
    return "Dip deleted and book stock restored.";
  });
}

export async function recordDelivery(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const invoiced = readNumber(form, "invoiced_liters", "Waybill litres", { allowZero: false });
    const received = readNumber(form, "received_liters", "Litres received", { allowZero: false });

    const { error } = await supabase.from("fuel_deliveries").insert({
      tank_id: readText(form, "tank_id", "Tank"),
      delivery_date: readDate(form, "delivery_date"),
      supplier: readText(form, "supplier", "Supplier"),
      waybill_number: readOptionalText(form, "waybill_number"),
      invoiced_liters: invoiced,
      received_liters: received,
      unit_cost: readNumber(form, "unit_cost", "Cost per litre"),
      payment_method: readChoice(form, "payment_method", PAYMENT_METHODS, "Payment method"),
      notes: readOptionalText(form, "notes"),
    });
    check(error);

    const shortfall = invoiced - received;
    return shortfall > 0
      ? `Delivery recorded. ${formatLiters(shortfall, 2)} transit loss is absorbed into the cost per litre.`
      : "Delivery recorded and added to the tank.";
  });
}

export async function deleteDelivery(deliveryId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("fuel_deliveries").delete().eq("id", deliveryId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Delivery not found.");
    return "Delivery deleted. Tank stock and average cost were reversed.";
  });
}

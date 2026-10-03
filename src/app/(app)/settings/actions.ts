"use server";

import {
  ActionError,
  authorize,
  check,
  readChoice,
  readNumber,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES } from "@/lib/auth";

export async function updateStation(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const currency = readText(form, "currency_code", "Currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new ActionError("Use a 3-letter currency code such as SLE or USD.");

    const { error } = await supabase
      .from("station_settings")
      .update({
        station_name: readText(form, "station_name", "Station name"),
        currency_code: currency,
        shortage_tolerance: readNumber(form, "shortage_tolerance", "Shortage tolerance"),
        dip_variance_tolerance_percent: readNumber(form, "dip_variance_tolerance_percent", "Dip tolerance"),
      })
      .eq("id", true);
    check(error);
    return "Station settings saved.";
  });
}

export async function updateFuelProduct(code: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase
      .from("fuel_products")
      .update({
        name: readText(form, "name", "Name"),
        price_per_liter: readNumber(form, "price_per_liter", "Pump price"),
        avg_cost_per_liter: readNumber(form, "avg_cost_per_liter", "Average cost"),
      })
      .eq("code", code)
      .select("code");
    check(error);
    if (!data?.length) throw new ActionError("Fuel not found.");
    return `${code} updated. New readings use the new price.`;
  });
}

export async function addFuelProduct(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const code = readText(form, "code", "Code").toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new ActionError("Codes are 2–10 letters or digits, e.g. LPG.");

    const { error } = await supabase.from("fuel_products").insert({
      code,
      name: readText(form, "name", "Name"),
      price_per_liter: readNumber(form, "price_per_liter", "Pump price"),
      avg_cost_per_liter: readNumber(form, "avg_cost_per_liter", "Average cost"),
    });
    if (error?.code === "23505") throw new ActionError(`A fuel with code ${code} already exists.`);
    check(error);
    return `${code} added.`;
  });
}

export async function addTank(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const capacity = readNumber(form, "capacity_liters", "Capacity", { allowZero: false });
    const volume = readNumber(form, "current_volume", "Current volume");
    if (volume > capacity) throw new ActionError("Current volume cannot be more than the capacity.");

    const { error } = await supabase.from("tanks").insert({
      tank_name: readText(form, "tank_name", "Tank name"),
      fuel_type: readText(form, "fuel_type", "Fuel"),
      capacity_liters: capacity,
      current_volume: volume,
      reorder_level_liters: readNumber(form, "reorder_level_liters", "Reorder level"),
    });
    if (error?.code === "23505") throw new ActionError("A tank with that name already exists.");
    check(error);
    return "Tank added. Its opening stock was valued at the fuel's average cost.";
  });
}

export async function updateTank(tankId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase
      .from("tanks")
      .update({
        tank_name: readText(form, "tank_name", "Tank name"),
        capacity_liters: readNumber(form, "capacity_liters", "Capacity", { allowZero: false }),
        reorder_level_liters: readNumber(form, "reorder_level_liters", "Reorder level"),
        is_active: form.get("is_active") === "on",
      })
      .eq("id", tankId)
      .select("id");
    if (error?.code === "23505") throw new ActionError("A tank with that name already exists.");
    check(error);
    if (!data?.length) throw new ActionError("Tank not found.");
    return "Tank updated.";
  });
}

export async function addPump(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.from("pumps").insert({
      pump_number: readText(form, "pump_number", "Pump number").toUpperCase(),
      tank_id: readText(form, "tank_id", "Tank"),
      current_meter: readNumber(form, "current_meter", "Meter reading"),
    });
    if (error?.code === "23505") throw new ActionError("A pump with that number already exists.");
    check(error);
    return "Pump added.";
  });
}

export async function updatePump(pumpId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase
      .from("pumps")
      .update({
        pump_number: readText(form, "pump_number", "Pump number").toUpperCase(),
        tank_id: readText(form, "tank_id", "Tank"),
        current_meter: readNumber(form, "current_meter", "Meter reading"),
        is_active: form.get("is_active") === "on",
      })
      .eq("id", pumpId)
      .select("id");
    if (error?.code === "23505") throw new ActionError("A pump with that number already exists.");
    check(error);
    if (!data?.length) throw new ActionError("Pump not found.");
    return "Pump updated.";
  });
}

export async function updateStaffRole(profileId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const role = readChoice(form, "role", ["owner", "manager", "attendant", "pending"] as const, "Role");
    const { data, error } = await supabase.from("profiles").update({ role }).eq("id", profileId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Staff member not found.");
    return "Role updated.";
  });
}

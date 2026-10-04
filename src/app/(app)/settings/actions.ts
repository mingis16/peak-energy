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
    const details = {
      tank_name: readText(form, "tank_name", "Tank name"),
      capacity_liters: readNumber(form, "capacity_liters", "Capacity", { allowZero: false }),
      reorder_level_liters: readNumber(form, "reorder_level_liters", "Reorder level"),
      is_active: form.get("is_active") === "on",
    };
    // Fuel and stock are on the form only while the tank is unused.
    const stock = form.has("current_volume")
      ? { p_tank_id: tankId, p_fuel_type: readText(form, "fuel_type", "Fuel"), p_volume: readNumber(form, "current_volume", "Stock in tank") }
      : null;
    if (stock && stock.p_volume > details.capacity_liters) {
      throw new ActionError("The stock in the tank cannot be more than its capacity.");
    }

    const { data: tank, error: tankError } = await supabase.from("tanks").select("capacity_liters").eq("id", tankId).maybeSingle();
    check(tankError);
    if (!tank) throw new ActionError("Tank not found.");

    const saveDetails = async () => {
      const { error } = await supabase.from("tanks").update(details).eq("id", tankId);
      if (error?.code === "23505") throw new ActionError("A tank with that name already exists.");
      check(error);
    };
    const saveStock = async () => {
      if (!stock) return;
      const { error } = await supabase.rpc("update_tank_stock", stock);
      check(error);
    };
    // Raise the capacity before adding stock; lower it only after removing stock.
    if (details.capacity_liters >= Number(tank.capacity_liters)) {
      await saveDetails();
      await saveStock();
    } else {
      await saveStock();
      await saveDetails();
    }
    return stock ? "Tank updated. Its opening stock was revalued at the fuel's average cost." : "Tank updated.";
  });
}

export async function removeTank(tankId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.rpc("remove_tank", { p_tank_id: tankId });
    check(error);
    return "Tank removed.";
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
    const is_active = form.get("is_active") === "on";
    // Number, tank and meter are on the form only until the pump's first reading.
    const setup = form.has("current_meter");
    const meter = setup ? readNumber(form, "current_meter", "Meter reading") : null;

    const { data, error } = await supabase
      .from("pumps")
      .update(
        setup
          ? { pump_number: readText(form, "pump_number", "Pump number").toUpperCase(), tank_id: readText(form, "tank_id", "Tank"), is_active }
          : { is_active },
      )
      .eq("id", pumpId)
      .select("id");
    if (error?.code === "23505") throw new ActionError("A pump with that number already exists.");
    check(error);
    if (!data?.length) throw new ActionError("Pump not found.");

    if (meter !== null) {
      const { error: meterError } = await supabase.rpc("set_pump_meter", { p_pump_id: pumpId, p_meter: meter });
      check(meterError);
    }
    return "Pump updated.";
  });
}

/** The owner's correction of a used pump's meter, e.g. after it is replaced. */
export async function correctMeter(pumpId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const { error } = await supabase.rpc("set_pump_meter", {
      p_pump_id: pumpId,
      p_meter: readNumber(form, "new_meter", "New meter reading"),
      p_reason: readText(form, "reason", "Reason"),
    });
    check(error);
    return "Meter corrected. The next reading opens from the new meter.";
  });
}

export async function removePump(pumpId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.rpc("remove_pump", { p_pump_id: pumpId });
    check(error);
    return "Pump removed.";
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

"use server";

import {
  ActionError,
  authorize,
  check,
  continueTo,
  readChoice,
  readInteger,
  readList,
  readNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Actions used by the setup questions as well take a `next` field: on
// success they move on to that step.

type Supabase = Awaited<ReturnType<typeof authorize>>["supabase"];

/** Station settings belong to the owner; the database refuses anyone else. */
async function saveSettings(supabase: Supabase, values: Record<string, unknown>) {
  const { error } = await supabase.from("station_settings").update(values).eq("id", true);
  check(error);
}

export async function updateStation(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const currency = readText(form, "currency_code", "Currency").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new ActionError("Use a 3-letter currency code such as SLE or USD.");
      await saveSettings(supabase, {
        station_name: readText(form, "station_name", "Station name"),
        currency_code: currency,
      });
      return "Station details saved.";
    }),
  );
}

export async function updateControls(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const windowDays = readInteger(form, "attendant_date_window_days", "Dates attendants can use");
      if (windowDays > 7) throw new ActionError("Attendants can be given at most a week either side of today.");
      await saveSettings(supabase, {
        shortage_tolerance: readNumber(form, "shortage_tolerance", "Shortage tolerance"),
        dip_variance_tolerance_percent: readNumber(form, "dip_variance_tolerance_percent", "Dip tolerance"),
        attendant_date_window_days: windowDays,
        attendants_open_shifts: readChoice(form, "shift_opener", ["attendants", "managers"] as const, "Who opens shifts") === "attendants",
        attendants_record_closing_dips:
          readChoice(form, "closing_dips_by", ["managers", "attendants"] as const, "Who records closing dips") === "attendants",
      });
      return "Controls saved.";
    }),
  );
}

export async function updateShifts(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const names = readList(form, "shift_names");
      if (names.length === 0) throw new ActionError("Enter at least one shift.");
      await saveSettings(supabase, { shift_names: names });
      return "Shifts saved. Shifts already opened keep their names.";
    }),
  );
}

export async function updatePayments(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const digital = form.get("accepts_digital_payments") === "on";
      await saveSettings(supabase, {
        accepts_digital_payments: digital,
        accepts_customer_credit: form.get("accepts_customer_credit") === "on",
        ...(digital ? { digital_payments_label: readText(form, "digital_payments_label", "Name for these payments") } : {}),
      });
      return "Payments saved.";
    }),
  );
}

export async function updateBar(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const enabled = form.get("bar_enabled") === "on";
      // Switched off, the bar keeps its name and categories for when it comes back.
      await saveSettings(
        supabase,
        enabled
          ? {
              bar_enabled: true,
              bar_name: readText(form, "bar_name", "Name"),
              bar_item_label: readText(form, "bar_item_label", "Word for one thing sold"),
              bar_categories: readList(form, "bar_categories"),
            }
          : { bar_enabled: false },
      );
      return enabled ? "Saved." : "Saved. Only fuel is sold.";
    }),
  );
}

export async function updateAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      await saveSettings(supabase, {
        managers_view_finances: form.get("managers_view_finances") === "on",
        managers_use_cash_book: form.get("managers_use_cash_book") === "on",
      });
      return "Access saved.";
    }),
  );
}

// ---------------------------------------------------------------------------
// Fuels and equipment (managers)
// ---------------------------------------------------------------------------

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

export async function removeFuelProduct(code: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.rpc("remove_fuel_product", { p_code: code });
    check(error);
    return `${code} removed.`;
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

/** Deletes an unused tank; a used one is retired, keeping its readings, dips and deliveries. */
export async function removeTank(tankId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.rpc("remove_tank", { p_tank_id: tankId });
    check(error);
    return data === "RETIRED"
      ? "Tank removed. Its readings, dips and deliveries stay in the records; restore it under Removed equipment."
      : "Tank deleted.";
  });
}

export async function restoreTank(tankId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.rpc("restore_tank", { p_tank_id: tankId });
    check(error);
    return "Tank restored. Tick “In use” to use it again.";
  });
}

/** Nozzle names are the station's own, e.g. "1A" or "Pump 2 diesel". */
function readNozzleName(form: FormData): string {
  return readText(form, "pump_number", "Nozzle name").replace(/\s+/g, " ");
}

export async function addDispenser(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const name = readText(form, "name", "Pump name").replace(/\s+/g, " ");
    const { error } = await supabase.from("dispensers").insert({ name });
    if (error?.code === "23505") throw new ActionError(`There is already a pump called "${name}".`);
    check(error);
    return `${name} added. Now add its nozzles.`;
  });
}

export async function renameDispenser(dispenserId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const name = readText(form, "name", "Pump name").replace(/\s+/g, " ");
    const { data, error } = await supabase.from("dispensers").update({ name }).eq("id", dispenserId).select("id");
    if (error?.code === "23505") throw new ActionError(`There is already a pump called "${name}".`);
    check(error);
    if (!data?.length) throw new ActionError("Pump not found.");
    return "Pump renamed.";
  });
}

/** Removes a pump with its nozzles: unused nozzles are deleted, used ones retired with their history. */
export async function removeDispenser(dispenserId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.rpc("remove_dispenser", { p_dispenser_id: dispenserId });
    check(error);
    const retired = Number(data ?? 0);
    return retired
      ? `Pump removed. ${retired} nozzle${retired === 1 ? " had" : "s had"} readings, so ${retired === 1 ? "it was" : "they were"} retired with ${retired === 1 ? "its" : "their"} history.`
      : "Pump removed.";
  });
}

export async function addPump(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const name = readNozzleName(form);
    const { error } = await supabase.from("pumps").insert({
      pump_number: name,
      tank_id: readText(form, "tank_id", "Tank"),
      dispenser_id: readOptionalText(form, "dispenser_id"),
      current_meter: readNumber(form, "current_meter", "Meter reading"),
    });
    if (error?.code === "23505") throw new ActionError(`There is already a nozzle called "${name}".`);
    check(error);
    return `Nozzle ${name} added.`;
  });
}

export async function updatePump(pumpId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    // Which pump a nozzle sits on can always change; it does not affect its readings.
    const always = { is_active: form.get("is_active") === "on", dispenser_id: readOptionalText(form, "dispenser_id") };
    // Name, tank and meter are on the form only until the nozzle's first reading.
    const setup = form.has("current_meter");
    const meter = setup ? readNumber(form, "current_meter", "Meter reading") : null;

    const { data, error } = await supabase
      .from("pumps")
      .update(setup ? { ...always, pump_number: readNozzleName(form), tank_id: readText(form, "tank_id", "Tank") } : always)
      .eq("id", pumpId)
      .select("id");
    if (error?.code === "23505") throw new ActionError("There is already a nozzle with that name.");
    check(error);
    if (!data?.length) throw new ActionError("Nozzle not found.");

    if (meter !== null) {
      const { error: meterError } = await supabase.rpc("set_pump_meter", { p_pump_id: pumpId, p_meter: meter });
      check(meterError);
    }
    return "Nozzle saved.";
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

/** Deletes an unused nozzle; a used one is retired, keeping its readings. */
export async function removePump(pumpId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.rpc("remove_pump", { p_pump_id: pumpId });
    check(error);
    return data === "RETIRED"
      ? "Nozzle removed. Its readings stay in the records; restore it under Removed equipment."
      : "Nozzle deleted.";
  });
}

export async function restorePump(pumpId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { error } = await supabase.rpc("restore_pump", { p_pump_id: pumpId });
    check(error);
    return "Nozzle restored. Tick “In use” to use it again.";
  });
}

// ---------------------------------------------------------------------------
// Staff (owner)
// ---------------------------------------------------------------------------

const MEMBER_ROLES = ["manager", "attendant"] as const;

/** Creates a staff account the member can sign in to straight away. */
export async function addMember(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const admin = createAdminClient();
    if (!admin) {
      throw new ActionError(
        "Adding members needs SUPABASE_SERVICE_ROLE_KEY in the server's environment variables (on Vercel: Project → Settings → Environment Variables, then redeploy). Until then, staff can sign up themselves and you give them a role below.",
      );
    }
    const fullName = readText(form, "full_name", "Name");
    const email = readText(form, "email", "Login email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ActionError("Enter the login as an email address, e.g. alie@yourstation.sl.");
    const password = readText(form, "password", "Password");
    if (password.length < 8) throw new ActionError("Use a password of at least 8 characters.");
    const role = readChoice(form, "role", MEMBER_ROLES, "Role");

    // Confirmed on creation, so no email is sent and any address works as a login.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new ActionError(describeAdminError(error));

    // New accounts start without access; the owner's own session gives the role.
    const { error: roleError } = await supabase.from("profiles").update({ role, full_name: fullName }).eq("id", data.user.id);
    if (roleError) {
      throw new ActionError(`The account was created, but its role was not set. Give ${fullName} a role in the list below.`);
    }
    return `${fullName} can now sign in with ${email} and the password ${password}. Give them these details.`;
  });
}

export async function updateMember(profileId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const role = readChoice(form, "role", ["owner", ...MEMBER_ROLES, "pending"] as const, "Role");
    const { data, error } = await supabase
      .from("profiles")
      .update({ role, full_name: readText(form, "full_name", "Name") })
      .eq("id", profileId)
      .select("id");
    check(error);
    if (!data?.length) throw new ActionError("Staff member not found.");
    return role === "pending" ? "Saved. They can no longer see anything." : "Saved.";
  });
}

/** Supabase admin API errors, in words the owner can act on. */
function describeAdminError(error: { message: string; status?: number }): string {
  if (/already/i.test(error.message)) {
    return "An account with that email already exists. Find it in the list below and give it a role.";
  }
  if (error.status === 401 || error.status === 403 || /invalid api key|not allowed|jwt/i.test(error.message)) {
    return "Supabase refused the server's SUPABASE_SERVICE_ROLE_KEY. Check it is the service_role key of this project.";
  }
  return error.message;
}

/** Sets a new password for a member who has forgotten theirs. */
export async function resetMemberPassword(profileId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const admin = createAdminClient();
    if (!admin) throw new ActionError("Setting passwords needs the server's SUPABASE_SERVICE_ROLE_KEY setting.");
    const password = readText(form, "password", "New password");
    if (password.length < 8) throw new ActionError("Use a password of at least 8 characters.");

    const { data: member, error } = await supabase.from("profiles").select("role, full_name").eq("id", profileId).maybeSingle();
    check(error);
    if (!member) throw new ActionError("Staff member not found.");
    if (member.role === "owner") throw new ActionError("Owners change their own passwords.");

    const { error: resetError } = await admin.auth.admin.updateUserById(profileId, { password });
    if (resetError) throw new ActionError(describeAdminError(resetError));
    return `${member.full_name || "They"} can now sign in with the password ${password}.`;
  });
}

// ---------------------------------------------------------------------------
// Cash-book categories (owner)
// ---------------------------------------------------------------------------

export async function addCategory(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const { error } = await supabase.rpc("add_cash_category", {
      p_name: readText(form, "name", "Name"),
      p_type: readChoice(form, "transaction_type", ["EXPENSE", "INCOME"] as const, "Money in or out"),
      p_description: readOptionalText(form, "description"),
      p_account_code: readOptionalText(form, "account_code"),
    });
    check(error);
    return "Category added.";
  });
}

export async function updateCategory(name: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const newName = readText(form, "name", "Name").replace(/\s+/g, " ");
    const { data, error } = await supabase
      .from("transaction_categories")
      .update({
        name: newName,
        description: readOptionalText(form, "description"),
        is_active: form.get("is_active") === "on",
      })
      .eq("name", name)
      .select("name");
    if (error?.code === "23505") throw new ActionError(`There is already a category called "${newName}".`);
    check(error);
    if (!data?.length) throw new ActionError("Category not found.");
    return "Category saved.";
  });
}

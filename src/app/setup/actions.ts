"use server";

import { redirect } from "next/navigation";
import {
  ActionError,
  authorize,
  check,
  continueTo,
  readNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";

/**
 * Saves the fuels the station sells, with their prices, in one go: ticked
 * fuels are updated, unticked ones removed, and another can be added.
 */
export async function saveFuelSetup(_prev: ActionState, form: FormData): Promise<ActionState> {
  return continueTo(
    form,
    await runAction(async () => {
      const { supabase } = await authorize(["owner"]);
      const codes = form.getAll("code").map(String);
      const selling = codes.filter((code) => form.get(`sell_${code}`) === "on");
      const newCode = (readOptionalText(form, "new_code") ?? "").toUpperCase();
      if (selling.length === 0 && !newCode) throw new ActionError("Tick at least one fuel you sell, or add one.");

      for (const code of selling) {
        const { error } = await supabase
          .from("fuel_products")
          .update({
            name: readText(form, `name_${code}`, `${code} name`),
            price_per_liter: readNumber(form, `price_${code}`, `${code} pump price`),
            avg_cost_per_liter: readNumber(form, `cost_${code}`, `${code} cost`),
          })
          .eq("code", code);
        check(error);
      }

      if (newCode) {
        if (!/^[A-Z0-9]{2,10}$/.test(newCode)) throw new ActionError("Fuel codes are 2–10 letters or digits, e.g. LPG.");
        const { error } = await supabase.from("fuel_products").insert({
          code: newCode,
          name: readText(form, "new_name", `${newCode} name`),
          price_per_liter: readNumber(form, "new_price", `${newCode} pump price`),
          avg_cost_per_liter: readNumber(form, "new_cost", `${newCode} cost`),
        });
        if (error?.code === "23505") throw new ActionError(`${newCode} is already on the list.`);
        check(error);
      }

      for (const code of codes.filter((c) => !selling.includes(c))) {
        const { error } = await supabase.rpc("remove_fuel_product", { p_code: code });
        check(error);
      }
      return "Fuels saved.";
    }),
  );
}

/** Marks the station as set up and opens the dashboard. Answers can be changed later in Settings. */
export async function finishSetup(): Promise<ActionState> {
  const result = await runAction(async () => {
    const { supabase } = await authorize(["owner"]);
    const { error } = await supabase
      .from("station_settings")
      .update({ setup_completed_at: new Date().toISOString() })
      .eq("id", true);
    check(error);
    return "Setup finished.";
  });
  if (result?.ok) redirect("/");
  return result;
}

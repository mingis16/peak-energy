"use server";

import { redirect } from "next/navigation";
import {
  ActionError,
  authorize,
  check,
  readDate,
  readNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { isManager, MANAGER_ROLES, STAFF_ROLES } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import type { ShiftStatus } from "@/lib/types";

export async function startShift(_prev: ActionState, form: FormData): Promise<ActionState> {
  let shiftId = "";
  const result = await runAction(async () => {
    const { supabase, profile } = await authorize(STAFF_ROLES);
    const attendantId =
      isManager(profile.role) && form.get("attendant_id") ? String(form.get("attendant_id")) : profile.id;

    const { data, error } = await supabase
      .from("shifts")
      .insert({
        shift_date: readDate(form, "shift_date"),
        // The database checks it is one of the station's shifts.
        shift_label: readText(form, "shift_label", "Shift"),
        attendant_id: attendantId,
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      throw new ActionError("That attendant already has this shift on that date.");
    }
    check(error);
    shiftId = data!.id;
    return "Shift started.";
  });
  if (result?.ok) redirect(`/shifts/${shiftId}`);
  return result;
}

interface PumpRow {
  id: string;
  pump_number: string;
  current_meter: number;
}

/**
 * Saves every pump row that has a closing meter. Rows left blank are skipped.
 * Opening meters are not taken from the form: the database opens each reading
 * where the pump's last one closed.
 */
export async function saveReadings(shiftId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);

    const [{ data: pumps, error: pumpError }, { data: existing, error: readingError }] = await Promise.all([
      supabase.from("pumps").select("id, pump_number, current_meter").order("pump_number"),
      supabase.from("pump_readings").select("id, pump_number, opening_meter, closing_meter").eq("shift_id", shiftId),
    ]);
    check(pumpError);
    check(readingError);

    const byPump = new Map((existing ?? []).map((r) => [r.pump_number, r]));
    let saved = 0;

    for (const pump of (pumps ?? []) as PumpRow[]) {
      const closingRaw = String(form.get(`closing_${pump.id}`) ?? "").trim();
      if (!closingRaw) continue;

      const label = `Nozzle ${pump.pump_number}`;
      const current = byPump.get(pump.pump_number);
      const opening = Number(current?.opening_meter ?? pump.current_meter);
      const closing = readNumber(form, `closing_${pump.id}`, `${label} closing meter`);
      if (closing < opening) {
        throw new ActionError(
          `${label}: closing meter (${closing}) is lower than the opening meter (${opening}).${saved ? ` ${saved} other reading(s) were saved.` : ""}`,
        );
      }

      const { error } = current
        ? Number(current.closing_meter) === closing
          ? { error: null }
          : await supabase.from("pump_readings").update({ closing_meter: closing }).eq("id", current.id)
        : await supabase.from("pump_readings").insert({
            shift_id: shiftId,
            pump_number: pump.pump_number,
            closing_meter: closing,
          });
      if (error) {
        try {
          check(error);
        } catch (e) {
          throw new ActionError(
            `${label}: ${(e as Error).message}${saved ? ` ${saved} other reading(s) were saved.` : ""}`,
          );
        }
      }
      saved++;
    }

    if (saved === 0) throw new ActionError("Enter a closing meter for at least one nozzle.");
    return `Saved ${saved} meter reading${saved === 1 ? "" : "s"}.`;
  });
}

export async function deleteReading(readingId: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const { error } = await supabase.from("pump_readings").delete().eq("id", readingId);
    check(error);
    return "Reading removed.";
  });
}

/** Saves the attendant's declared collections, optionally handing the shift over. */
export async function saveHandover(shiftId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const submit = form.get("intent") === "submit";

    // Payments the station does not take are left off the form, and stay as they are.
    const update: Record<string, unknown> = {
      cash_on_hand: readNumber(form, "cash_on_hand", "Cash on hand"),
      notes: readOptionalText(form, "notes"),
    };
    if (form.has("credit_slips_amount")) update.credit_slips_amount = readNumber(form, "credit_slips_amount", "Credit slips");
    if (form.has("digital_transfers_amount")) {
      update.digital_transfers_amount = readNumber(form, "digital_transfers_amount", "Bank / mobile money");
    }
    if (submit) update.status = "SUBMITTED";

    const { data, error } = await supabase
      .from("shifts")
      .update(update)
      .eq("id", shiftId)
      .select("variance, status")
      .maybeSingle();
    check(error);
    if (!data) throw new ActionError("This shift can no longer be changed.");

    if (data.status === "OPEN") return "Handover saved as a draft.";
    const { data: settings } = await supabase.from("station_settings").select("currency_code").single();
    const currency = settings?.currency_code ?? "SLE";
    const variance = Number(data.variance);
    const verb = submit ? "Shift handed over" : "Corrections saved";
    if (variance < 0) return `${verb}. Shortage of ${formatMoney(-variance, currency)} against the pump meters.`;
    if (variance > 0) return `${verb}. Overage of ${formatMoney(variance, currency)} against the pump meters.`;
    return `${verb}. Collections match the pump meters exactly.`;
  });
}

const REVIEW_TRANSITIONS: Record<string, { status: ShiftStatus; message: string }> = {
  approve: { status: "RECONCILED", message: "Shift reconciled and posted to the ledger." },
  return: { status: "OPEN", message: "Shift sent back to the attendant." },
  reopen: { status: "SUBMITTED", message: "Shift re-opened for review. Its ledger posting was reversed." },
};

export async function reviewShift(shiftId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const transition = REVIEW_TRANSITIONS[String(form.get("intent"))];
    if (!transition) throw new ActionError("Unknown review action.");

    const { data, error } = await supabase
      .from("shifts")
      .update({ status: transition.status })
      .eq("id", shiftId)
      .select("id")
      .maybeSingle();
    check(error);
    if (!data) throw new ActionError("Shift not found.");
    return transition.message;
  });
}

export async function deleteShift(shiftId: string): Promise<ActionState> {
  const result = await runAction(async () => {
    const { supabase } = await authorize(STAFF_ROLES);
    const { data, error } = await supabase.from("shifts").delete().eq("id", shiftId).select("id");
    check(error);
    if (!data?.length) throw new ActionError("This shift can no longer be deleted.");
    return "Shift deleted.";
  });
  if (result?.ok) redirect("/shifts");
  return result;
}

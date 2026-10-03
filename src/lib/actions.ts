import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isISODate, todayISO } from "@/lib/format";
import type { Profile, Role } from "@/lib/types";

export type ActionState = { ok: boolean; message?: string; error?: string } | null;

/** An error whose message is safe to show the user. */
export class ActionError extends Error {}

/**
 * Runs a server action body, turning ActionErrors into form messages.
 * The body returns the success message.
 */
export async function runAction(body: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await body();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ActionError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Re-checks the session inside a server action. RLS still has the final say. */
export async function authorize(roles: Role[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile || !roles.includes(profile.role)) {
    throw new ActionError("You do not have permission to do that.");
  }
  return { supabase, profile };
}

/** Throws a user-facing ActionError for a failed Supabase call. */
export function check(error: PostgrestError | null): void {
  if (!error) return;
  throw new ActionError(describeDbError(error));
}

function describeDbError(error: PostgrestError): string {
  switch (error.code) {
    case "P0001": // raise exception in our triggers — written for users
      return error.message;
    case "42501":
      return "You do not have permission to do that.";
    case "23505":
      return "That record already exists.";
    case "23503":
      return "This record is linked to other records, or refers to one that no longer exists.";
    case "23514":
      return constraintMessage(error.message);
    default:
      console.error("Supabase error", error);
      return error.message || "The database rejected the change.";
  }
}

function constraintMessage(message: string): string {
  if (message.includes("closing_after_opening")) return "Closing meter cannot be lower than the opening meter.";
  if (message.includes("volume_within_capacity")) return "Volume cannot exceed the tank capacity.";
  return "One of the values is out of range.";
}

// ---------------------------------------------------------------------------
// Form field readers
// ---------------------------------------------------------------------------

export function readText(form: FormData, name: string, label: string, required = true): string {
  const value = String(form.get(name) ?? "").trim();
  if (required && !value) throw new ActionError(`${label} is required.`);
  return value;
}

export function readOptionalText(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}

export function readNumber(
  form: FormData,
  name: string,
  label: string,
  { min = 0, allowZero = true }: { min?: number; allowZero?: boolean } = {},
): number {
  const raw = String(form.get(name) ?? "").replace(/,/g, "").trim();
  if (!raw) throw new ActionError(`${label} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ActionError(`${label} must be a number.`);
  if (value < min || (!allowZero && value === 0)) {
    throw new ActionError(`${label} must be ${allowZero ? "at least" : "more than"} ${min}.`);
  }
  return value;
}

export function readOptionalNumber(form: FormData, name: string, label: string): number | null {
  const raw = String(form.get(name) ?? "").trim();
  return raw ? readNumber(form, name, label) : null;
}

export function readInteger(form: FormData, name: string, label: string, min = 0): number {
  const value = readNumber(form, name, label, { min });
  if (!Number.isInteger(value)) throw new ActionError(`${label} must be a whole number.`);
  return value;
}

export function readDate(form: FormData, name: string): string {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return todayISO();
  if (!isISODate(value)) throw new ActionError("Enter a valid date.");
  return value;
}

export function readChoice<T extends string>(form: FormData, name: string, choices: readonly T[], label: string): T {
  const value = String(form.get(name) ?? "") as T;
  if (!choices.includes(value)) throw new ActionError(`Choose a ${label.toLowerCase()}.`);
  return value;
}

export const PAYMENT_METHODS = ["CASH", "BANK", "CREDIT"] as const;

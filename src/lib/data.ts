import type { PostgrestError } from "@supabase/supabase-js";

/** Unwraps a Supabase read for a server component, surfacing failures to the error boundary. */
export function rows<T>(result: { data: unknown; error: PostgrestError | null }, what: string): T[] {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export function row<T>(result: { data: unknown; error: PostgrestError | null }, what: string): T | null {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`);
  return (result.data ?? null) as T | null;
}

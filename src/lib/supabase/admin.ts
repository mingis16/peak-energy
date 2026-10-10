import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase's admin API, for the owner to create staff accounts and reset
 * their passwords. It bypasses row level security, so it is used only for
 * auth calls, and only after the caller is checked to be the owner.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function canCreateAccounts(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

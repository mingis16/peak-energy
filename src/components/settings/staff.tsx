import { KeyRound, UserPlus } from "lucide-react";
import { addMember, resetMemberPassword, updateMember } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary, buttonSmall, inputClass } from "@/components/ui/styles";
import type { Profile } from "@/lib/types";
import { PasswordInput } from "./password-input";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "attendant", label: "Attendant" },
  { value: "pending", label: "No access" },
];

/** The link staff open on their own phone or computer to create an account. */
export function SignupLink({ url }: { url: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
      <span>Staff can also sign up themselves at</span>
      <span className="break-all font-medium text-zinc-900 dark:text-zinc-50">{url}</span>
      <CopyButton text={url} />
      <span className="w-full text-xs text-zinc-500 dark:text-zinc-400">
        They see nothing until you give them a role in the list below.
      </span>
    </div>
  );
}

/**
 * The owner adds staff with a login and a temporary password. This needs the
 * server's service role key; without it, staff sign up themselves instead.
 */
export function AddMemberForm({ canCreate, signupUrl }: { canCreate: boolean; signupUrl: string }) {
  return (
    <div className="flex flex-col gap-4">
      {canCreate ? (
        <ActionForm action={addMember} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
          <Field label="Name" htmlFor="member_name">
            <input id="member_name" name="full_name" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Login email" htmlFor="member_email" hint="No email is sent. Any address works, e.g. alie@yourstation.sl.">
            <input id="member_email" name="email" type="email" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Temporary password" htmlFor="member_password" hint="At least 8 characters. Give it to them.">
            <PasswordInput id="member_password" className={inputClass} />
          </Field>
          <Field label="Role" htmlFor="member_role">
            <select id="member_role" name="role" defaultValue="attendant" className={inputClass}>
              <option value="attendant">Attendant</option>
              <option value="manager">Manager</option>
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <SubmitButton>
              <UserPlus aria-hidden className="h-4 w-4" /> Add member
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          To add members yourself, with a login and temporary password you choose, the server needs Supabase&apos;s{" "}
          <code className="text-xs">SUPABASE_SERVICE_ROLE_KEY</code> (Supabase → Project Settings → API). Add it to the
          environment variables (on Vercel: Project → Settings → Environment Variables) and redeploy.
        </p>
      )}
      <SignupLink url={signupUrl} />
    </div>
  );
}

export function MemberList({ staff, me, canCreate }: { staff: Profile[]; me: string; canCreate: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
      {staff.map((person) => (
        <li key={person.id} className="flex flex-col gap-2 py-3">
          <ActionForm
            action={updateMember.bind(null, person.id)}
            resetOnSuccess={false}
            className="grid items-center gap-2 sm:grid-cols-[1fr_11rem_auto]"
          >
            <label htmlFor={`member-name-${person.id}`} className="sr-only">
              Name
            </label>
            <input
              id={`member-name-${person.id}`}
              name="full_name"
              defaultValue={person.full_name}
              placeholder="Name"
              required
              className={inputClass}
            />
            <label htmlFor={`member-role-${person.id}`} className="sr-only">
              Role
            </label>
            <select id={`member-role-${person.id}`} name="role" defaultValue={person.role} className={inputClass}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <SubmitButton className={buttonSecondary}>Save</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {person.email}
              {person.id === me && <span>· you</span>}
              {person.role === "pending" && <StatusBadge tone="warning">No access yet</StatusBadge>}
            </p>
            {canCreate && person.role !== "owner" && (
              <details className="w-full sm:w-auto">
                <summary className={`${buttonSecondary} ${buttonSmall} cursor-pointer list-none`}>
                  <KeyRound aria-hidden className="h-3.5 w-3.5" /> Set a new password
                </summary>
                <ActionForm action={resetMemberPassword.bind(null, person.id)} className="mt-2 flex flex-wrap items-center gap-2">
                  <label htmlFor={`member-password-${person.id}`} className="sr-only">
                    New password
                  </label>
                  <PasswordInput id={`member-password-${person.id}`} placeholder="New password" className={`${inputClass} w-44`} />
                  <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Set password</SubmitButton>
                </ActionForm>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

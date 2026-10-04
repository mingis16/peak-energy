import { startShift } from "@/app/(app)/shifts/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { attendantDateLimits, todayISO } from "@/lib/format";
import type { Profile } from "@/lib/types";

/** Opens a shift. Managers can open one for any attendant; attendants open their own. */
export function StartShiftForm({ staff, currentUserId }: { staff?: Profile[]; currentUserId: string }) {
  return (
    <ActionForm action={startShift} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <Field label="Date" htmlFor="shift_date">
        <input
          id="shift_date"
          name="shift_date"
          type="date"
          defaultValue={todayISO()}
          required
          // Only managers (who get the staff list) may open shifts on other days.
          {...(staff ? {} : attendantDateLimits())}
          className={inputClass}
        />
      </Field>
      <Field label="Shift" htmlFor="shift_label">
        <select id="shift_label" name="shift_label" defaultValue="Morning" className={inputClass}>
          <option>Morning</option>
          <option>Afternoon</option>
          <option>Night</option>
          <option value="Day">Full day</option>
        </select>
      </Field>
      {staff && (
        <Field label="Attendant" htmlFor="attendant_id">
          <select id="attendant_id" name="attendant_id" defaultValue={currentUserId} className={inputClass}>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || person.email}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div>
        <SubmitButton>Start shift</SubmitButton>
      </div>
    </ActionForm>
  );
}

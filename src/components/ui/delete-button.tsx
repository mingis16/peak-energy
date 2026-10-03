import { Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { buttonDanger, buttonSmall } from "./styles";

/** A one-click delete with a confirmation prompt; errors show inline. */
export function DeleteButton({
  action,
  confirm,
  label = "Delete",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  confirm: string;
  label?: string;
}) {
  return (
    <ActionForm action={action} showSuccess={false} className="flex flex-col items-end gap-1 whitespace-normal">
      <SubmitButton className={`${buttonDanger} ${buttonSmall}`} confirm={confirm}>
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        <span className="sr-only sm:not-sr-only">{label}</span>
      </SubmitButton>
    </ActionForm>
  );
}

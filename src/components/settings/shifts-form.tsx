"use client";

import { useRef, useState } from "react";
import { updateShifts } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { SHIFT_PATTERNS } from "@/lib/station";
import { NextStep } from "./next-step";

const optionCard =
  "flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm has-[:checked]:border-zinc-900 dark:border-zinc-800 dark:has-[:checked]:border-zinc-100";

function namesOf(text: string) {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The station's shift pattern: a common one, or its own names. */
export function ShiftsForm({
  shiftNames,
  next,
  submitLabel = "Save shifts",
}: {
  shiftNames: string[];
  next?: string;
  submitLabel?: string;
}) {
  const [text, setText] = useState(shiftNames.join("\n"));
  const matching = SHIFT_PATTERNS.find((p) => p.names.join("|") === namesOf(text).join("|"));
  const [custom, setCustom] = useState(!matching);
  const textRef = useRef<HTMLTextAreaElement>(null);

  return (
    <ActionForm action={updateShifts} resetOnSuccess={false} className="flex flex-col gap-4">
      <NextStep next={next} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">How do you run shifts?</legend>
        {SHIFT_PATTERNS.map((pattern) => (
          <label key={pattern.label} className={optionCard}>
            <input
              type="radio"
              name="shift_pattern"
              checked={!custom && matching === pattern}
              onChange={() => {
                setCustom(false);
                setText(pattern.names.join("\n"));
              }}
            />
            <span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{pattern.label}</span>
              <span className="text-zinc-500 dark:text-zinc-400"> · {pattern.names.join(", ")}</span>
            </span>
          </label>
        ))}
        <label className={optionCard}>
          <input
            type="radio"
            name="shift_pattern"
            checked={custom || !matching}
            onChange={() => {
              setCustom(true);
              textRef.current?.focus();
            }}
          />
          <span className="font-medium text-zinc-900 dark:text-zinc-50">Our own shift names</span>
        </label>
      </fieldset>
      <Field
        label="Shift names"
        htmlFor="shift_names"
        hint="One per line, up to 6. Attendants pick one when a shift starts; shifts already opened keep their names."
      >
        <textarea
          ref={textRef}
          id="shift_names"
          name="shift_names"
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCustom(true);
          }}
          className={inputClass}
        />
      </Field>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

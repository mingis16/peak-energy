"use client";

import { useState } from "react";
import { updateBar } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import { BAR_PRESETS } from "@/lib/station";
import type { StationSettings } from "@/lib/types";
import { NextStep } from "./next-step";

const optionCard =
  "flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm has-[:checked]:border-zinc-900 dark:border-zinc-800 dark:has-[:checked]:border-zinc-100";

const KINDS = [
  { id: "none", label: "Nothing else: we sell fuel only" },
  ...BAR_PRESETS.map((p) => ({ id: p.id, label: p.label })),
  { id: "other", label: "Something else" },
];

/** What the station sells besides fuel: a starting point, then its own name and categories. */
export function BarForm({
  settings,
  next,
  submitLabel = "Save",
}: {
  settings: Pick<StationSettings, "bar_enabled" | "bar_name" | "bar_item_label" | "bar_categories">;
  next?: string;
  submitLabel?: string;
}) {
  const [kind, setKind] = useState(() =>
    !settings.bar_enabled
      ? "none"
      : (BAR_PRESETS.find((p) => p.name === settings.bar_name && p.item === settings.bar_item_label)?.id ?? "other"),
  );
  const [name, setName] = useState(settings.bar_name);
  const [item, setItem] = useState(settings.bar_item_label);
  const [categories, setCategories] = useState(settings.bar_categories.join("\n"));

  function choose(id: string) {
    setKind(id);
    const preset = BAR_PRESETS.find((p) => p.id === id);
    if (preset) {
      setName(preset.name);
      setItem(preset.item);
      setCategories(preset.categories.join("\n"));
    }
  }

  return (
    <ActionForm action={updateBar} resetOnSuccess={false} className="flex flex-col gap-4">
      <NextStep next={next} />
      {kind !== "none" && <input type="hidden" name="bar_enabled" value="on" />}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Do you sell anything besides fuel?
        </legend>
        {KINDS.map((k) => (
          <label key={k.id} className={optionCard}>
            <input type="radio" name="bar_kind" checked={kind === k.id} onChange={() => choose(k.id)} />
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{k.label}</span>
          </label>
        ))}
      </fieldset>

      {kind !== "none" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What you call it" htmlFor="bar_name" hint="Shown in the menu, e.g. Bar, Shop or Peak Lounge.">
            <input
              id="bar_name"
              name="bar_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={30}
              className={inputClass}
            />
          </Field>
          <Field label="One thing you sell is a…" htmlFor="bar_item_label" hint="e.g. drink, item or product.">
            <input
              id="bar_item_label"
              name="bar_item_label"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              required
              maxLength={20}
              className={inputClass}
            />
          </Field>
          <Field
            label="Categories"
            htmlFor="bar_categories"
            hint="One per line. Used to group the stock list."
            className="sm:col-span-2"
          >
            <textarea
              id="bar_categories"
              name="bar_categories"
              rows={5}
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      )}
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

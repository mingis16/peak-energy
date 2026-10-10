"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonSecondary, buttonSmall } from "./styles";

/** Copies text, such as a link to send to staff. */
export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // The clipboard needs https; on a plain-http address, select the text instead.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" onClick={copy} className={`${buttonSecondary} ${buttonSmall}`}>
      {state === "copied" ? <Check aria-hidden className="h-3.5 w-3.5 text-good" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy it" : label}
    </button>
  );
}

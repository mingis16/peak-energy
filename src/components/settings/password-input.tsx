"use client";

import { useRef } from "react";
import { buttonSecondary } from "@/components/ui/styles";

// No look-alike characters (0/O, 1/l/I), so a password read out loud or
// copied from a screen is typed right first time.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function temporaryPassword(length = 10): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(length)), (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/** A password field for one the owner gives a member, with a generator. */
export function PasswordInput({
  id,
  name = "password",
  placeholder,
  className,
}: {
  id: string;
  name?: string;
  placeholder?: string;
  className: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex gap-2">
      <input
        ref={input}
        id={id}
        name={name}
        type="text"
        minLength={8}
        required
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={() => {
          if (input.current) input.current.value = temporaryPassword();
        }}
        className={`${buttonSecondary} shrink-0 px-3`}
      >
        Generate
      </button>
    </div>
  );
}

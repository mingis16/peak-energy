import type { Metadata } from "next";
import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { AuthCard } from "@/components/shell/auth-card";
import { Field } from "@/components/ui/field";
import { buttonPrimary, inputClass } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { error } = await searchParams;

  return (
    <AuthCard
      title="Create your account"
      subtitle="The first account becomes the station owner and answers a few questions to set the app up. Staff who sign up wait for the owner to give them a role."
    >
      <form action={signup} className="mt-6 flex flex-col gap-4">
        <Field label="Full name" htmlFor="full_name">
          <input id="full_name" name="full_name" required autoComplete="name" className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>

        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

        <button type="submit" className={`${buttonPrimary} mt-2`}>
          Create account
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}

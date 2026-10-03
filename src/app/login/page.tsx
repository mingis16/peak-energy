import type { Metadata } from "next";
import Link from "next/link";
import { login } from "@/app/auth/actions";
import { AuthCard } from "@/components/shell/auth-card";
import { Field } from "@/components/ui/field";
import { buttonPrimary, inputClass } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, message } = await searchParams;

  return (
    <AuthCard title="SmartStation Pro" subtitle="Sign in to manage your station.">
      <form action={login} className="mt-6 flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </Field>

        {message && <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>}
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

        <button type="submit" className={`${buttonPrimary} mt-2`}>
          Sign in
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        New staff member?{" "}
        <Link href="/signup" className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { AuthCard } from "@/components/shell/auth-card";
import { buttonSecondary } from "@/components/ui/styles";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Awaiting approval" };

export default async function PendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile && session.profile.role !== "pending") redirect("/");

  return (
    <AuthCard
      title="Waiting for approval"
      subtitle={
        session.profile
          ? `You're signed in as ${session.profile.email}. The station owner needs to give you a role before you can use SmartStation Pro.`
          : "Your staff profile could not be found. Check that the database migrations have been applied, then sign in again."
      }
    >
      <form action={signOut} className="mt-6">
        <button type="submit" className={`${buttonSecondary} w-full`}>
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}

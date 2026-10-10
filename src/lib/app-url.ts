import "server-only";
import { headers } from "next/headers";

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(url);

/**
 * The address people open the app at, for links shown on screen, such as the
 * staff sign-up link. In order: the configured NEXT_PUBLIC_APP_URL (or
 * NEXT_PUBLIC_SITE_URL), Vercel's production domain, then the address this
 * request came in on. A localhost setting left over from development is
 * never used on a live site, where staff open links on their own phones.
 */
export async function appUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0] ?? (host && /^(localhost|127\.)/.test(host) ? "http" : "https");
  const fromRequest = host ? `${protocol}://${host}` : null;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || null;
  const live = fromRequest !== null && !isLocal(fromRequest);

  const chosen =
    [configured, vercel, fromRequest].find((url): url is string => Boolean(url) && !(live && isLocal(url!))) ?? "";
  return chosen.replace(/\/+$/, "");
}

/** Where staff create their own accounts. */
export async function signupUrl(): Promise<string> {
  return `${await appUrl()}/signup`;
}

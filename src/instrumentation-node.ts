import { Agent, setGlobalDispatcher } from "undici";

// Stations are often on slow mobile connections, where the TLS handshake with
// Supabase alone can take several seconds. Node's fetch gives up connecting
// after 10 s ("fetch failed") and drops idle connections after 4 s, so most
// requests paid for a new handshake. Allow longer to connect, and keep
// connections open so the slow handshake happens once rather than every time.
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 30_000 },
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 10 * 60_000,
  }),
);

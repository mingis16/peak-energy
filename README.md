# SmartStation Pro — Peak Energy

Petrol station management and accounting: wet and dry stock, pump meter sales, shift reconciliation, an automatic double-entry ledger, and a live owner/manager dashboard.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Lucide · Supabase (Postgres, RLS, Realtime) · Vercel

## What it does

| Module | Where | Highlights |
|---|---|---|
| Inventory & tanks | `/tanks`, `/settings` | Tank levels against reorder thresholds and days of cover; opening and closing dips; deliveries with transit-loss tracking; a daily wet-stock reconciliation (opening + deliveries − meter sales vs closing dip) |
| Shop & lubricants | `/shop` | SKU stock, low-stock flags, sales at shelf price, restocks at weighted-average cost |
| Shifts | `/shifts` | Attendants log opening and closing meters per pump. The handover (cash, credit slips, bank/mobile money) is compared with meter sales and any shortage is flagged immediately. A manager approves the shift to post it to the ledger |
| Accounting | `/accounting` | Profit & loss (gross and net), a cash book for expenses and other money in or out, the general ledger, and a trial balance |
| Dashboard | `/` | Live KPIs: volume sold, cash collected vs expected, gross/net earnings, tank status, 14-day sales chart. Updates through Supabase Realtime |

### Roles

The first account to sign up becomes the **owner**. Everyone after that starts as **pending** and sees nothing until the owner assigns a role in Settings → Staff.

| Role | Can |
|---|---|
| Owner | Everything, including staff roles |
| Manager | Prices, tanks, pumps, deliveries, shift approval, accounts |
| Attendant | Their own shifts and meter readings, tank dips, shop sales |

Every permission is enforced in Postgres with row-level security, so the UI cannot be bypassed through the API.

## How the books are kept

Each operational record posts its own balanced journal entry through database triggers. Nobody writes to the journal directly.

| Event | Debit | Credit |
|---|---|---|
| Fuel delivery | Fuel Inventory | Accounts Payable (or Cash/Bank if paid on delivery) |
| Shift approved | Cash, Bank, Receivables (credit slips), Cash Shortages | Fuel Sales, Cash Overages |
| …and its cost | Cost of Fuel Sold | Fuel Inventory |
| Closing dip below book | Fuel Stock Losses | Fuel Inventory (reversed for a gain) |
| Shop sale | Cash/Bank/Receivables, Cost of Shop Goods | Shop Sales, Shop Inventory |
| Cash-book expense | Category account (e.g. Salaries) | Cash/Bank/Payable |

- **Cost of goods sold** uses the weighted average cost per litre, which each delivery updates. The waybill amount is what you pay, so transit loss raises the cost of the litres actually received.
- **Gross profit** = revenue − COGS (including dip losses). **Net profit** = gross profit − operating expenses + other income.
- **Fuel Purchase** in the cash book pays a supplier, which clears the payable from the delivery. Fuel only reaches profit as COGS when it is sold, so it is never counted twice.
- The dashboard is live: it counts meter readings from shifts that are still open. The P&L under Accounts counts only approved shifts. Once every shift is approved, the two match.

### Stock rules worth knowing

- Tank book volume changes only through meter readings, deliveries and closing dips. Set the starting volume once, when you add the tank; it is valued at the fuel's average cost as opening stock.
- A **closing dip** resets book stock to the physical measurement and posts the difference. Record it after the day's last meter readings. Once a closing dip exists, movements for that tank on or before that date are locked; delete the dip first to correct them.
- Readings lock when a shift is handed over. A manager can send the shift back to unlock them, or re-open an approved shift, which reverses its posting.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/`, in filename order:
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`
   - **Dashboard:** paste each file into the SQL Editor and run them in order.
3. Under **Authentication → URL Configuration**, set the Site URL to your app's URL and add `<your-url>/auth/callback` to the redirect URLs.

`supabase/seed.sql` holds demo tanks, pumps, prices and shop items for local development (`supabase db reset` applies it). Don't run it against a live station.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` key |
| `NEXT_PUBLIC_SITE_URL` | The app's public URL (used in confirmation emails) |
| `NEXT_PUBLIC_STATION_TIMEZONE` | Defaults to `Africa/Freetown` |

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up (you become the owner), then in **Settings**:

1. Set the station name, currency (default `SLE`) and shortage tolerance.
2. Set the pump price and average cost for each fuel.
3. Add tanks with their current dipped volume, then the pumps that draw from them.
4. Have staff sign up, then assign their roles.

### 4. Deploy to Vercel

Import the repository in Vercel, add the four environment variables above, and deploy. Then add the production URL to Supabase's redirect URLs.

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # route types + tsc
npm run test:db     # migrations + business rules against an embedded Postgres (PGlite)
npm run build
```

`npm run test:db` applies every migration to an in-memory Postgres with Supabase's `auth` schema stubbed. It then runs a full station day: shifts, readings, handover, reconciliation, deliveries, dips, shop sales and the cash book. It asserts every posting, the P&L, the trial balance and the RLS rules for each role.

### Layout

```
supabase/
  migrations/   schema · reference data · triggers & posting rules · reporting views/RPCs · RLS
  tests/        database test suite
  seed.sql      demo data
src/
  app/(app)/    dashboard, shifts, tanks, shop, accounting, settings (+ server actions)
  app/login, signup, pending, auth/   authentication
  components/   ui kit, app shell, charts, dashboard and shift components
  lib/          Supabase clients, auth guards, action helpers, formatting, types
  proxy.ts      session refresh and route protection
```

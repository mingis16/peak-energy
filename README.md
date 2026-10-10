# SmartStation Pro — Peak Energy

Petrol station management and accounting: wet and dry stock, pump meter sales, shift reconciliation, an automatic double-entry ledger, and a live owner/manager dashboard.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Lucide · Supabase (Postgres, RLS, Realtime) · Vercel

## What it does

| Module | Where | Highlights |
|---|---|---|
| Inventory & tanks | `/tanks`, `/settings` | Tank levels against reorder thresholds and days of cover; opening and closing dips; deliveries with transit-loss tracking; a daily wet-stock reconciliation (opening + deliveries − meter sales vs closing dip) |
| Besides fuel | `/bar` | Whatever else the station sells (a bar, a shop, lubricants), under the name the owner gives it: items, opening counts and restocks at weighted-average cost, sales at the set price, low-stock flags. Can be switched off |
| Shifts | `/shifts` | The station's own shifts (Day/Night, Morning/Afternoon/Night…). Attendants log closing meters per pump; each opening meter is where the pump last closed. The handover (cash, plus credit slips and bank/mobile money where the station takes them) is compared with meter sales and any shortage is flagged immediately. A manager approves the shift to post it to the ledger |
| Accounting | `/accounting` | Profit & loss (gross and net), a cash book for expenses and other money in or out, the general ledger, and a trial balance |
| Dashboard | `/` | Live KPIs: volume sold, cash collected vs expected, gross/net earnings, tank status, 14-day sales chart. Updates through Supabase Realtime |
| Activity | `/activity` | Owner only: cash shortages by attendant, every pump meter correction, and a log of edits and deletions with who made them |
| Setup | `/setup` | The questions a new owner answers on first sign-in, so the app fits how the station runs |
| Settings | `/settings` | Every answer, editable later: station, controls, fuels and equipment, shifts and payments, what is sold besides fuel, cash-book categories, staff and who sees what |

### Setting up a station

The first account to sign up becomes the **owner**, and is taken through a few questions before anything else:

1. **Your station**: name and currency.
2. **Fuels and prices**: which fuels are sold, pump price and cost per litre.
3. **Tanks**: each tank's fuel, capacity, today's dipped stock and reorder level.
4. **Pumps and nozzles**: each pump, then its nozzles, with the tank each draws from and its meter reading now.
5. **Shifts**: one a day, day and night, three shifts, or the station's own names.
6. **Payments**: whether customers pay by bank/mobile money (and what the station calls it, e.g. "Orange Money") and whether they buy on credit. Handover forms show only these.
7. **Besides fuel**: a bar, a shop, lubricants or nothing; its name, what one thing sold is called, and its categories. The menu, pages and ledger use these words.
8. **Controls**: who opens shifts, who records closing dips, how far from today attendants may date records, and the shortage and dip tolerances.
9. **Who sees what**: whether managers may use the cash book and see the accounts.
10. **Your team**: add managers and attendants.

Any step can be skipped, and every answer can be changed later in Settings, which the owner can also use to run through the questions again. A station that was already in use when this arrived keeps working as a club bar and is not asked the questions.

### Roles and who sees what

| | Owner | Manager | Attendant |
|---|---|---|---|
| Shifts and meter readings | ✓ | ✓, and approves them | Their own |
| Tank levels and opening dips | ✓ | ✓ | ✓ |
| Closing dips and deliveries | ✓ | ✓ | Closing dips, if the owner allows |
| Sales besides fuel | ✓ | ✓, with stock and prices | Sales |
| Fuel prices, tanks and pumps | ✓ | ✓ | — |
| Cash book | ✓ | If the owner allows | — |
| Accounts: profit & loss, ledger, balances, and costs and profit on the dashboard | ✓ | If the owner allows | — |
| Staff, station settings, meter corrections, activity log | ✓ | — | — |

Managers cannot see the cash book or the accounts until the owner allows it (Settings → Staff & access). Every permission is enforced in Postgres with row-level security, so the UI cannot be bypassed through the API: a manager without access gets no ledger rows, no cash-book rows, and no cost or profit figures from the dashboard functions.

### Staff

The owner adds members in Settings → Staff & access with a name, a login email, a temporary password (or a generated one) and a role, and the member can sign in straight away. No email is sent, so any address works as a login. The owner can also set a new password for a member who forgets theirs, or set someone who has left to **No access**. Adding members and setting passwords use Supabase's admin API, so they need `SUPABASE_SERVICE_ROLE_KEY` on the server (see Environment).

Staff can also sign up themselves with the link shown under Staff & access; they start with no access until the owner gives them a role. The link uses the app's live address: `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_SITE_URL`) if set, otherwise Vercel's production domain, otherwise the address the owner opened the page at. A `localhost` setting is never used on a live site.

### Equipment setup

The forecourt is tanks, pumps and nozzles, in any number (Settings → Fuel & equipment). Each pump has one or more nozzles; each nozzle has its own name, its own meter and draws from one tank. Owners and managers add, edit and remove all three.

- Until a tank has its first reading, dip or delivery, its fuel and the stock in it can be set; the opening stock is revalued to match. After that, stock changes only through readings, dips and deliveries.
- Until a nozzle has its first reading, its name, tank and meter can be set. Which pump it is on can always change.
- **Removing** a tank or nozzle that was never used deletes it. One that has been used is **retired**: it leaves daily use and the settings lists, every shift, reading, dip and delivery that refers to it stays as it was, and it can be restored under *Removed*. Removing a pump does the same for each of its nozzles. A tank cannot be removed while nozzles still draw from it, and a nozzle cannot be removed while it has a reading in an open shift.

### Fraud controls

- **Meter chain.** Every reading opens where the pump's last reading closed; nobody types an opening meter. A reading can no longer change once a later one builds on it, so litres cannot go missing between shifts.
- **Meter corrections.** Once a pump is in use, only the owner can change its meter, with a reason (meter replaced, repaired). Every change is listed under Activity.
- **No backdating.** Attendants can only date shifts, sales and dips today, or within the leeway the owner sets (a day either side by default, for night shifts). Managers can record earlier days.
- **Separation of duties.** Closing dips, which reset stock and reveal losses, are recorded by a manager, not by the attendants who sold the fuel, unless the owner allows it (a small station with one person on duty).
- **Owner's settings.** Only the owner changes the station's settings: tolerances, controls, shifts, payments, access and staff, since loosening them can hide shortages.
- **Audit log.** Edits and deletions of readings, shifts, sales, deliveries, dips, prices, equipment, settings, roles, cash-book entries and categories are logged with who made them and what changed. The log is written by database triggers and cannot be edited or deleted by anyone through the app.

## How the books are kept

Each operational record posts its own balanced journal entry through database triggers. Nobody writes to the journal directly.

| Event | Debit | Credit |
|---|---|---|
| Fuel delivery | Fuel Inventory | Accounts Payable (or Cash/Bank if paid on delivery) |
| Shift approved | Cash, Bank, Receivables (credit slips), Cash Shortages | Fuel Sales, Cash Overages |
| …and its cost | Cost of Fuel Sold | Fuel Inventory |
| Closing dip below book | Fuel Stock Losses | Fuel Inventory (reversed for a gain) |
| Sale besides fuel | Cash/Bank/Receivables, Cost of Bar Sales | Bar Sales, Bar Inventory |
| Cash-book expense | Category account (e.g. Salaries) | Cash/Bank/Payable |

- **Cost of goods sold** uses the weighted average cost per litre, which each delivery updates. The waybill amount is what you pay, so transit loss raises the cost of the litres actually received.
- **Gross profit** = revenue − COGS (including dip losses). **Net profit** = gross profit − operating expenses + other income.
- The three bar accounts, and the cash-book category for paying its suppliers, carry the name the owner gives it (e.g. "Shop Sales", "Cost of Shop Sales").
- Cash-book categories are the owner's: rename them, switch them off, or add one, either on its own profit & loss line or posting to an existing account.
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

`supabase/seed.sql` holds demo tanks, pumps, prices and bar stock for local development (`supabase db reset` applies it). Don't run it against a live station.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` key |
| `NEXT_PUBLIC_SITE_URL` | The app's public URL, e.g. `https://peak-energy-omega.vercel.app`, for the staff sign-up link and confirmation emails. `NEXT_PUBLIC_APP_URL` works too. Optional on Vercel, which supplies its production domain |
| `NEXT_PUBLIC_STATION_TIMEZONE` | Defaults to `Africa/Freetown` |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional. Project Settings → API → `service_role` key. Lets the owner add staff and set their passwords. Server only: never give it a `NEXT_PUBLIC_` prefix or share it |

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3001 and sign up. You become the owner and answer the setup questions: station, fuels, tanks, pumps, shifts, payments, what you sell besides fuel, controls, access and staff.

### 4. Deploy to Vercel

Import the repository in Vercel, add the environment variables above, and deploy. Then add the production URL to Supabase's redirect URLs.

## Development

```bash
npm run lint        # ESLint
npm run typecheck   # route types + tsc
npm run test:db     # migrations + business rules against an embedded Postgres (PGlite)
npm run build
```

`npm run test:db` applies every migration to an in-memory Postgres with Supabase's `auth` schema stubbed. It then runs a full station day: shifts, readings, handover, reconciliation, deliveries, dips, bar sales and the cash book. It asserts every posting, the P&L, the trial balance, the RLS rules for each role, who sees the accounts and cash book, the fraud controls and every station setting, and checks that the shop-to-bar and customisation migrations carry existing rows over.

### Layout

```
supabase/
  migrations/   schema · reference data · triggers & posting rules · reporting views/RPCs · RLS
  tests/        database test suite
  seed.sql      demo data
src/
  app/(app)/    dashboard, shifts, tanks, bar, accounting, settings (+ server actions)
  app/setup/    the owner's setup questions
  app/login, signup, pending, auth/   authentication
  components/   ui kit, app shell, charts, dashboard, shift and settings components
  lib/          Supabase clients, auth and access guards, action helpers, formatting, station wording, types
  proxy.ts      session refresh and route protection
```

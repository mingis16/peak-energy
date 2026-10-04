import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const db = new PGlite();

let failures = 0;
let passes = 0;
function check(label, cond, extra) {
  if (cond) {
    passes++;
    console.log("  ok   " + label);
  } else {
    failures++;
    console.log("  FAIL " + label + (extra !== undefined ? " -> " + JSON.stringify(extra) : ""));
  }
}
const num = (v) => (v === null || v === undefined ? v : Number(v));

// --- Supabase stand-ins -----------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
`);

// Shop rows written under the old schema, to check the bar migration carries
// them over the way it will on a live database.
const BAR_MIGRATION = "20261004000100_shop_to_bar.sql";
let LEGACY_ITEM;
async function writeLegacyShopRows() {
  LEGACY_ITEM = (await db.query(`insert into shop_inventory (item_name, sku, category, quantity_in_stock, cost_price, selling_price, reorder_threshold)
    values ('Engine oil 1L', 'OIL-1L', 'Lubricants', 24, 20, 30, 5) returning id`)).rows[0].id;
  await db.query(`insert into shop_sales (item_id, quantity, sale_date) values ($1, 4, '2026-09-15')`, [LEGACY_ITEM]);
  await db.query(`insert into financial_transactions (transaction_date, category, amount, transaction_type)
    values ('2026-09-15', 'Shop Supplier Payment', 300, 'EXPENSE')`);
}

for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  try {
    if (file === BAR_MIGRATION) await writeLegacyShopRows();
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    console.log("applied " + file);
  } catch (e) {
    console.log("MIGRATION FAILED " + file + ": " + e.message);
    process.exit(1);
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function expectError(label, fn, pattern) {
  try {
    await fn();
    check(label + " (expected error)", false, "no error");
  } catch (e) {
    const ok = pattern ? pattern.test(e.message) : true;
    check(label + " — " + e.message.slice(0, 110), ok, e.message);
  }
}

const OWNER = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";
const ATTENDANT = "00000000-0000-0000-0000-00000000000c";
const PENDING = "00000000-0000-0000-0000-00000000000d";

console.log("\n== shop → bar migration");
const legacyItem = await one(`select quantity_in_stock from bar_inventory where id = $1`, [LEGACY_ITEM]);
check("existing items carry over to bar_inventory", legacyItem?.quantity_in_stock === 20, legacyItem);
const legacySale = await one(`select je.source_type from bar_sales s join journal_entries je on je.id = s.journal_entry_id where s.item_id = $1`, [LEGACY_ITEM]);
check("existing sales keep their postings, now typed BAR_SALE", legacySale?.source_type === "BAR_SALE", legacySale);
const legacyTx = await one(`select category from financial_transactions where amount = 300`);
check("cash-book entries follow the renamed supplier category", legacyTx?.category === "Bar Supplier Payment", legacyTx);
const barAccounts = (await q(`select name from accounts where code in ('1210', '4010', '5010') order by code`)).map((a) => a.name);
check("bar accounts renamed", barAccounts.join("|") === "Bar Inventory|Bar Sales|Cost of Bar Sales", barAccounts);
const leftovers = await q(`
  select relname as name from pg_class where relnamespace = 'public'::regnamespace and relname like '%shop%'
  union all select conname from pg_constraint where connamespace = 'public'::regnamespace and conname like '%shop%'
  union all select policyname from pg_policies where schemaname = 'public' and policyname like '%shop%'
  union all select tgname from pg_trigger where not tgisinternal and tgname like '%shop%'
  union all select proname from pg_proc where pronamespace = 'public'::regnamespace and (proname like '%shop%' or prosrc ilike '%shop%')`);
check("nothing in the schema still refers to the shop", leftovers.length === 0, leftovers);

console.log("\n== profiles & roles");
await q(`insert into auth.users (id, email, raw_user_meta_data) values
  ($1, 'owner@x.sl', '{"full_name":"Owner One"}'),
  ($2, 'mgr@x.sl', '{"full_name":"Mary Manager"}'),
  ($3, 'att@x.sl', '{"full_name":"Alie Attendant"}'),
  ($4, 'new@x.sl', '{}')`, [OWNER, MANAGER, ATTENDANT, PENDING]);
const roles = Object.fromEntries((await q(`select email, role from profiles`)).map((r) => [r.email, r.role]));
check("first user is owner, others pending", roles["owner@x.sl"] === "owner" && roles["mgr@x.sl"] === "pending", roles);

await as(OWNER, () => q(`update profiles set role = 'manager' where id = $1`, [MANAGER]));
await as(OWNER, () => q(`update profiles set role = 'attendant' where id = $1`, [ATTENDANT]));
check("owner assigns roles", (await one(`select role from profiles where id = $1`, [MANAGER])).role === "manager");
check("manager cannot touch another profile (RLS filters it out)",
  (await as(MANAGER, () => q(`update profiles set role = 'owner' where id = $1 returning id`, [ATTENDANT]))).length === 0 &&
  (await one(`select role from profiles where id = $1`, [ATTENDANT])).role === "attendant");
await expectError("manager cannot promote themselves", () =>
  as(MANAGER, () => q(`update profiles set role = 'owner' where id = $1`, [MANAGER])), /Only the owner/);
await expectError("last owner cannot be demoted", () =>
  as(OWNER, () => q(`update profiles set role = 'manager' where id = $1`, [OWNER])), /at least one owner/);
check("pending user sees no tanks/products", (await as(PENDING, () => q(`select * from fuel_products`))).length === 0);

console.log("\n== setup: prices, tanks, pumps");
await as(MANAGER, () => q(`update fuel_products set price_per_liter = 30, avg_cost_per_liter = 25 where code = 'PMS'`));
await as(MANAGER, () => q(`update fuel_products set price_per_liter = 32, avg_cost_per_liter = 27 where code = 'AGO'`));
check("price history recorded", (await one(`select count(*)::int c from fuel_price_history`)).c === 2);

const T1 = (await as(MANAGER, () => one(`insert into tanks (tank_name, fuel_type, capacity_liters, current_volume, reorder_level_liters)
  values ('Tank 1', 'PMS', 30000, 10000, 5000) returning id`))).id;
const T2 = (await as(MANAGER, () => one(`insert into tanks (tank_name, fuel_type, capacity_liters, current_volume, reorder_level_liters)
  values ('Tank 2', 'AGO', 20000, 4000, 5000) returning id`))).id;
const ob = await one(`select sum(debit) d from v_ledger where source_type = 'OPENING_BALANCE' and account_code = '1200'`);
check("opening fuel stock posted at avg cost (10000*25 + 4000*27)", num(ob.d) === 358000, ob);

await expectError("attendant cannot create tanks", () =>
  as(ATTENDANT, () => q(`insert into tanks (tank_name, fuel_type, capacity_liters, current_volume, reorder_level_liters) values ('X','PMS',1,0,0)`)),
  /row-level security/);
await expectError("manager cannot edit tank volume directly", () =>
  as(MANAGER, () => q(`update tanks set current_volume = 1 where id = $1`, [T1])), /permission denied/);

await as(MANAGER, () => q(`insert into pumps (pump_number, tank_id, current_meter) values ('P1', $1, 1000), ('P2', $1, 5000), ('P3', $2, 200)`, [T1, T2]));

const status = await q(`select tank_name, stock_status from v_tank_status order by tank_name`);
check("tank 2 below reorder level is LOW", status[1].stock_status === "LOW", status);

console.log("\n== shift: readings, handover, reconciliation");
const D1 = "2026-10-01";
await as(ATTENDANT, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, $2, 'OPENING', 10000)`, [T1, D1]));
const S1 = (await as(ATTENDANT, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Morning', $2) returning id`, [D1, ATTENDANT]))).id;
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, opening_meter, closing_meter, price_per_liter) values
  ($1, 'P1', 1000, 1500, 1), ($1, 'P2', 5000, 5300, null), ($1, 'P3', 200, 600, null)`, [S1]));
const r1 = await one(`select price_per_liter, fuel_type, tank_id, reading_date::text, cost_per_liter from pump_readings where pump_number = 'P1'`);
check("attendant cannot override price; snapshot filled", num(r1.price_per_liter) === 30 && r1.fuel_type === "PMS" && r1.tank_id === T1 && r1.reading_date === D1 && num(r1.cost_per_liter) === 25, r1);
let vols = await q(`select tank_name, current_volume from tanks order by tank_name`);
check("tank book stock reduced by meter sales (9200, 3600)", num(vols[0].current_volume) === 9200 && num(vols[1].current_volume) === 3600, vols);

await as(ATTENDANT, () => q(`update pump_readings set closing_meter = 1600 where shift_id = $1 and pump_number = 'P1'`, [S1]));
vols = await q(`select current_volume from tanks where id = $1`, [T1]);
check("editing a reading adjusts by the difference (9100)", num(vols[0].current_volume) === 9100, vols);
check("pump totaliser follows closing meter", num((await one(`select current_meter from pumps where pump_number='P1'`)).current_meter) === 1600);

await expectError("closing below opening rejected", () =>
  as(ATTENDANT, () => q(`update pump_readings set closing_meter = 10 where shift_id = $1 and pump_number = 'P3'`, [S1])), /closing_after_opening/);

const live = await as(MANAGER, () => one(`select * from v_shift_summary where id = $1`, [S1]));
check("live expected sales while open = 39800", num(live.expected_sales) === 39800 && live.variance === null, live);

await as(ATTENDANT, () => q(`update shifts set cash_on_hand = 33000, credit_slips_amount = 5000, digital_transfers_amount = 1000,
  status = 'SUBMITTED', expected_sales = 1, variance = 999 where id = $1`, [S1]));
let s = await one(`select status, expected_sales, expected_liters, variance, submitted_at from shifts where id = $1`, [S1]);
check("handover computes expected 39800 and shortage -800 (client values ignored)", s.status === "SUBMITTED" && num(s.expected_sales) === 39800 && num(s.expected_liters) === 1300 && num(s.variance) === -800 && s.submitted_at, s);
check("shortage flagged", (await as(MANAGER, () => one(`select is_short from v_shift_summary where id = $1`, [S1]))).is_short === true);

await expectError("readings locked after handover", () =>
  as(MANAGER, () => q(`update pump_readings set closing_meter = 1700 where shift_id = $1 and pump_number = 'P1'`, [S1])), /locked/);
check("attendant cannot reconcile (RLS filters submitted shift)",
  (await as(ATTENDANT, () => q(`update shifts set status = 'RECONCILED' where id = $1 returning id`, [S1]))).length === 0 &&
  (await one(`select status from shifts where id = $1`, [S1])).status === "SUBMITTED");
const S1b = (await as(ATTENDANT, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Night', $2) returning id`, [D1, ATTENDANT]))).id;
await expectError("attendant cannot jump an open shift straight to RECONCILED", () =>
  as(ATTENDANT, () => q(`update shifts set status = 'RECONCILED' where id = $1`, [S1b])), /row-level security|cannot move/);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [S1b]));
check("attendant update on submitted shift is a no-op under RLS",
  (await as(ATTENDANT, () => q(`update shifts set cash_on_hand = 99999 where id = $1 returning id`, [S1]))).length === 0);

await as(MANAGER, () => q(`update shifts set status = 'RECONCILED' where id = $1`, [S1]));
s = await one(`select journal_entry_id, reconciled_by from shifts where id = $1`, [S1]);
let lines = await q(`select account_code, debit, credit from v_ledger where entry_id = $1 order by account_code`, [s.journal_entry_id]);
const byAcct = Object.fromEntries(lines.map((l) => [l.account_code, num(l.debit) - num(l.credit)]));
check("shift posting: cash/AR/bank/shortage vs sales", byAcct["1000"] === 33000 && byAcct["1100"] === 5000 && byAcct["1010"] === 1000 && byAcct["6500"] === 800 && byAcct["4000"] === -39800, byAcct);
check("shift posting: COGS 900*25 + 400*27 = 33300", byAcct["5000"] === 33300 && byAcct["1200"] === -33300, byAcct);
check("reconciled_by is the manager", s.reconciled_by === MANAGER);
await expectError("reconciled shift is locked", () =>
  as(MANAGER, () => q(`update shifts set notes = 'x' where id = $1`, [S1])), /locked/);

await as(MANAGER, () => q(`update shifts set status = 'SUBMITTED' where id = $1`, [S1]));
check("re-opening for review removes the posting", (await one(`select count(*)::int c from journal_entries where source_type = 'SHIFT'`)).c === 0);
await as(MANAGER, () => q(`update shifts set status = 'RECONCILED' where id = $1`, [S1]));
check("re-reconcile posts once", (await one(`select count(*)::int c from journal_entries where source_type = 'SHIFT'`)).c === 1);

console.log("\n== deliveries & weighted average cost");
await as(MANAGER, () => q(`insert into fuel_deliveries (tank_id, delivery_date, supplier, waybill_number, invoiced_liters, received_liters, unit_cost)
  values ($1, $2, 'NP Depot', 'WB-1', 10000, 9950, 26)`, [T2, D1]));
const ago = await one(`select avg_cost_per_liter from fuel_products where code = 'AGO'`);
check("AGO WAC = (3600*27 + 260000) / 13550 = 26.3616", num(ago.avg_cost_per_liter) === 26.3616, ago);
check("tank 2 = 13550", num((await one(`select current_volume from tanks where id = $1`, [T2])).current_volume) === 13550);
const dl = await q(`select account_code, debit, credit from v_ledger where source_type = 'FUEL_DELIVERY' order by account_code`);
check("delivery: Dr inventory / Cr payable 260000", num(dl[0].debit) === 260000 && dl[1].account_code === "2000" && num(dl[1].credit) === 260000, dl);
await expectError("delivery over capacity rejected", () =>
  as(MANAGER, () => q(`insert into fuel_deliveries (tank_id, delivery_date, supplier, invoiced_liters, received_liters, unit_cost) values ($1, $2, 'X', 9000, 9000, 26)`, [T2, D1])), /capacity/);
await expectError("attendant cannot record deliveries", () =>
  as(ATTENDANT, () => q(`insert into fuel_deliveries (tank_id, supplier, invoiced_liters, received_liters, unit_cost) values ($1, 'X', 1, 1, 1)`, [T2])), /row-level security/);

console.log("\n== closing dip & wet-stock variance");
await as(ATTENDANT, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, $2, 'CLOSING', 9050)`, [T1, D1]));
const dip = await one(`select book_volume, variance_liters, journal_entry_id from tank_dips where tank_id = $1 and dip_type = 'CLOSING'`, [T1]);
check("dip variance = 9050 - 9100 = -50", num(dip.book_volume) === 9100 && num(dip.variance_liters) === -50, dip);
check("book stock reset to physical", num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 9050);
lines = await q(`select account_code, debit, credit from v_ledger where entry_id = $1 order by account_code`, [dip.journal_entry_id]);
check("stock loss 50*25 = 1250 posted", num(lines[0].credit) === 1250 && lines[1].account_code === "5100" && num(lines[1].debit) === 1250, lines);
const ws = await as(MANAGER, () => one(`select * from v_wetstock_daily where tank_id = $1 and day = $2`, [T1, D1]));
check("wet-stock view: 10000 + 0 - 900 = 9100 expected, -50 variance", num(ws.opening_stock) === 10000 && num(ws.meter_sales_liters) === 900 && num(ws.expected_closing) === 9100 && num(ws.variance_liters) === -50 && num(ws.variance_percent_of_sales) === -5.56, ws);

const S2 = (await as(ATTENDANT, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Afternoon', $2) returning id`, [D1, ATTENDANT]))).id;
await expectError("readings on/before a closing dip are blocked", () =>
  as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, opening_meter, closing_meter) values ($1, 'P1', 1600, 1700)`, [S2])), /closing dip/);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [S2]));
const S3 = (await as(ATTENDANT, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-10-02', 'Morning', $1) returning id`, [ATTENDANT]))).id;
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, opening_meter, closing_meter) values ($1, 'P1', 1600, 1700)`, [S3]));
check("next day's readings accepted (9050 - 100 = 8950)", num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 8950);
await expectError("closing dips must be recorded in date order", () =>
  as(MANAGER, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, '2026-09-30', 'CLOSING', 9000)`, [T1])), /later closing dip/);
const openWs = await as(MANAGER, () => one(`select opening_stock, opening_source from v_wetstock_daily where tank_id = $1 and day = '2026-10-02'`, [T1]));
check("next day opening falls back to previous closing dip", num(openWs.opening_stock) === 9050 && openWs.opening_source === "PREVIOUS_CLOSING_DIP", openWs);

console.log("\n== bar");
const ITEM = (await as(MANAGER, () => one(`insert into bar_inventory (item_name, sku, quantity_in_stock, cost_price, selling_price, reorder_threshold)
  values ('Star beer, 60 cl', 'BEER-STAR-60CL', 20, 50, 75, 5) returning id`))).id;
await as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity, unit_price, sale_date) values ($1, 3, 1, $2)`, [ITEM, D1]));
let item = await one(`select quantity_in_stock from bar_inventory where id = $1`, [ITEM]);
const sale = await one(`select unit_price, total_amount, recorded_by from bar_sales where item_id = $1`, [ITEM]);
check("sale at menu price 75, stock 17", num(sale.unit_price) === 75 && num(sale.total_amount) === 225 && item.quantity_in_stock === 17 && sale.recorded_by === ATTENDANT, { sale, item });
await expectError("cannot oversell", () =>
  as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity) values ($1, 50)`, [ITEM])), /left in stock/);
await as(MANAGER, () => q(`insert into bar_restocks (item_id, quantity, unit_cost, restock_date) values ($1, 10, 56, $2)`, [ITEM, D1]));
item = await one(`select quantity_in_stock, cost_price from bar_inventory where id = $1`, [ITEM]);
check("restock WAC = (17*50 + 560)/27 = 52.2222", item.quantity_in_stock === 27 && num(item.cost_price) === 52.2222, item);
await expectError("manager cannot edit stock qty directly", () =>
  as(MANAGER, () => q(`update bar_inventory set quantity_in_stock = 1 where id = $1`, [ITEM])), /permission denied/);
const MALT = (await as(MANAGER, () => one(`insert into bar_inventory (item_name, sku, category, quantity_in_stock, cost_price, selling_price)
  values ('Maltina, 33 cl', 'MALTINA-33-CL', 'Malt drinks', 0, 0, 25) returning id`))).id;
await as(MANAGER, () => q(`insert into bar_restocks (item_id, quantity, unit_cost, payment_method, restock_date) values ($1, 24, 16, 'OPENING', $2)`, [MALT, D1]));
const malt = await one(`select quantity_in_stock, cost_price from bar_inventory where id = $1`, [MALT]);
const maltLines = await q(`select account_code, debit, credit from v_ledger where description = 'Opening bar stock — 24 × Maltina, 33 cl' order by account_code`);
check("opening count: 24 at cost 16, Dr Bar Inventory / Cr Owner's Equity 384 (no cash or payable)",
  malt.quantity_in_stock === 24 && num(malt.cost_price) === 16 && maltLines.length === 2 &&
  maltLines[0].account_code === "1210" && num(maltLines[0].debit) === 384 && maltLines[1].account_code === "3000" && num(maltLines[1].credit) === 384,
  { malt, maltLines });

console.log("\n== cash book");
const TX = (await as(MANAGER, () => one(`insert into financial_transactions (transaction_date, category, amount, transaction_type, description)
  values ($1, 'Salary', 5000, 'EXPENSE', 'September wages') returning id, recorded_by, journal_entry_id`, [D1])));
check("recorded_by defaults to the manager's name", TX.recorded_by === "Mary Manager", TX);
await as(MANAGER, () => q(`update financial_transactions set amount = 6000 where id = $1`, [TX.id]));
const txEntries = await q(`select je.id, jl.debit from journal_entries je join journal_lines jl on jl.entry_id = je.id where je.source_type = 'TRANSACTION' and jl.account_code = '6000'`);
check("editing a transaction re-posts it (one entry, 6000)", txEntries.length === 1 && num(txEntries[0].debit) === 6000, txEntries);
await as(MANAGER, () => q(`insert into financial_transactions (transaction_date, category, amount, transaction_type, payment_method) values ($1, 'Fuel Purchase', 100000, 'EXPENSE', 'BANK')`, [D1]));
await expectError("type must match category", () =>
  as(MANAGER, () => q(`insert into financial_transactions (category, amount, transaction_type) values ('Salary', 1, 'INCOME')`)), /expense category/);
await expectError("deposit to bank paid from bank rejected", () =>
  as(MANAGER, () => q(`insert into financial_transactions (category, amount, transaction_type, payment_method) values ('Cash Deposit to Bank', 1, 'EXPENSE', 'BANK')`)), /different payment method/);
check("attendant cannot read the cash book or journal",
  (await as(ATTENDANT, () => q(`select * from financial_transactions`))).length === 0 &&
  (await as(ATTENDANT, () => q(`select * from journal_lines`))).length === 0);
await expectError("nobody writes the journal directly", () =>
  as(MANAGER, () => q(`insert into journal_entries (entry_date, description, source_type) values (current_date, 'x', 'TRANSACTION')`)), /permission denied/);
await expectError("unbalanced journal rejected at commit", () =>
  q(`with e as (insert into journal_entries (entry_date, description, source_type) values (current_date, 'bad', 'TRANSACTION') returning id)
     insert into journal_lines (entry_id, account_code, debit) select id, '1000', 10 from e`), /unbalanced/);
await expectError("internal posting function not callable by users", () =>
  as(MANAGER, () => q(`select post_journal(current_date, 'x', 'TRANSACTION', null, '[]'::jsonb)`)), /permission denied/);

console.log("\n== profit engine");
const pnl = await as(MANAGER, () => q(`select * from get_profit_and_loss('2026-10-01', '2026-10-01')`));
const g = (grp) => pnl.filter((r) => r.report_group === grp).reduce((a, r) => a + num(r.amount), 0);
const revenue = g("REVENUE"), cogs = g("COGS"), opex = g("OPEX"), other = g("OTHER_INCOME");
check("revenue 39800 fuel + 225 bar = 40025", revenue === 40025, pnl);
check("COGS 33300 + 150 + 1250 loss = 34700", cogs === 34700, pnl);
check("gross profit 5325, net = 5325 - (6000 + 800) = -1475", revenue - cogs === 5325 && revenue - cogs - opex + other === -1475, { revenue, cogs, opex, other });

const tb = await as(MANAGER, () => q(`select * from get_trial_balance('2026-12-31')`));
const dr = tb.reduce((a, r) => a + num(r.total_debit), 0), cr = tb.reduce((a, r) => a + num(r.total_credit), 0);
check("trial balance: total debits = total credits", Math.abs(dr - cr) < 0.001 && dr > 0, { dr, cr });
const inv = tb.find((r) => r.account_code === "1200");
const expectedInv = 358000 + 260000 - 33300 - 1250;
check("fuel inventory account = opening + delivery - COGS - loss", num(inv.balance) === expectedInv, { inv, expectedInv });

const k = await as(MANAGER, () => one(`select get_dashboard_kpis('2026-10-01') k`)).then((r) => r.k);
check("dashboard live gross matches posted gross (all shifts reconciled)", num(k.gross_profit) === 5325, k);
check("dashboard live net matches posted net", num(k.net_profit) === -1475, k);
check("dashboard handover collected 39000 vs expected 39800", num(k.handover.collected) === 39000 && num(k.handover.expected) === 39800, k.handover);
check("dashboard volume sold 1300 L", num(k.fuel_liters) === 1300, k);
const k2 = await as(MANAGER, () => one(`select get_dashboard_kpis('2026-10-02') k`)).then((r) => r.k);
check("open-shift sales show live (100 L * 30 = 3000)", num(k2.fuel_sales) === 3000 && num(k2.open_shift_sales) === 3000 && k2.shifts.open === 1, k2);
const trend = await as(MANAGER, () => q(`select * from get_daily_trend('2026-09-30', '2026-10-02')`));
check("trend has 3 days with gaps filled", trend.length === 3 && num(trend[0].fuel_sales) === 0 && num(trend[1].fuel_sales) === 39800, trend);

console.log("\n== reversals");
await as(MANAGER, () => q(`delete from bar_sales`));
check("deleting a sale restores stock and its journal entry", (await one(`select quantity_in_stock from bar_inventory where id = $1`, [ITEM])).quantity_in_stock === 30 &&
  (await one(`select count(*)::int c from journal_entries where source_type = 'BAR_SALE'`)).c === 0);
check("…including sales made before the bar migration", (await one(`select quantity_in_stock from bar_inventory where id = $1`, [LEGACY_ITEM])).quantity_in_stock === 24);
await expectError("readings of a reconciled shift cannot be deleted", () =>
  as(MANAGER, () => q(`delete from pump_readings where shift_id = $1 and pump_number = 'P1' and reading_date = '2026-10-01'`, [S1])), /locked|closing dip/);
await as(MANAGER, () => q(`delete from pump_readings where shift_id = $1`, [S3]));
await as(MANAGER, () => q(`delete from tank_dips where tank_id = $1 and dip_type = 'CLOSING'`, [T1]));
check("deleting the closing dip restores book stock (9100)", num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 9100);
check("…and its journal entry", (await one(`select count(*)::int c from journal_entries where source_type = 'TANK_DIP'`)).c === 0);
await as(MANAGER, () => q(`delete from fuel_deliveries`));
const ago2 = await one(`select avg_cost_per_liter from fuel_products where code = 'AGO'`);
check("deleting the delivery restores volume 3600 and WAC ≈ 27", num((await one(`select current_volume from tanks where id = $1`, [T2])).current_volume) === 3600 && Math.abs(num(ago2.avg_cost_per_liter) - 27) < 0.01, ago2);
await expectError("submitted/reconciled shifts cannot be deleted", () =>
  as(MANAGER, () => q(`delete from shifts where id = $1`, [S1])), /Only open shifts/);

const finalTb = await as(MANAGER, () => q(`select * from get_trial_balance('2026-12-31')`));
const fdr = finalTb.reduce((a, r) => a + num(r.total_debit), 0), fcr = finalTb.reduce((a, r) => a + num(r.total_credit), 0);
check("trial balance still balances after reversals", Math.abs(fdr - fcr) < 0.001, { fdr, fcr });

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

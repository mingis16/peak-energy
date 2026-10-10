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

// A reconciled full-day shift from before stations named their own shifts,
// when 'Day' was shown as "Full day", worked by an attendant from those days.
const CUSTOMISATION_MIGRATION = "20261010000100_station_customisation.sql";
const LEGACY_ATTENDANT = "00000000-0000-0000-0000-0000000000ee";
let LEGACY_SHIFT;
async function writeLegacyShift() {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'old@x.sl', '{"full_name":"Old Hand"}')`, [LEGACY_ATTENDANT]);
  // The first account becomes the owner; this one was an attendant.
  await db.exec(`alter table profiles disable trigger profiles_before_update`);
  await db.query(`update profiles set role = 'attendant' where id = $1`, [LEGACY_ATTENDANT]);
  await db.exec(`alter table profiles enable trigger profiles_before_update`);
  LEGACY_SHIFT = (await db.query(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-09-01', 'Day', $1) returning id`, [LEGACY_ATTENDANT])).rows[0].id;
  await db.query(`update shifts set status = 'SUBMITTED' where id = $1`, [LEGACY_SHIFT]);
  await db.query(`update shifts set status = 'RECONCILED' where id = $1`, [LEGACY_SHIFT]);
}

for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  try {
    if (file === BAR_MIGRATION) await writeLegacyShopRows();
    if (file === CUSTOMISATION_MIGRATION) await writeLegacyShift();
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

console.log("\n== equipment setup");
const T3 = (await as(MANAGER, () => one(`insert into tanks (tank_name, fuel_type, capacity_liters, current_volume, reorder_level_liters)
  values ('Tank 3', 'PMS', 10000, 2000, 1000) returning id`))).id;
await as(MANAGER, () => q(`select update_tank_stock($1, 'AGO', 3000)`, [T3]));
const t3 = await one(`select fuel_type, current_volume from tanks where id = $1`, [T3]);
const t3Opening = await q(`select debit from v_ledger where source_type = 'OPENING_BALANCE' and source_id = $1 and account_code = '1200'`, [T3]);
check("unused tank: fuel and stock corrected, opening re-posted (3000 L AGO × 27)",
  t3.fuel_type === "AGO" && num(t3.current_volume) === 3000 && t3Opening.length === 1 && num(t3Opening[0].debit) === 81000, { t3, t3Opening });
await expectError("attendant cannot set tank stock", () =>
  as(ATTENDANT, () => q(`select update_tank_stock($1, 'AGO', 1)`, [T3])), /Only a manager/);

await as(MANAGER, () => q(`insert into pumps (pump_number, tank_id, current_meter) values ('P9', $1, 0)`, [T3]));
const P9 = (await one(`select id from pumps where pump_number = 'P9'`)).id;
await as(MANAGER, () => q(`select set_pump_meter($1, 4321)`, [P9]));
await as(MANAGER, () => q(`update pumps set pump_number = 'P10' where id = $1`, [P9]));
const p9 = await one(`select pump_number, current_meter from pumps where id = $1`, [P9]);
const p9Log = await one(`select during_setup, new_meter from meter_corrections where pump_id = $1`, [P9]);
check("unused pump: manager sets its real meter and number; logged as setup",
  p9.pump_number === "P10" && num(p9.current_meter) === 4321 && p9Log.during_setup === true && num(p9Log.new_meter) === 4321, { p9, p9Log });
await expectError("nobody edits a meter directly", () =>
  as(MANAGER, () => q(`update pumps set current_meter = 1 where id = $1`, [P9])), /permission denied/);
await expectError("a tank with pumps cannot be removed", () =>
  as(MANAGER, () => q(`select remove_tank($1)`, [T3])), /Nozzle P10 draws from tank "Tank 3"/);
await as(MANAGER, () => q(`select remove_pump($1)`, [P9]));
await as(MANAGER, () => q(`select remove_tank($1)`, [T3]));
check("unused pump and tank removed, with the tank's opening entry",
  (await one(`select count(*)::int c from tanks where id = $1`, [T3])).c === 0 &&
  (await one(`select count(*)::int c from journal_entries where source_id = $1`, [T3])).c === 0);

console.log("\n== shift: readings, handover, reconciliation");
const D1 = "2026-10-01";
await as(MANAGER, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, $2, 'OPENING', 10000)`, [T1, D1]));
const S1 = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Morning', $2) returning id`, [D1, ATTENDANT]))).id;
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
await expectError("a used tank's stock cannot be set by hand", () =>
  as(MANAGER, () => q(`select update_tank_stock($1, 'PMS', 5000)`, [T1])), /already has meter readings/);
await expectError("a used pump keeps its number", () =>
  as(MANAGER, () => q(`update pumps set pump_number = 'PX' where pump_number = 'P1'`)), /fixed/);
await expectError("a manager cannot correct a used pump's meter", () =>
  as(MANAGER, () => q(`select set_pump_meter(id, 1) from pumps where pump_number = 'P1'`)), /only the owner/);

await expectError("closing below opening rejected", () =>
  as(ATTENDANT, () => q(`update pump_readings set closing_meter = 10 where shift_id = $1 and pump_number = 'P3'`, [S1])), /below the opening meter/);

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
const S1b = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Night', $2) returning id`, [D1, ATTENDANT]))).id;
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
await as(MANAGER, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, $2, 'CLOSING', 9050)`, [T1, D1]));
const dip = await one(`select book_volume, variance_liters, journal_entry_id from tank_dips where tank_id = $1 and dip_type = 'CLOSING'`, [T1]);
check("dip variance = 9050 - 9100 = -50", num(dip.book_volume) === 9100 && num(dip.variance_liters) === -50, dip);
check("book stock reset to physical", num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 9050);
lines = await q(`select account_code, debit, credit from v_ledger where entry_id = $1 order by account_code`, [dip.journal_entry_id]);
check("stock loss 50*25 = 1250 posted", num(lines[0].credit) === 1250 && lines[1].account_code === "5100" && num(lines[1].debit) === 1250, lines);
const ws = await as(MANAGER, () => one(`select * from v_wetstock_daily where tank_id = $1 and day = $2`, [T1, D1]));
check("wet-stock view: 10000 + 0 - 900 = 9100 expected, -50 variance", num(ws.opening_stock) === 10000 && num(ws.meter_sales_liters) === 900 && num(ws.expected_closing) === 9100 && num(ws.variance_liters) === -50 && num(ws.variance_percent_of_sales) === -5.56, ws);

const S2 = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Afternoon', $2) returning id`, [D1, ATTENDANT]))).id;
await expectError("readings on/before a closing dip are blocked", () =>
  as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, opening_meter, closing_meter) values ($1, 'P1', 1600, 1700)`, [S2])), /closing dip/);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [S2]));
const S3 = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-10-02', 'Morning', $1) returning id`, [ATTENDANT]))).id;
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, opening_meter, closing_meter) values ($1, 'P1', 1650, 1700)`, [S3]));
check("opening meter comes from the pump (1600), not the 1650 the attendant typed",
  num((await one(`select opening_meter from pump_readings where shift_id = $1`, [S3])).opening_meter) === 1600);
check("next day's readings accepted (9050 - 100 = 8950)", num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 8950);
await expectError("closing dips must be recorded in date order", () =>
  as(MANAGER, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, '2026-09-30', 'CLOSING', 9000)`, [T1])), /later closing dip/);
const openWs = await as(MANAGER, () => one(`select opening_stock, opening_source from v_wetstock_daily where tank_id = $1 and day = '2026-10-02'`, [T1]));
check("next day opening falls back to previous closing dip", num(openWs.opening_stock) === 9050 && openWs.opening_source === "PREVIOUS_CLOSING_DIP", openWs);

console.log("\n== meter chain");
const S4 = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-10-02', 'Night', $1) returning id`, [ATTENDANT]))).id;
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, closing_meter) values ($1, 'P2', 5400)`, [S3]));
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, closing_meter) values ($1, 'P2', 5500)`, [S4]));
check("the next shift opens P2 where the last one closed (5400)",
  num((await one(`select opening_meter from pump_readings where shift_id = $1`, [S4])).opening_meter) === 5400);
await expectError("an earlier reading cannot change once a later one builds on it", () =>
  as(ATTENDANT, () => q(`update pump_readings set closing_meter = 5350 where shift_id = $1 and pump_number = 'P2'`, [S3])), /later reading/);
await expectError("…nor be deleted", () =>
  as(ATTENDANT, () => q(`delete from pump_readings where shift_id = $1 and pump_number = 'P2'`, [S3])), /later reading/);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [S4]));
await as(ATTENDANT, () => q(`delete from pump_readings where shift_id = $1 and pump_number = 'P2'`, [S3]));
check("deleting the newest readings rolls P2 back to 5300 and tank 1 to 8950",
  num((await one(`select current_meter from pumps where pump_number = 'P2'`)).current_meter) === 5300 &&
  num((await one(`select current_volume from tanks where id = $1`, [T1])).current_volume) === 8950);

console.log("\n== bar");
const ITEM = (await as(MANAGER, () => one(`insert into bar_inventory (item_name, sku, quantity_in_stock, cost_price, selling_price, reorder_threshold)
  values ('Star beer, 60 cl', 'BEER-STAR-60CL', 20, 50, 75, 5) returning id`))).id;
await as(MANAGER, () => q(`insert into bar_sales (item_id, quantity, sale_date) values ($1, 3, $2)`, [ITEM, D1]));
let item = await one(`select quantity_in_stock from bar_inventory where id = $1`, [ITEM]);
const sale = await one(`select unit_price, total_amount, recorded_by from bar_sales where item_id = $1`, [ITEM]);
check("sale at menu price 75, stock 17", num(sale.unit_price) === 75 && num(sale.total_amount) === 225 && item.quantity_in_stock === 17 && sale.recorded_by === MANAGER, { sale, item });
await expectError("attendant cannot backdate a bar sale", () =>
  as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity, sale_date) values ($1, 1, $2)`, [ITEM, D1])), /only record bar sales for today/);
const ownSale = await as(ATTENDANT, () => one(`insert into bar_sales (item_id, quantity, unit_price) values ($1, 1, 1) returning id, unit_price, recorded_by`, [ITEM]));
check("attendant sells today, at the menu price rather than their own", num(ownSale.unit_price) === 75 && ownSale.recorded_by === ATTENDANT, ownSale);
await as(MANAGER, () => q(`delete from bar_sales where id = $1`, [ownSale.id]));
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
const maltLines = await q(`select account_code, debit, credit from v_ledger where description = 'Bar opening stock — 24 × Maltina, 33 cl' order by account_code`);
check("opening count: 24 at cost 16, Dr Bar Inventory / Cr Owner's Equity 384 (no cash or payable)",
  malt.quantity_in_stock === 24 && num(malt.cost_price) === 16 && maltLines.length === 2 &&
  maltLines[0].account_code === "1210" && num(maltLines[0].debit) === 384 && maltLines[1].account_code === "3000" && num(maltLines[1].credit) === 384,
  { malt, maltLines });

console.log("\n== access by role");
check("managers see neither the accounts nor the cash book unless the owner allows it",
  (await as(MANAGER, () => q(`select * from journal_lines`))).length === 0 &&
  (await as(MANAGER, () => q(`select * from financial_transactions`))).length === 0 &&
  (await as(MANAGER, () => q(`select * from accounts`))).length === 0);
await expectError("…nor record money in or out", () =>
  as(MANAGER, () => q(`insert into financial_transactions (category, amount, transaction_type) values ('Salary', 1, 'EXPENSE')`)), /row-level security/);
const hiddenKpis = await as(MANAGER, () => one(`select get_dashboard_kpis('2026-10-01') k`)).then((r) => r.k);
check("…and the dashboard leaves out their costs and profit",
  hiddenKpis.gross_profit === null && hiddenKpis.net_profit === null && hiddenKpis.fuel_cogs === null && num(hiddenKpis.fuel_sales) === 39800, hiddenKpis);
const hiddenTrend = await as(MANAGER, () => q(`select * from get_daily_trend('2026-10-01', '2026-10-01')`));
check("…as does the sales trend", hiddenTrend[0].gross_profit === null && num(hiddenTrend[0].fuel_sales) === 39800, hiddenTrend);
await expectError("only the owner grants access", () =>
  as(MANAGER, () => q(`update station_settings set managers_view_finances = true`)), /Only the owner/);
await as(OWNER, () => q(`update station_settings set managers_use_cash_book = true`));
check("with cash-book access a manager sees the cash book, not the ledger",
  (await as(MANAGER, () => q(`select * from financial_transactions`))).length > 0 &&
  (await as(MANAGER, () => q(`select * from journal_lines`))).length === 0);
await as(OWNER, () => q(`update station_settings set managers_view_finances = true`));
check("with accounts access, the ledger as well", (await as(MANAGER, () => q(`select * from journal_lines`))).length > 0);
check("attendants see neither, whatever managers may",
  (await as(ATTENDANT, () => q(`select * from journal_lines`))).length === 0 &&
  (await as(ATTENDANT, () => q(`select * from financial_transactions`))).length === 0);
check("meter corrections are for the owner's eyes",
  (await as(MANAGER, () => q(`select * from meter_corrections`))).length === 0 &&
  (await as(OWNER, () => q(`select * from meter_corrections`))).length > 0);

console.log("\n== cash book");
const TX =(await as(MANAGER, () => one(`insert into financial_transactions (transaction_date, category, amount, transaction_type, description)
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

console.log("\n== fraud controls");
await expectError("attendant cannot backdate a shift", () =>
  as(ATTENDANT, () => q(`insert into shifts (shift_date, shift_label, attendant_id) values ($1, 'Morning', $2)`, [D1, ATTENDANT])), /only record shifts for today/);
const todayShift = await as(ATTENDANT, () => one(`insert into shifts (shift_label, attendant_id) values ('Morning', $1) returning id`, [ATTENDANT]));
check("attendant opens today's shift", !!todayShift?.id);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [todayShift.id]));
await expectError("attendant cannot record a closing dip", () =>
  as(ATTENDANT, () => q(`insert into tank_dips (tank_id, dip_type, volume_liters) values ($1, 'CLOSING', 3600)`, [T2])), /manager records them/);
await expectError("attendant cannot backdate a dip", () =>
  as(ATTENDANT, () => q(`insert into tank_dips (tank_id, dip_date, dip_type, volume_liters) values ($1, '2026-09-20', 'OPENING', 3600)`, [T2])), /only record dips for today/);
await expectError("manager cannot raise the shortage tolerance", () =>
  as(MANAGER, () => q(`update station_settings set shortage_tolerance = 1000`)), /Only the owner/);
await as(OWNER, () => q(`update station_settings set shortage_tolerance = 1000`));
await as(OWNER, () => q(`update station_settings set shortage_tolerance = 0`));
check("owner can change the tolerance", num((await one(`select shortage_tolerance from station_settings`)).shortage_tolerance) === 0);

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

console.log("\n== meter corrections");
await expectError("the owner must give a reason", () =>
  as(OWNER, () => q(`select set_pump_meter(id, 2000) from pumps where pump_number = 'P1'`)), /reason/);
await as(OWNER, () => q(`select set_pump_meter(id, 2000, 'Meter replaced') from pumps where pump_number = 'P1'`));
const corr = await one(`select old_meter, new_meter, reason, during_setup, corrected_by from meter_corrections where pump_number = 'P1'`);
check("owner corrects a used pump's meter with a reason, logged",
  num(corr.old_meter) === 1600 && num(corr.new_meter) === 2000 && corr.reason === "Meter replaced" && corr.during_setup === false && corr.corrected_by === OWNER, corr);
const S5 = (await as(MANAGER, () => one(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-10-03', 'Morning', $1) returning id`, [ATTENDANT]))).id;
await as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, closing_meter) values ($1, 'P1', 2050)`, [S5]));
check("the next reading opens at the corrected meter",
  num((await one(`select opening_meter from pump_readings where shift_id = $1`, [S5])).opening_meter) === 2000);
await as(ATTENDANT, () => q(`delete from shifts where id = $1`, [S5]));

console.log("\n== audit log");
check("only the owner can read the audit log",
  (await as(MANAGER, () => q(`select id from audit_log`))).length === 0 && (await as(OWNER, () => q(`select id from audit_log`))).length > 0);
const saleDelete = await one(`select actor_id, actor_name, old_data from audit_log where table_name = 'bar_sales' and action = 'DELETE' order by id limit 1`);
check("deleting a bar sale is logged with who did it",
  saleDelete?.actor_id === MANAGER && saleDelete.actor_name === "Mary Manager" && num(saleDelete.old_data.quantity) === 1, saleDelete);
const readingEdit = await one(`select actor_id, old_data, new_data from audit_log where table_name = 'pump_readings' and action = 'UPDATE' order by id limit 1`);
check("an edited reading logs what changed, before and after",
  readingEdit?.actor_id === ATTENDANT && num(readingEdit.old_data.closing_meter) === 1500 && num(readingEdit.new_data.closing_meter) === 1600 &&
  !("opening_meter" in readingEdit.new_data), readingEdit);
check("setting a tank's stock is logged", !!(await one(`select id from audit_log where table_name = 'tanks' and action = 'STOCK_SET'`)));
check("routine stock and meter moves are not logged (only the pump rename and tank fuel change)",
  (await one(`select count(*)::int c from audit_log where table_name in ('tanks', 'pumps') and action = 'UPDATE'`)).c === 2);
await expectError("nobody can write to the audit log", () =>
  as(OWNER, () => q(`insert into audit_log (table_name, action) values ('x', 'y')`)), /permission denied/);
await expectError("…or erase it", () => as(OWNER, () => q(`delete from audit_log`)), /permission denied/);

console.log("\n== station customisation");
const st = await one(`select setup_completed_at, bar_name, bar_item_label, shift_names from station_settings`);
check("a station already in use counts as set up, as a club bar",
  st.setup_completed_at !== null && st.bar_name === "Bar" && st.bar_item_label === "drink", st);
check("old 'Day' shifts are now stored as 'Full day', reconciled ones included",
  (await one(`select shift_label from shifts where id = $1`, [LEGACY_SHIFT])).shift_label === "Full day");
check("…without showing in the activity log",
  (await one(`select count(*)::int c from audit_log where table_name = 'shifts' and record_id = $1 and new_data ? 'shift_label'`, [LEGACY_SHIFT])).c === 0);
await expectError("a manager cannot change the station's settings", () =>
  as(MANAGER, () => q(`update station_settings set shift_names = '{Day,Night}'`)), /Only the owner/);
await expectError("…or reopen the setup", () =>
  as(MANAGER, () => q(`update station_settings set setup_completed_at = null`)), /Only the owner/);

await as(OWNER, () => q(`update station_settings set shift_names = '{" Day ", "night", "DAY", ""}'`));
const cleaned = (await one(`select shift_names from station_settings`)).shift_names;
check("shift names are trimmed, and blanks and repeats dropped", JSON.stringify(cleaned) === '["Day","night"]', cleaned);
await expectError("a station needs at least one shift", () =>
  as(OWNER, () => q(`update station_settings set shift_names = '{"  "}'`)), /at least one shift/);
await as(OWNER, () => q(`update station_settings set shift_names = '{Day,Night}'`));
await expectError("shifts take the station's own names", () =>
  as(MANAGER, () => q(`insert into shifts (shift_date, shift_label, attendant_id) values ('2026-10-05', 'Morning', $1)`, [ATTENDANT])),
  /not one of this station's shifts: Day, Night/);
const nightShift = await as(ATTENDANT, () => one(`insert into shifts (shift_label, attendant_id) values ('Night', $1) returning id`, [ATTENDANT]));
check("…so an attendant opens a Night shift", !!nightShift?.id);
check("shifts opened before keep their names", (await one(`select shift_label from shifts where id = $1`, [S1])).shift_label === "Morning");

await as(OWNER, () => q(`update station_settings set attendants_open_shifts = false`));
await expectError("when managers open shifts, attendants cannot", () =>
  as(ATTENDANT, () => q(`insert into shifts (shift_label, attendant_id) values ('Day', $1)`, [ATTENDANT])), /A manager opens shifts/);
const managerOpened = await as(MANAGER, () => one(`insert into shifts (shift_label, attendant_id) values ('Day', $1) returning id`, [ATTENDANT]));
check("…a manager opens it for them", !!managerOpened?.id);
await as(OWNER, () => q(`update station_settings set attendants_open_shifts = true`));

await as(OWNER, () => q(`update station_settings set accepts_customer_credit = false, accepts_digital_payments = false, digital_payments_label = 'Orange Money'`));
await expectError("no credit slips when the station does not sell on credit", () =>
  as(ATTENDANT, () => q(`update shifts set credit_slips_amount = 100 where id = $1`, [nightShift.id])), /does not sell on credit/);
await expectError("no transfers when it does not take them", () =>
  as(ATTENDANT, () => q(`update shifts set digital_transfers_amount = 100 where id = $1`, [nightShift.id])), /does not take Orange Money/);
await expectError("…and no bar sales on credit", () =>
  as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity, payment_method) values ($1, 1, 'CREDIT')`, [ITEM])), /does not sell on credit/);
await as(OWNER, () => q(`update station_settings set accepts_customer_credit = true, accepts_digital_payments = true`));

await as(OWNER, () => q(`update station_settings set attendant_date_window_days = 0`));
await expectError("with no leeway, attendants record today only", () =>
  as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity, sale_date) values ($1, 1, current_date - 1)`, [ITEM])), /only record bar sales for today\./);
await as(OWNER, () => q(`update station_settings set attendant_date_window_days = 3`));
const backdated = await as(ATTENDANT, () => one(`insert into bar_sales (item_id, quantity, sale_date) values ($1, 1, current_date - 3) returning id`, [ITEM]));
check("…with three days, they can date a sale three days back", !!backdated?.id);
await as(MANAGER, () => q(`delete from bar_sales where id = $1`, [backdated.id]));
await expectError("the leeway is at most a week", () =>
  as(OWNER, () => q(`update station_settings set attendant_date_window_days = 30`)), /violates check constraint/);
await as(OWNER, () => q(`update station_settings set attendant_date_window_days = 1`));

await as(OWNER, () => q(`update station_settings set attendants_record_closing_dips = true`));
const attendantDip = await as(ATTENDANT, () => one(`insert into tank_dips (tank_id, dip_type, volume_liters) values ($1, 'CLOSING', 3600) returning id, variance_liters`, [T2]));
check("the owner can let attendants record closing dips", num(attendantDip?.variance_liters) === 0, attendantDip);
await as(MANAGER, () => q(`delete from tank_dips where id = $1`, [attendantDip.id]));
await as(OWNER, () => q(`update station_settings set attendants_record_closing_dips = false`));

await as(OWNER, () => q(`update station_settings set bar_name = ' Mini-mart ', bar_item_label = ' Item '`));
const martAccounts = (await q(`select name from accounts where code in ('1210', '4010', '5010') order by code`)).map((a) => a.name);
check("renaming the bar renames its accounts", martAccounts.join("|") === "Mini-mart Inventory|Mini-mart Sales|Cost of Mini-mart Sales", martAccounts);
check("…and its supplier category, which cash-book entries follow",
  (await one(`select category from financial_transactions where amount = 300`)).category === "Mini-mart Supplier Payment");
check("the word for one thing sold is kept trimmed and in lower case", (await one(`select bar_item_label from station_settings`)).bar_item_label === "item");
const martSale = await as(ATTENDANT, () => one(`insert into bar_sales (item_id, quantity) values ($1, 1) returning journal_entry_id`, [ITEM]));
check("sales are described by the new name",
  (await one(`select description from journal_entries where id = $1`, [martSale.journal_entry_id])).description === "Mini-mart sale — 1 × Star beer, 60 cl");
await as(OWNER, () => q(`update station_settings set bar_enabled = false`));
await expectError("nothing is sold once the bar is switched off", () =>
  as(ATTENDANT, () => q(`insert into bar_sales (item_id, quantity) values ($1, 1)`, [ITEM])), /switched off/);
await as(OWNER, () => q(`update station_settings set bar_enabled = true, bar_name = 'Bar', bar_item_label = 'drink'`));
check("renaming it back restores the names",
  (await one(`select name from accounts where code = '4010'`)).name === "Bar Sales" &&
  (await one(`select count(*)::int c from transaction_categories where name = 'Bar Supplier Payment'`)).c === 1);

await as(MANAGER, () => q(`update fuel_products set price_per_liter = 29 where code = 'DPK'`));
await as(MANAGER, () => q(`select remove_fuel_product('DPK')`));
check("an unused fuel can be removed, with its price history",
  (await one(`select count(*)::int c from fuel_products where code = 'DPK'`)).c === 0 &&
  (await one(`select count(*)::int c from fuel_price_history where fuel_type = 'DPK'`)).c === 0);
await expectError("a fuel in a tank stays", () => as(MANAGER, () => q(`select remove_fuel_product('PMS')`)), /Tanks hold PMS/);
await expectError("attendants cannot remove fuels", () => as(ATTENDANT, () => q(`select remove_fuel_product('AGO')`)), /Only a manager/);

await as(OWNER, () => q(`select add_cash_category('Security guards', 'EXPENSE', 'Night watchmen')`));
const guards = await one(`select c.account_code, a.name, a.report_group from transaction_categories c join accounts a on a.code = c.account_code where c.name = 'Security guards'`);
check("a new category gets its own expense line, after the last one (6710)",
  guards?.account_code === "6710" && guards.name === "Security guards" && guards.report_group === "OPEX", guards);
await as(MANAGER, () => q(`insert into financial_transactions (transaction_date, category, amount, transaction_type) values ('2026-10-01', 'Security guards', 700, 'EXPENSE')`));
const guardsPnl = await as(MANAGER, () => q(`select * from get_profit_and_loss('2026-10-01', '2026-10-01') where account_code = '6710'`));
check("…which shows on the profit & loss", guardsPnl.length === 1 && num(guardsPnl[0].amount) === 700, guardsPnl);
await as(OWNER, () => q(`update transaction_categories set name = 'Security' where name = 'Security guards'`));
check("renaming the category renames its own account and moves its entries",
  (await one(`select name from accounts where code = '6710'`)).name === "Security" &&
  (await one(`select category from financial_transactions where amount = 700`)).category === "Security");
await as(OWNER, () => q(`select add_cash_category('Car wash', 'INCOME', null, '4900')`));
check("a category can post to an existing account", (await one(`select account_code from transaction_categories where name = 'Car wash'`)).account_code === "4900");
await expectError("category names are unique, whatever the case", () =>
  as(OWNER, () => q(`select add_cash_category('car WASH', 'INCOME')`)), /already a category/);
await expectError("managers cannot add categories", () =>
  as(MANAGER, () => q(`select add_cash_category('Tips', 'INCOME')`)), /Only the owner/);
await expectError("categories are only added through add_cash_category", () =>
  as(OWNER, () => q(`insert into transaction_categories (name, transaction_type, account_code) values ('Y', 'EXPENSE', '6000')`)), /permission denied/);
await expectError("a category's account is fixed", () =>
  as(OWNER, () => q(`update transaction_categories set account_code = '6000' where name = 'Security'`)), /permission denied/);
check("settings and category changes are in the audit log",
  (await one(`select count(*)::int c from audit_log where table_name = 'station_settings'`)).c > 0 &&
  (await one(`select count(*)::int c from audit_log where table_name = 'transaction_categories'`)).c > 0);

console.log("\n== pumps and nozzles");
const PUMP_A = (await as(MANAGER, () => one(`insert into dispensers (name) values ('Pump A') returning id`))).id;
await expectError("pump names are unique, whatever the case", () =>
  as(MANAGER, () => q(`insert into dispensers (name) values ('pump a')`)), /duplicate key/);
await expectError("attendants cannot add pumps", () =>
  as(ATTENDANT, () => q(`insert into dispensers (name) values ('Pump B')`)), /row-level security/);
await as(MANAGER, () => q(`update pumps set dispenser_id = $1 where pump_number in ('P1', 'P2')`, [PUMP_A]));
check("nozzles already in use can be moved onto a pump",
  (await one(`select count(*)::int c from pumps where dispenser_id = $1`, [PUMP_A])).c === 2);
await as(MANAGER, () => q(`insert into pumps (pump_number, tank_id, current_meter, dispenser_id) values ('Pump A left', $1, 500, $2)`, [T1, PUMP_A]));
check("a nozzle can have any name and draws from the tank chosen for it",
  (await one(`select tank_id from pumps where pump_number = 'Pump A left'`)).tank_id === T1);
await expectError("nozzle names are unique, whatever the case", () =>
  as(MANAGER, () => q(`insert into pumps (pump_number, tank_id) values ('p1', $1)`, [T1])), /duplicate key/);

const openReading = await as(ATTENDANT, () => one(`insert into pump_readings (shift_id, pump_number, closing_meter) values ($1, 'P1', 2010) returning id`, [nightShift.id]));
await expectError("a nozzle with a reading in an open shift cannot be removed", () =>
  as(MANAGER, () => q(`select remove_pump(id) from pumps where pump_number = 'P1'`)), /still open/);
await as(ATTENDANT, () => q(`delete from pump_readings where id = $1`, [openReading.id]));

const p2Readings = (await one(`select count(*)::int c from pump_readings where pump_number = 'P2'`)).c;
const retired = await as(MANAGER, () => one(`select remove_pump(id) r from pumps where pump_number = 'P2'`));
const p2 = await one(`select is_active, retired_at from pumps where pump_number = 'P2'`);
check("a used nozzle is retired, not deleted, and keeps its readings",
  retired.r === "RETIRED" && p2.is_active === false && p2.retired_at !== null && p2Readings > 0 &&
  (await one(`select count(*)::int c from pump_readings where pump_number = 'P2'`)).c === p2Readings, { retired, p2 });
await expectError("a retired nozzle takes no readings", () =>
  as(ATTENDANT, () => q(`insert into pump_readings (shift_id, pump_number, closing_meter) values ($1, 'P2', 6000)`, [nightShift.id])), /inactive/);
await expectError("…and cannot be ticked back into use without restoring it", () =>
  as(MANAGER, () => q(`update pumps set is_active = true where pump_number = 'P2'`)), /has been removed/);
await as(MANAGER, () => q(`select restore_pump(id) from pumps where pump_number = 'P2'`));
await as(MANAGER, () => q(`update pumps set is_active = true where pump_number = 'P2'`));
check("a restored nozzle can be put back in use",
  (await one(`select is_active, retired_at from pumps where pump_number = 'P2'`)).is_active === true);
await expectError("attendants cannot remove nozzles", () =>
  as(ATTENDANT, () => q(`select remove_pump(id) from pumps where pump_number = 'P2'`)), /Only a manager/);

const retiredWithPump = (await as(MANAGER, () => one(`select remove_dispenser($1) n`, [PUMP_A]))).n;
const afterPump = Object.fromEntries((await q(`select pump_number, retired_at is not null as retired, dispenser_id from pumps where pump_number in ('P1', 'P2', 'Pump A left')`))
  .map((p) => [p.pump_number, p]));
check("removing a pump retires its used nozzles and deletes the unused one",
  retiredWithPump === 2 && afterPump.P1.retired && afterPump.P2.retired && !afterPump["Pump A left"] &&
  afterPump.P1.dispenser_id === null && (await one(`select count(*)::int c from dispensers`)).c === 0, { retiredWithPump, afterPump });
await as(MANAGER, () => q(`select restore_pump(id) from pumps where pump_number in ('P1', 'P2')`));
await as(MANAGER, () => q(`update pumps set is_active = true where pump_number in ('P1', 'P2')`));

await expectError("a tank cannot be removed while nozzles draw from it", () =>
  as(MANAGER, () => q(`select remove_tank($1)`, [T2])), /Nozzle P3 draws from tank "Tank 2"/);
await as(MANAGER, () => q(`select remove_pump(id) from pumps where pump_number = 'P3'`));
const t2Retired = (await as(MANAGER, () => one(`select remove_tank($1) r`, [T2]))).r;
check("a used tank is retired with its history; its stock stays in the books",
  t2Retired === "RETIRED" && (await one(`select is_active, retired_at is not null as retired from tanks where id = $1`, [T2])).retired &&
  (await one(`select count(*)::int c from pump_readings where tank_id = $1`, [T2])).c > 0);
await expectError("a retired tank takes no deliveries", () =>
  as(MANAGER, () => q(`insert into fuel_deliveries (tank_id, supplier, invoiced_liters, received_liters, unit_cost) values ($1, 'X', 100, 100, 26)`, [T2])), /inactive/);
await expectError("no nozzle can draw from a retired tank", () =>
  as(MANAGER, () => q(`select restore_pump(id) from pumps where pump_number = 'P3'`)), /Restore the tank first/);
await as(MANAGER, () => q(`select restore_tank($1)`, [T2]));
await as(MANAGER, () => q(`select restore_pump(id) from pumps where pump_number = 'P3'`));
await as(MANAGER, () => q(`update tanks set is_active = true where id = $1`, [T2]));
await as(MANAGER, () => q(`update pumps set is_active = true where pump_number = 'P3'`));
check("a restored tank and nozzle are back in use",
  (await one(`select is_active from tanks where id = $1`, [T2])).is_active === true &&
  (await one(`select is_active from pumps where pump_number = 'P3'`)).is_active === true);
check("pump and nozzle changes are in the audit log",
  (await one(`select count(*)::int c from audit_log where table_name = 'dispensers'`)).c > 0 &&
  (await one(`select count(*)::int c from audit_log where table_name = 'pumps' and new_data ? 'retired_at'`)).c > 0);

const finalTb = await as(MANAGER, () => q(`select * from get_trial_balance('2026-12-31')`));
const fdr = finalTb.reduce((a, r) => a + num(r.total_debit), 0), fcr = finalTb.reduce((a, r) => a + num(r.total_credit), 0);
check("trial balance still balances after reversals", Math.abs(fdr - fcr) < 0.001, { fdr, fcr });

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Row shapes returned by Supabase. Numeric columns arrive as numbers.
// Regenerate a full Database type with `supabase gen types typescript` if needed.

export type Role = "owner" | "manager" | "attendant" | "pending";
export type PaymentMethod = "CASH" | "BANK" | "CREDIT";
export type ShiftStatus = "OPEN" | "SUBMITTED" | "RECONCILED";
export type StockStatus = "OK" | "LOW" | "CRITICAL" | "OUT";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  created_at: string;
}

export interface StationSettings {
  station_name: string;
  currency_code: string;
  shortage_tolerance: number;
  dip_variance_tolerance_percent: number;
  /** Null until the owner has answered the setup questions. */
  setup_completed_at: string | null;
  shift_names: string[];
  attendants_open_shifts: boolean;
  accepts_customer_credit: boolean;
  accepts_digital_payments: boolean;
  digital_payments_label: string;
  /** The bar module: whatever the station sells besides fuel. */
  bar_enabled: boolean;
  bar_name: string;
  /** One thing sold, singular and lower case, e.g. "drink". */
  bar_item_label: string;
  bar_categories: string[];
  attendant_date_window_days: number;
  attendants_record_closing_dips: boolean;
  managers_view_finances: boolean;
  managers_use_cash_book: boolean;
}

export interface FuelProduct {
  code: string;
  name: string;
  price_per_liter: number;
  avg_cost_per_liter: number;
  updated_at: string;
}

export interface TankStatus {
  id: string;
  tank_name: string;
  fuel_type: string;
  fuel_name: string;
  capacity_liters: number;
  current_volume: number;
  reorder_level_liters: number;
  is_active: boolean;
  updated_at: string;
  fill_percent: number;
  ullage_liters: number;
  stock_status: "OK" | "LOW" | "CRITICAL";
  stock_value: number;
  avg_daily_sales_liters: number;
  days_of_cover: number | null;
}

export interface Pump {
  id: string;
  pump_number: string;
  tank_id: string;
  current_meter: number;
  is_active: boolean;
}

export interface ShiftSummary {
  id: string;
  shift_date: string;
  shift_label: string;
  attendant_id: string;
  attendant_name: string;
  status: ShiftStatus;
  cash_on_hand: number;
  credit_slips_amount: number;
  digital_transfers_amount: number;
  total_collected: number;
  liters_sold: number;
  expected_sales: number;
  variance: number | null;
  is_short: boolean;
  reading_count: number;
  notes: string | null;
  opened_at: string;
  submitted_at: string | null;
  reconciled_at: string | null;
  journal_entry_id: string | null;
}

export interface PumpReading {
  id: string;
  shift_id: string;
  pump_number: string;
  tank_id: string;
  fuel_type: string;
  opening_meter: number;
  closing_meter: number;
  price_per_liter: number;
  liters_sold: number;
  sales_amount: number;
  reading_date: string;
}

export interface TankDip {
  id: string;
  tank_id: string;
  dip_date: string;
  dip_type: "OPENING" | "CLOSING";
  dip_reading_cm: number | null;
  volume_liters: number;
  book_volume: number | null;
  variance_liters: number | null;
  notes: string | null;
  created_at: string;
}

export interface FuelDelivery {
  id: string;
  tank_id: string;
  delivery_date: string;
  supplier: string;
  waybill_number: string | null;
  invoiced_liters: number;
  received_liters: number;
  unit_cost: number;
  total_cost: number;
  transit_loss_liters: number;
  payment_method: PaymentMethod;
  created_at: string;
}

export interface WetstockDay {
  tank_id: string;
  tank_name: string;
  fuel_type: string;
  day: string;
  opening_stock: number | null;
  opening_source: "OPENING_DIP" | "PREVIOUS_CLOSING_DIP" | null;
  deliveries_liters: number;
  meter_sales_liters: number;
  expected_closing: number | null;
  closing_dip: number | null;
  variance_liters: number | null;
  variance_percent_of_sales: number | null;
}

export interface BarStock {
  id: string;
  item_name: string;
  sku: string;
  category: string;
  quantity_in_stock: number;
  cost_price: number;
  selling_price: number;
  reorder_threshold: number;
  is_active: boolean;
  stock_value: number;
  unit_margin: number;
  stock_status: "OK" | "LOW" | "OUT";
}

export interface BarSale {
  id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: PaymentMethod;
  sale_date: string;
  created_at: string;
}

export interface BarRestock {
  id: string;
  item_id: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier: string | null;
  payment_method: PaymentMethod | "OPENING"; // OPENING: counted on the shelf, not bought
  restock_date: string;
  created_at: string;
}

export interface Account {
  code: string;
  name: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  report_group: "REVENUE" | "COGS" | "OPEX" | "OTHER_INCOME" | null;
}

export interface TransactionCategory {
  name: string;
  transaction_type: "INCOME" | "EXPENSE";
  account_code: string;
  description: string | null;
  is_active: boolean;
}

export interface FinancialTransaction {
  id: string;
  transaction_date: string;
  category: string;
  amount: number;
  transaction_type: "INCOME" | "EXPENSE";
  payment_method: PaymentMethod;
  description: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface LedgerLine {
  line_id: number;
  entry_id: string;
  entry_date: string;
  description: string;
  source_type: string;
  source_id: string | null;
  account_code: string;
  account_name: string;
  account_type: string;
  report_group: string | null;
  debit: number;
  credit: number;
  memo: string | null;
  created_at: string;
}

export interface PnlRow {
  report_group: "REVENUE" | "COGS" | "OPEX" | "OTHER_INCOME";
  account_code: string;
  account_name: string;
  amount: number;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

/** Cost and profit figures are null for anyone who may not see the accounts. */
export interface DashboardKpis {
  date: string;
  fuel_liters: number;
  fuel_sales: number;
  fuel_cogs: number | null;
  fuel_by_type: { fuel_type: string; liters: number; sales: number }[];
  bar_sales: number;
  bar_cogs: number | null;
  stock_loss: number | null;
  gross_profit: number | null;
  operating_expenses: number | null;
  other_income: number | null;
  cash_variance: number;
  net_profit: number | null;
  handover: {
    shifts: number;
    collected: number;
    cash: number;
    credit: number;
    digital: number;
    expected: number;
    variance: number;
  };
  open_shift_sales: number;
  shifts: { open: number; awaiting_review: number; reconciled: number; short: number };
  tanks_low: number;
  tanks_total: number;
  bar_items_low: number;
}

export interface TrendRow {
  day: string;
  fuel_liters: number;
  fuel_sales: number;
  bar_sales: number;
  gross_profit: number | null;
}

export interface AuditEntry {
  id: number;
  happened_at: string;
  actor_id: string | null;
  actor_name: string | null;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE" | "STOCK_SET";
  record_id: string | null;
  /** For updates, only the fields that changed. */
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export interface MeterCorrection {
  id: string;
  pump_id: string | null;
  pump_number: string;
  old_meter: number;
  new_meter: number;
  reason: string | null;
  during_setup: boolean;
  corrected_by: string | null;
  corrected_at: string;
}

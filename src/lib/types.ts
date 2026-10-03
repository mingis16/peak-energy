// Row shapes returned by Supabase. Numeric columns arrive as numbers.
// Regenerate a full Database type with `supabase gen types typescript` if needed.

export type Role = "owner" | "manager" | "attendant" | "pending";
export type PaymentMethod = "CASH" | "BANK" | "CREDIT";
export type ShiftStatus = "OPEN" | "SUBMITTED" | "RECONCILED";
export type ShiftLabel = "Morning" | "Afternoon" | "Night" | "Day";
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
  shift_label: ShiftLabel;
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

export interface ShopStock {
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

export interface ShopSale {
  id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: PaymentMethod;
  sale_date: string;
  created_at: string;
}

export interface ShopRestock {
  id: string;
  item_id: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier: string | null;
  payment_method: PaymentMethod;
  restock_date: string;
  created_at: string;
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

export interface DashboardKpis {
  date: string;
  fuel_liters: number;
  fuel_sales: number;
  fuel_cogs: number;
  fuel_by_type: { fuel_type: string; liters: number; sales: number }[];
  shop_sales: number;
  shop_cogs: number;
  stock_loss: number;
  gross_profit: number;
  operating_expenses: number;
  other_income: number;
  cash_variance: number;
  net_profit: number;
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
  shop_items_low: number;
}

export interface TrendRow {
  day: string;
  fuel_liters: number;
  fuel_sales: number;
  shop_sales: number;
  gross_profit: number;
}

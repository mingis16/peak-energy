// Words and choices that come from the station's own settings. Safe to use
// in client components.

import { PAYMENT_LABELS } from "@/lib/format";
import type { PaymentMethod, StationSettings } from "@/lib/types";

/** "drink" → "drinks", "glass" → "glasses", "battery" → "batteries". */
export function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Words for the bar module, which holds whatever the station sells besides fuel. */
export function barWords(settings: Pick<StationSettings, "bar_name" | "bar_item_label">) {
  const item = settings.bar_item_label || "item";
  return {
    /** "Bar", "Shop", "Lubricants" */
    name: settings.bar_name,
    /** "drink" */
    item,
    /** "a drink", "an item" */
    anItem: `${/^[aeiou]/i.test(item) ? "an" : "a"} ${item}`,
    /** "drinks" */
    items: plural(item),
    /** "Drink" */
    Item: capitalize(item),
    /** "Drinks" */
    Items: capitalize(plural(item)),
  };
}

type PaymentSettings = Pick<
  StationSettings,
  "accepts_customer_credit" | "accepts_digital_payments" | "digital_payments_label"
>;

/** The ways customers can pay at this station. Cash is always one. */
export function customerPaymentOptions(settings: PaymentSettings): { value: PaymentMethod; label: string }[] {
  return [
    { value: "CASH", label: "Cash" },
    ...(settings.accepts_digital_payments ? [{ value: "BANK" as const, label: settings.digital_payments_label }] : []),
    ...(settings.accepts_customer_credit ? [{ value: "CREDIT" as const, label: "On credit" }] : []),
  ];
}

/** A customer payment in the station's words, e.g. "Orange Money". */
export function customerPaymentLabel(method: string, settings: PaymentSettings): string {
  return method === "BANK" ? settings.digital_payments_label : (PAYMENT_LABELS[method] ?? method);
}

/** Where staff create their own accounts. */
export function signupUrl(): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/signup`;
}

export const SHIFT_PATTERNS = [
  { label: "One shift a day", names: ["Full day"] },
  { label: "Day and night", names: ["Day", "Night"] },
  { label: "Morning, afternoon and night", names: ["Morning", "Afternoon", "Night"] },
];

/** Starting points for what a station sells besides fuel. */
export const BAR_PRESETS = [
  {
    id: "bar",
    label: "A bar or club",
    name: "Bar",
    item: "drink",
    categories: ["Beer", "Ciders", "Malt drinks", "Soft drinks", "Energy drinks", "Water", "Spirits", "Wine & champagne", "Snacks", "Other"],
  },
  {
    id: "shop",
    label: "A shop or mini-mart",
    name: "Shop",
    item: "item",
    categories: ["Drinks", "Snacks", "Groceries", "Toiletries", "Phone credit", "Lubricants", "Other"],
  },
  {
    id: "lubricants",
    label: "Lubricants and car care",
    name: "Lubricants",
    item: "product",
    categories: ["Engine oil", "Gear & brake fluid", "Coolant", "Filters", "Car care", "Other"],
  },
];

export const DATE_WINDOW_OPTIONS = [
  { value: 0, label: "Today only" },
  { value: 1, label: "Today, or a day either side" },
  { value: 2, label: "Up to 2 days either side" },
  { value: 3, label: "Up to 3 days either side" },
  { value: 7, label: "Up to a week either side" },
];

export const CURRENCIES = [
  { code: "SLE", name: "Sierra Leonean leone" },
  { code: "LRD", name: "Liberian dollar" },
  { code: "GHS", name: "Ghanaian cedi" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "GMD", name: "Gambian dalasi" },
  { code: "GNF", name: "Guinean franc" },
  { code: "XOF", name: "West African CFA franc" },
  { code: "XAF", name: "Central African CFA franc" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "UGX", name: "Ugandan shilling" },
  { code: "TZS", name: "Tanzanian shilling" },
  { code: "ZAR", name: "South African rand" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound sterling" },
];

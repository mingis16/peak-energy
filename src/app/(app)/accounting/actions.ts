"use server";

import {
  ActionError,
  authorize,
  check,
  PAYMENT_METHODS,
  readChoice,
  readDate,
  readNumber,
  readOptionalText,
  readText,
  runAction,
  type ActionState,
} from "@/lib/actions";
import { MANAGER_ROLES } from "@/lib/auth";

function readTransaction(form: FormData) {
  return {
    transaction_date: readDate(form, "transaction_date"),
    category: readText(form, "category", "Category"),
    amount: readNumber(form, "amount", "Amount", { allowZero: false }),
    payment_method: readChoice(form, "payment_method", PAYMENT_METHODS, "Payment method"),
    description: readOptionalText(form, "description"),
  };
}

async function categoryType(supabase: Awaited<ReturnType<typeof authorize>>["supabase"], name: string) {
  const { data, error } = await supabase
    .from("transaction_categories")
    .select("transaction_type")
    .eq("name", name)
    .maybeSingle();
  check(error);
  if (!data) throw new ActionError("Choose a category.");
  return data.transaction_type as "INCOME" | "EXPENSE";
}

export async function addTransaction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const transaction = readTransaction(form);
    const type = await categoryType(supabase, transaction.category);

    const { error } = await supabase
      .from("financial_transactions")
      .insert({ ...transaction, transaction_type: type });
    check(error);
    return `${type === "INCOME" ? "Money in" : "Money out"} recorded and posted to the ledger.`;
  });
}

export async function updateTransaction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const transaction = readTransaction(form);
    const type = await categoryType(supabase, transaction.category);

    const { data, error } = await supabase
      .from("financial_transactions")
      .update({ ...transaction, transaction_type: type })
      .eq("id", id)
      .select("id");
    check(error);
    if (!data?.length) throw new ActionError("Transaction not found.");
    return "Transaction updated and re-posted.";
  });
}

export async function deleteTransaction(id: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(MANAGER_ROLES);
    const { data, error } = await supabase.from("financial_transactions").delete().eq("id", id).select("id");
    check(error);
    if (!data?.length) throw new ActionError("Transaction not found.");
    return "Transaction deleted and its posting reversed.";
  });
}

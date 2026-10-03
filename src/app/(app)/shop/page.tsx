import type { Metadata } from "next";
import { addItem, deleteRestock, deleteSale, recordSale, restockItem, updateItem } from "./actions";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { Field } from "@/components/ui/field";
import { stockStatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary, buttonSmall, inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { getStationSettings, isManager, requireStaff } from "@/lib/auth";
import { rows } from "@/lib/data";
import { addDaysISO, formatDate, formatMoney, formatNumber, PAYMENT_LABELS, todayISO } from "@/lib/format";
import type { ShopRestock, ShopSale, ShopStock } from "@/lib/types";

export const metadata: Metadata = { title: "Shop" };

const CATEGORIES = ["Lubricants", "Coolants", "Convenience", "Accessories", "Other"];

export default async function ShopPage() {
  const { supabase, profile } = await requireStaff();
  const settings = await getStationSettings();
  const manager = isManager(profile.role);
  const currency = settings.currency_code;
  const since = addDaysISO(todayISO(), -6);

  const [itemsResult, salesResult, restocksResult] = await Promise.all([
    supabase.from("v_shop_stock").select("*").order("category").order("item_name"),
    supabase
      .from("shop_sales")
      .select("*")
      .gte("sale_date", since)
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    manager
      ? supabase.from("shop_restocks").select("*").gte("restock_date", addDaysISO(todayISO(), -29)).order("restock_date", { ascending: false }).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const items = rows<ShopStock>(itemsResult, "shop items");
  const activeItems = items.filter((i) => i.is_active);
  const sales = rows<ShopSale>(salesResult, "shop sales");
  const restocks = rows<ShopRestock>(restocksResult, "restocks");
  const itemName = new Map(items.map((i) => [i.id, i.item_name]));
  const stockValue = items.reduce((sum, i) => sum + Number(i.stock_value), 0);
  const lowCount = activeItems.filter((i) => i.stock_status !== "OK").length;

  return (
    <>
      <PageHeader
        title="Shop & lubricants"
        description="Dry stock: SKUs, sales and restocks."
        actions={<RealtimeRefresh channel="shop" tables={["shop_inventory", "shop_sales"]} />}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Record a sale" description="Sold at the shelf price. Stock and the ledger update immediately.">
            {activeItems.length === 0 ? (
              <EmptyState>No items for sale yet.</EmptyState>
            ) : (
              <ActionForm action={recordSale} className="grid gap-4 sm:grid-cols-2">
                <Field label="Item" htmlFor="sale_item" className="sm:col-span-2">
                  <select id="sale_item" name="item_id" required className={inputClass}>
                    {activeItems.map((i) => (
                      <option key={i.id} value={i.id} disabled={i.quantity_in_stock === 0}>
                        {i.item_name} · {formatMoney(i.selling_price, currency)} · {i.quantity_in_stock} in stock
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity" htmlFor="sale_quantity">
                  <input id="sale_quantity" name="quantity" type="number" min={1} step={1} defaultValue={1} required className={inputClass} />
                </Field>
                <Field label="Payment" htmlFor="sale_payment">
                  <select id="sale_payment" name="payment_method" defaultValue="CASH" className={inputClass}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank / mobile money</option>
                    <option value="CREDIT">On credit</option>
                  </select>
                </Field>
                <Field label="Date" htmlFor="sale_date">
                  <input id="sale_date" name="sale_date" type="date" defaultValue={todayISO()} className={inputClass} />
                </Field>
                <div className="flex items-end">
                  <SubmitButton>Record sale</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>

          {manager && (
            <Card title="Receive stock" description="Adds to stock and updates the item's average cost.">
              {items.length === 0 ? (
                <EmptyState>Add an item first.</EmptyState>
              ) : (
                <ActionForm action={restockItem} className="grid gap-4 sm:grid-cols-2">
                  <Field label="Item" htmlFor="restock_item" className="sm:col-span-2">
                    <select id="restock_item" name="item_id" required className={inputClass}>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.item_name} ({i.sku}) · {i.quantity_in_stock} in stock
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" htmlFor="restock_quantity">
                    <input id="restock_quantity" name="quantity" type="number" min={1} step={1} required className={inputClass} />
                  </Field>
                  <Field label={`Unit cost (${currency})`} htmlFor="restock_cost">
                    <input id="restock_cost" name="unit_cost" inputMode="decimal" required className={inputClass} />
                  </Field>
                  <Field label="Supplier" htmlFor="restock_supplier">
                    <input id="restock_supplier" name="supplier" className={inputClass} />
                  </Field>
                  <Field label="Payment" htmlFor="restock_payment">
                    <select id="restock_payment" name="payment_method" defaultValue="CASH" className={inputClass}>
                      <option value="CASH">Paid in cash</option>
                      <option value="BANK">Paid by bank / mobile money</option>
                      <option value="CREDIT">On credit (pay supplier later)</option>
                    </select>
                  </Field>
                  <Field label="Date" htmlFor="restock_date">
                    <input id="restock_date" name="restock_date" type="date" defaultValue={todayISO()} className={inputClass} />
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton>Receive stock</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Card>
          )}
        </div>

        <Card
          title="Inventory"
          description={`${items.length} item${items.length === 1 ? "" : "s"} · ${lowCount} to reorder${manager ? ` · stock value ${formatMoney(stockValue, currency)} at cost` : ""}`}
        >
          {items.length === 0 ? (
            <EmptyState>No shop items yet.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Category</th>
                    <th className={`${thClass} ${numClass}`}>In stock</th>
                    <th className={thClass}>Status</th>
                    <th className={`${thClass} ${numClass}`}>Price</th>
                    {manager && <th className={`${thClass} ${numClass}`}>Avg cost</th>}
                    {manager && <th className={`${thClass} ${numClass}`}>Margin</th>}
                    {manager && <th className={thClass}><span className="sr-only">Edit</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.is_active ? undefined : "opacity-60"}>
                      <td className={tdClass}>
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">{item.item_name}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {item.sku}
                          {!item.is_active && " · not for sale"}
                        </p>
                      </td>
                      <td className={tdClass}>{item.category}</td>
                      <td className={`${tdClass} ${numClass}`}>
                        {item.quantity_in_stock}
                        <span className="block text-xs text-zinc-400">reorder at {item.reorder_threshold}</span>
                      </td>
                      <td className={tdClass}>{stockStatusBadge(item.stock_status)}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(item.selling_price, currency)}</td>
                      {manager && <td className={`${tdClass} ${numClass}`}>{formatMoney(item.cost_price, currency)}</td>}
                      {manager && (
                        <td className={`${tdClass} ${numClass}`}>
                          {Number(item.selling_price) > 0
                            ? `${formatNumber((Number(item.unit_margin) / Number(item.selling_price)) * 100, 1)}%`
                            : "—"}
                        </td>
                      )}
                      {manager && (
                        <td className={tdClass}>
                          <details>
                            <summary className={`${buttonSecondary} ${buttonSmall} cursor-pointer list-none`}>Edit</summary>
                            <ActionForm
                              action={updateItem.bind(null, item.id)}
                              resetOnSuccess={false}
                              className="mt-2 grid w-64 gap-2 whitespace-normal"
                            >
                              <input name="item_name" defaultValue={item.item_name} aria-label="Item name" className={inputClass} />
                              <select name="category" defaultValue={item.category} aria-label="Category" className={inputClass}>
                                {[...new Set([item.category, ...CATEGORIES])].map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                              <input name="selling_price" defaultValue={item.selling_price} inputMode="decimal" aria-label="Selling price" className={inputClass} />
                              <input name="reorder_threshold" defaultValue={item.reorder_threshold} type="number" min={0} aria-label="Reorder level" className={inputClass} />
                              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                <input type="checkbox" name="is_active" defaultChecked={item.is_active} /> For sale
                              </label>
                              <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Save</SubmitButton>
                            </ActionForm>
                          </details>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {manager && (
          <Card title="Add an item" description="Opening stock is valued at the cost price and recorded as owner's equity.">
            <ActionForm action={addItem} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Item name" htmlFor="item_name" className="sm:col-span-2">
                <input id="item_name" name="item_name" required placeholder="e.g. Engine oil 15W-40, 1 L" className={inputClass} />
              </Field>
              <Field label="SKU" htmlFor="sku">
                <input id="sku" name="sku" required placeholder="OIL-15W40-1L" className={inputClass} />
              </Field>
              <Field label="Category" htmlFor="category">
                <select id="category" name="category" defaultValue="Lubricants" className={inputClass}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Opening quantity" htmlFor="quantity_in_stock">
                <input id="quantity_in_stock" name="quantity_in_stock" type="number" min={0} step={1} defaultValue={0} className={inputClass} />
              </Field>
              <Field label={`Cost price (${currency})`} htmlFor="cost_price">
                <input id="cost_price" name="cost_price" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label={`Selling price (${currency})`} htmlFor="selling_price">
                <input id="selling_price" name="selling_price" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Reorder level" htmlFor="reorder_threshold">
                <input id="reorder_threshold" name="reorder_threshold" type="number" min={0} step={1} defaultValue={5} className={inputClass} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>Add item</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}

        <Card title={manager ? "Recent sales" : "Your recent sales"} description="Last 7 days.">
          {sales.length === 0 ? (
            <EmptyState>No sales in the last 7 days.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Day</th>
                    <th className={thClass}>Item</th>
                    <th className={`${thClass} ${numClass}`}>Qty</th>
                    <th className={`${thClass} ${numClass}`}>Total</th>
                    <th className={thClass}>Payment</th>
                    {manager && <th className={thClass}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td className={tdClass}>{formatDate(sale.sale_date)}</td>
                      <td className={tdClass}>{itemName.get(sale.item_id)}</td>
                      <td className={`${tdClass} ${numClass}`}>{sale.quantity}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(sale.total_amount, currency)}</td>
                      <td className={tdClass}>{PAYMENT_LABELS[sale.payment_method]}</td>
                      {manager && (
                        <td className={`${tdClass} text-right`}>
                          <DeleteButton action={deleteSale.bind(null, sale.id)} confirm="Delete this sale? The items go back into stock." />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {manager && (
          <Card title="Recent restocks" description="Last 30 days.">
            {restocks.length === 0 ? (
              <EmptyState>No restocks in the last 30 days.</EmptyState>
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Day</th>
                      <th className={thClass}>Item</th>
                      <th className={thClass}>Supplier</th>
                      <th className={`${thClass} ${numClass}`}>Qty</th>
                      <th className={`${thClass} ${numClass}`}>Cost</th>
                      <th className={thClass}>Payment</th>
                      <th className={thClass}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {restocks.map((r) => (
                      <tr key={r.id}>
                        <td className={tdClass}>{formatDate(r.restock_date)}</td>
                        <td className={tdClass}>{itemName.get(r.item_id)}</td>
                        <td className={tdClass}>{r.supplier ?? "—"}</td>
                        <td className={`${tdClass} ${numClass}`}>{r.quantity}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(r.total_cost, currency)}</td>
                        <td className={tdClass}>{PAYMENT_LABELS[r.payment_method]}</td>
                        <td className={`${tdClass} text-right`}>
                          <DeleteButton action={deleteRestock.bind(null, r.id)} confirm="Delete this restock? The items come back out of stock." />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

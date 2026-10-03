import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDate, formatLiters, formatMoney, formatSignedMoney } from "@/lib/format";
import type { ShiftSummary } from "@/lib/types";
import { EmptyState, TableWrap } from "@/components/ui/card";
import { shiftStatusBadge, StatusBadge } from "@/components/ui/status-badge";
import { numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export function VarianceCell({ shift, currency }: { shift: ShiftSummary; currency: string }) {
  if (shift.status === "OPEN" || shift.variance === null) {
    return <span className="text-zinc-400">—</span>;
  }
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">{formatSignedMoney(shift.variance, currency)}</span>
      {shift.is_short ? (
        <StatusBadge tone="critical">Short</StatusBadge>
      ) : Number(shift.variance) > 0 ? (
        <StatusBadge tone="warning">Over</StatusBadge>
      ) : null}
    </span>
  );
}

export function ShiftTable({
  shifts,
  currency,
  showDate = true,
  showAttendant = true,
}: {
  shifts: ShiftSummary[];
  currency: string;
  showDate?: boolean;
  showAttendant?: boolean;
}) {
  if (shifts.length === 0) return <EmptyState>No shifts found.</EmptyState>;

  return (
    <TableWrap>
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Shift</th>
            {showAttendant && <th className={thClass}>Attendant</th>}
            <th className={thClass}>Status</th>
            <th className={`${thClass} ${numClass}`}>Litres</th>
            <th className={`${thClass} ${numClass}`}>Expected</th>
            <th className={`${thClass} ${numClass}`}>Collected</th>
            <th className={`${thClass} ${numClass}`}>Difference</th>
            <th className={thClass}>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <td className={tdClass}>
                <Link href={`/shifts/${shift.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {shift.shift_label === "Day" ? "Full day" : shift.shift_label}
                </Link>
                {showDate && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(shift.shift_date)}</p>
                )}
              </td>
              {showAttendant && <td className={tdClass}>{shift.attendant_name}</td>}
              <td className={tdClass}>{shiftStatusBadge(shift.status, shift.is_short)}</td>
              <td className={`${tdClass} ${numClass}`}>{formatLiters(shift.liters_sold, 1)}</td>
              <td className={`${tdClass} ${numClass}`}>{formatMoney(shift.expected_sales, currency)}</td>
              <td className={`${tdClass} ${numClass}`}>
                {shift.status === "OPEN" ? "—" : formatMoney(shift.total_collected, currency)}
              </td>
              <td className={`${tdClass} ${numClass}`}>
                <VarianceCell shift={shift} currency={currency} />
              </td>
              <td className={`${tdClass} w-8`}>
                <Link href={`/shifts/${shift.id}`} aria-label="Open shift" className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

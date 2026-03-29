import type { FinanceByKind } from "@paperclipai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { financeEventKindDisplayName, formatCents } from "@/lib/utils";

interface FinanceKindCardProps {
  rows: FinanceByKind[];
}

export function FinanceKindCard({ rows }: FinanceKindCardProps) {
  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-1">
        <CardTitle className="text-base">财务事件分布</CardTitle>
        <CardDescription>按事件类型分组的账户级别费用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 pt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">此时段内无财务事件。</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.eventKind}
              className="flex items-center justify-between gap-3 border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{financeEventKindDisplayName(row.eventKind)}</div>
                <div className="text-xs text-muted-foreground">
                  {row.eventCount} 个事件 · {row.billerCount} 个计费方
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm font-medium">{formatCents(row.netCents)}</div>
                <div className="text-xs text-muted-foreground">
                  借方 {formatCents(row.debitCents)}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

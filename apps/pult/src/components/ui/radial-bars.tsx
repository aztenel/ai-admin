"use client";
// Из 21st.dev: LegionWebDev/pie-chart, пример «Radial Chart» (G26). Наши правки: данные через props
// (значение 0–100 у каждого кольца), подпись в центре, без своей карточки; цвета — --chart-1…5.

import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export interface RadialItem {
  key: string;
  label: string;
  /** 0–100 */
  value: number;
  slot?: 1 | 2 | 3 | 4 | 5;
}

export function RadialBars({ data, center, centerLabel, className }: { data: RadialItem[]; center?: string; centerLabel?: string; className?: string }) {
  const chartConfig: ChartConfig = { value: { label: "Загрузка" } };
  data.forEach((d, i) => (chartConfig[d.key] = { label: d.label, color: `var(--chart-${d.slot ?? (i % 5) + 1})` }));
  const rows = data.map((d) => ({ ...d, fill: `var(--color-${d.key})` }));

  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[220px]", className)}>
      <ChartContainer config={chartConfig} className="aspect-square h-full w-full">
        <RadialBarChart data={rows} innerRadius="34%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={12}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" formatter={(v, _n, item) => (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: (item.payload as { fill: string }).fill }} />
                {(item.payload as RadialItem).label}
              </span>
              <span className="font-semibold tabular-nums text-foreground">{v}%</span>
            </div>
          )} />} />
          <RadialBar cornerRadius={10} dataKey="value" background className="drop-shadow-lg" />
        </RadialBarChart>
      </ChartContainer>
      {center && (
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-xl font-semibold tabular-nums">{center}</span>
          {centerLabel && <span className="text-[10px] text-muted-foreground">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

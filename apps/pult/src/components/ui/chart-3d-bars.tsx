"use client";
// Из 21st.dev: sean0205/c-chart-6 «3D Gradient Bar Chart» (G7). Наши правки: данные, подпись и формат — через props
// (вместо зашитого примера), без своей карточки и бейджа (карточка — наша), id градиентов уникальны на странице.

import { useId, type SVGProps } from "react";
import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export interface Bars3DProps {
  data: { label: string; value: number }[];
  /** Подпись ряда в подсказке. */
  seriesLabel: string;
  format?: (v: number) => string;
  className?: string;
}

const True3DBar = (props: SVGProps<SVGRectElement> & { dataKey?: string; payload?: unknown; index?: number; gid?: string }) => {
  const { x, y, width, height, gid } = props;
  const barX = x as number;
  const barY = y as number;
  const barWidth = width as number;
  const barHeight = height as number;
  if (!barHeight || barHeight <= 0) return null;

  // 3D perspective parameters
  const depth = Math.min(barWidth * 0.3, 15); // Maximum depth of 15px

  return (
    <g>
      {/* Back face */}
      <rect x={barX + depth} y={barY - depth} width={barWidth} height={barHeight} fill={`url(#${gid}-back)`} rx="3" />

      {/* Right side face */}
      <polygon
        points={`${barX + barWidth + 3},${barY - 3} ${barX + barWidth + depth - 3},${barY - depth + 3} ${barX + barWidth + depth - 3},${barY + barHeight - depth - 3} ${barX + barWidth + 3},${barY + barHeight - 3}`}
        fill={`url(#${gid}-side)`}
      />

      {/* Top face */}
      <polygon
        points={`${barX + 3},${barY - 3} ${barX + barWidth - 3},${barY - 3} ${barX + barWidth + depth - 3},${barY - depth + 3} ${barX + depth + 3},${barY - depth + 3}`}
        fill={`url(#${gid}-top)`}
      />

      {/* Front face */}
      <rect x={barX} y={barY} width={barWidth} height={barHeight} fill={`url(#${gid}-front)`} rx="3" />
    </g>
  );
};

export function Bars3D({ data, seriesLabel, format = (v) => v.toLocaleString("ru-RU"), className }: Bars3DProps) {
  const gid = "b3d" + useId().replace(/:/g, "");
  const chartConfig = { value: { label: seriesLabel, color: "var(--chart-1)" } } satisfies ChartConfig;
  const stop = (o1: number, o2: number) => (
    <>
      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={o1} />
      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={o2} />
    </>
  );

  return (
    <ChartContainer config={chartConfig} className={cn("aspect-auto h-64 w-full", className)}>
      <BarChart accessibilityLayer data={data} margin={{ top: 28, right: 24, bottom: 4, left: 4 }} barCategoryGap="20%">
        <defs>
          <linearGradient id={`${gid}-front`} x1="0" y1="0" x2="0" y2="1">
            {stop(0.9, 0.7)}
          </linearGradient>
          <linearGradient id={`${gid}-back`} x1="0" y1="0" x2="0" y2="1">
            {stop(0.5, 0.3)}
          </linearGradient>
          <linearGradient id={`${gid}-side`} x1="0" y1="0" x2="1" y2="0">
            {stop(0.6, 0.4)}
          </linearGradient>
          <linearGradient id={`${gid}-top`} x1="0" y1="0" x2="1" y2="1">
            {stop(0.7, 0.5)}
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              className="min-w-40 gap-2.5"
              formatter={(value) => (
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 shrink-0 rounded-xs bg-chart-1" />
                    <span className="text-muted-foreground">{seriesLabel}</span>
                  </div>
                  <span className="font-semibold text-foreground">{format(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="value" fill={`url(#${gid}-front)`} shape={<True3DBar gid={gid} />} />
      </BarChart>
    </ChartContainer>
  );
}

import { Box, Table, Text, useComputedColorScheme } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useState } from 'react';
import { count, date, rupees } from '../lib/format';
import classes from './DailyColumns.module.css';

export interface DailyPoint {
  date: string; // YYYY-MM-DD (IST)
  orders: number;
  gmvPaise: number;
}

/** Reference categorical slot 1 (blue), with its own dark-surface step. */
const SERIES = { light: '#257de0', dark: '#338ced' };

const H = 160;
const PAD = { top: 12, right: 8, bottom: 22, left: 36 };
const BAR_MAX = 24;
const GAP = 2;

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => v <= s * 4) ?? pow * 10;
  return step * 4;
}

/** Column with a 4px rounded data end and a square base. */
function column(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Orders per day, single series. Hover or focus a day for orders and GMV; the same data is
 * available as a table under the chart.
 */
export function DailyColumns({ data }: { data: DailyPoint[] }) {
  const scheme = useComputedColorScheme('light');
  const [active, setActive] = useState<number | null>(null);
  const { ref, width: measured } = useElementSize();
  const width = measured || 640;

  const max = niceMax(Math.max(0, ...data.map((d) => d.orders)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = data.length ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(BAR_MAX, band - GAP));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = active !== null ? data[active] : undefined;

  return (
    <Box>
      <div
        className={classes.wrap}
        ref={ref}
      >
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`Orders per day for the last ${data.length} days`}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={classes.grid} />
              <text x={PAD.left - 6} y={y(t)} className={classes.tick} textAnchor="end" dominantBaseline="middle">
                {count(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const top = y(d.orders);
            return (
              <g key={d.date}>
                <path
                  d={column(cx - barW / 2, top, barW, PAD.top + plotH - top)}
                  fill={scheme === 'dark' ? SERIES.dark : SERIES.light}
                  opacity={active === null || active === i ? 1 : 0.45}
                />
                {/* Hit target: the whole day's band, not just the bar. */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${date(d.date)}: ${count(d.orders)} orders, ${rupees(d.gmvPaise, { decimals: false })}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
          {[0, data.length - 1].filter((i) => i >= 0 && data[i]).map((i) => (
            <text
              key={i}
              x={PAD.left + band * i + band / 2}
              y={H - 6}
              className={classes.tick}
              textAnchor={i === 0 ? 'start' : 'end'}
            >
              {date(data[i]!.date).replace(/ \d{4}$/, '')}
            </text>
          ))}
        </svg>
        {hovered && active !== null && (
          <div
            className={classes.tooltip}
            style={{ left: Math.min(Math.max(PAD.left + band * active + band / 2, 70), width - 70), top: 0 }}
          >
            <Text size="xs" fw={600}>
              {date(hovered.date)}
            </Text>
            <Text size="xs">{count(hovered.orders)} orders</Text>
            <Text size="xs" c="dimmed">
              {rupees(hovered.gmvPaise, { decimals: false })} GMV
            </Text>
          </div>
        )}
      </div>
      <details className={classes.table}>
        <summary>View as table</summary>
        <Table striped mt="xs" fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th ta="right">Orders</Table.Th>
              <Table.Th ta="right">GMV</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((d) => (
              <Table.Tr key={d.date}>
                <Table.Td>{date(d.date)}</Table.Td>
                <Table.Td ta="right">{count(d.orders)}</Table.Td>
                <Table.Td ta="right">{rupees(d.gmvPaise, { decimals: false })}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </details>
    </Box>
  );
}

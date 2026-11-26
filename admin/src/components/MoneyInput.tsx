import { NumberInput, type NumberInputProps } from '@mantine/core';

type Base = Omit<NumberInputProps, 'value' | 'onChange'>;

/** Edit an amount in rupees; the value in and out is integer paise (as the API stores money). */
export function RupeeInput({ paise, onPaise, ...props }: Base & { paise: number | null; onPaise: (p: number | null) => void }) {
  return (
    <NumberInput
      prefix="₹ "
      decimalScale={2}
      thousandSeparator=","
      thousandsGroupStyle="lakh"
      min={0}
      allowNegative={false}
      value={paise === null ? '' : paise / 100}
      onChange={(v) => onPaise(v === '' || v === null ? null : Math.round(Number(v) * 100))}
      {...props}
    />
  );
}

/** Edit a percentage; the value in and out is basis points (500 = 5%). */
export function PercentInput({ bps, onBps, ...props }: Base & { bps: number | null; onBps: (b: number | null) => void }) {
  return (
    <NumberInput
      suffix=" %"
      decimalScale={2}
      min={0}
      max={100}
      allowNegative={false}
      value={bps === null ? '' : bps / 100}
      onChange={(v) => onBps(v === '' || v === null ? null : Math.round(Number(v) * 100))}
      {...props}
    />
  );
}

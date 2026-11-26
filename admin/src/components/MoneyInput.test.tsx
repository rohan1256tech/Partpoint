import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PercentInput, RupeeInput } from './MoneyInput';

const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>);

describe('money inputs', () => {
  it('turns rupees typed by the admin into integer paise', async () => {
    const onPaise = vi.fn();
    wrap(<RupeeInput label="Fee" paise={null} onPaise={onPaise} />);
    await userEvent.type(screen.getByLabelText('Fee'), '123.45');
    expect(onPaise).toHaveBeenLastCalledWith(12_345);
  });

  it('shows stored paise as rupees with Indian grouping', () => {
    wrap(<RupeeInput label="Fee" paise={12_345_600} onPaise={() => {}} />);
    expect(screen.getByLabelText('Fee')).toHaveValue('₹ 1,23,456');
  });

  it('turns a percentage into basis points', async () => {
    const onBps = vi.fn();
    wrap(<PercentInput label="Commission" bps={null} onBps={onBps} />);
    await userEvent.type(screen.getByLabelText('Commission'), '5.5');
    expect(onBps).toHaveBeenLastCalledWith(550);
  });

  it('reports an emptied field as null', async () => {
    const onPaise = vi.fn();
    wrap(<RupeeInput label="Cap" paise={5_000} onPaise={onPaise} />);
    await userEvent.clear(screen.getByLabelText('Cap'));
    expect(onPaise).toHaveBeenLastCalledWith(null);
  });
});

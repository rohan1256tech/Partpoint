import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionContextValue } from '../auth/context';
import { LoginPage } from './LoginPage';

function setup(overrides: Partial<SessionContextValue> = {}) {
  const session: SessionContextValue = {
    status: 'signedOut',
    user: null,
    signIn: vi.fn().mockResolvedValue({ challengeToken: 'challenge-1' }),
    verifyCode: vi.fn().mockResolvedValue(undefined),
    mfaCompleted: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
  render(
    <MantineProvider>
      <SessionContext.Provider value={session}>
        <LoginPage />
      </SessionContext.Provider>
    </MantineProvider>,
  );
  return session;
}

describe('LoginPage', () => {
  it('asks for the authenticator code after the password and submits it', async () => {
    const user = userEvent.setup();
    const session = setup();
    await user.type(screen.getByLabelText(/email/i), 'ops@example.in');
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'secret-pass-123');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(session.signIn).toHaveBeenCalledWith('ops@example.in', 'secret-pass-123');
    expect(await screen.findByText(/6-digit code/i)).toBeInTheDocument();

    const first = screen.getAllByRole('textbox')[0] ?? screen.getAllByRole('spinbutton')[0];
    await user.click(first!);
    await user.keyboard('123456');
    expect(session.verifyCode).toHaveBeenCalledWith('challenge-1', '123456');
  });

  it('shows the server’s error message', async () => {
    const user = userEvent.setup();
    setup({ signIn: vi.fn().mockRejectedValue(new Error('Invalid email or password')) });
    await user.type(screen.getByLabelText(/email/i), 'ops@example.in');
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'wrong');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

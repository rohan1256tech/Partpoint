import { Alert, Anchor, Button, Center, Paper, PasswordInput, PinInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useSession } from '../auth/context';

export function LoginPage() {
  const { signIn, verifyCode } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const next = await signIn(email.trim(), password);
      if (next) setChallenge(next.challengeToken);
    });
  };

  const submitCode = (value = code) => {
    if (!challenge || value.length !== 6) return;
    void run(async () => {
      try {
        await verifyCode(challenge, value);
      } catch (err) {
        setCode('');
        throw err;
      }
    });
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder radius="md" p="xl" w={380} shadow="sm">
        <Stack gap="xs" mb="lg">
          <Title order={2}>Partpoint Admin</Title>
          <Text c="dimmed" size="sm">
            {challenge ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to manage the platform.'}
          </Text>
        </Stack>

        {error && (
          <Alert color="red" mb="md" role="alert">
            {error}
          </Alert>
        )}

        {!challenge ? (
          <form onSubmit={submitPassword}>
            <Stack>
              <TextInput
                label="Email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <PasswordInput
                label="Password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <Button type="submit" loading={busy} fullWidth>
                Continue
              </Button>
            </Stack>
          </form>
        ) : (
          <Stack align="center">
            <PinInput
              length={6}
              type="number"
              oneTimeCode
              autoFocus
              value={code}
              onChange={setCode}
              onComplete={submitCode}
              disabled={busy}
              aria-label="Authentication code"
            />
            <Button onClick={() => submitCode()} loading={busy} fullWidth disabled={code.length !== 6}>
              Verify
            </Button>
            <Anchor
              component="button"
              size="sm"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setError(null);
              }}
            >
              Use a different account
            </Anchor>
          </Stack>
        )}
      </Paper>
    </Center>
  );
}

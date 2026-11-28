import { Alert, Anchor, Box, Button, Center, Paper, PasswordInput, PinInput, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { Wordmark } from '../components/BrandMark';
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
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={0} mih="100vh">
      <Box visibleFrom="md" pos="relative" style={{ backgroundImage: 'url(/login-hero.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <Box pos="absolute" inset={0} style={{ background: 'linear-gradient(160deg, rgba(11,11,13,0.55) 0%, rgba(11,11,13,0.92) 75%)' }} />
        <Stack pos="absolute" inset={0} p={48} justify="space-between">
          <Wordmark onDark size={40} />
          <div>
            <Text c="#FFC51A" fw={700} size="sm" style={{ letterSpacing: '0.12em' }}>
              PARTS. PRICE. FAST DELIVERY.
            </Text>
            <Title order={1} c="white" mt="xs" fz={40} lh={1.15}>
              Run the whole network
              <br />
              from one place.
            </Title>
            <Text c="gray.4" mt="md" maw={440}>
              Approve businesses, keep the catalog sharp, send every order to the right wholesaler and get it delivered.
            </Text>
          </div>
        </Stack>
      </Box>
      <Center p="xl">
      <Paper withBorder p="xl" w="100%" maw={400} shadow="md">
        <Box hiddenFrom="md" mb="lg">
          <Wordmark size={34} />
        </Box>
        <Stack gap="xs" mb="lg">
          <Title order={2}>{challenge ? 'Two-step verification' : 'Welcome back'}</Title>
          <Text c="dimmed" size="sm">
            {challenge ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to the Sakshay Connect admin console.'}
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
    </SimpleGrid>
  );
}

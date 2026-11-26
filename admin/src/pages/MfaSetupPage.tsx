import { Alert, Button, Center, Code, Group, Image, List, Loader, Paper, PinInput, Stack, Text, Title } from '@mantine/core';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useSession } from '../auth/context';

/** First sign-in of an admin: set up the authenticator app before anything else is allowed. */
export function MfaSetupPage() {
  const { mfaCompleted, signOut, user } = useSession();
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .post<{ secret: string; otpauthUri: string }>('/v1/admin/2fa/setup')
      .then(async (res) => {
        // The QR code is drawn in the browser; the secret never goes to a third-party service.
        const dataUrl = await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 220 });
        if (!cancelled) {
          setSecret(res.secret);
          setQr(dataUrl);
        }
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable(value = code) {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/2fa/enable', { code: value });
      await mfaCompleted();
    } catch (err) {
      setCode('');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder radius="md" p="xl" w={460} shadow="sm">
        <Stack>
          <div>
            <Title order={2}>Set up two-factor authentication</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Required for every admin account{user?.email ? ` (${user.email})` : ''}.
            </Text>
          </div>

          <List type="ordered" size="sm" spacing={4}>
            <List.Item>Open Google Authenticator, Microsoft Authenticator or a similar app.</List.Item>
            <List.Item>Scan this code, or enter the key by hand.</List.Item>
            <List.Item>Type the 6-digit code the app shows.</List.Item>
          </List>

          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}

          <Center mih={220}>{qr ? <Image src={qr} w={220} h={220} alt="Authenticator QR code" /> : <Loader />}</Center>
          {secret && (
            <Text size="sm" ta="center">
              Key: <Code>{secret.replace(/(.{4})/g, '$1 ').trim()}</Code>
            </Text>
          )}

          <Group justify="center">
            <PinInput
              length={6}
              type="number"
              oneTimeCode
              value={code}
              onChange={setCode}
              onComplete={(v) => void enable(v)}
              disabled={busy || !secret}
              aria-label="Authentication code"
            />
          </Group>
          <Button onClick={() => void enable()} loading={busy} disabled={code.length !== 6}>
            Turn on two-factor authentication
          </Button>
          <Button variant="subtle" color="gray" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}

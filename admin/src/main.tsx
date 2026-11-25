import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { App } from './App';
import { SessionProvider } from './auth/session';

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (4xx) will not fix themselves on retry.
      retry: (failures, err) => !(err instanceof ApiError && err.status < 500) && failures < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);

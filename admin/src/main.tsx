import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import './global.css';
import { createTheme, MantineProvider, virtualColor } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { App } from './App';
import { SessionProvider } from './auth/session';

/**
 * Neutral ink for buttons, links and focus (readable in both themes); Sakshay yellow (brand) for
 * the active menu item and highlights. autoContrast picks black or white text on each.
 */
const theme = createTheme({
  colors: {
    ink: ['#f4f4f6', '#e4e5e9', '#c9cad1', '#a9abb3', '#8a8c95', '#6b6d76', '#4e5058', '#35363d', '#1f2025', '#111114'],
    brand: ['#fff9e1', '#fff1cc', '#ffe29b', '#ffd264', '#ffc537', '#ffbd1a', '#ffb800', '#e3a200', '#ca8f00', '#af7b00'],
    // Ink buttons on light pages, Sakshay yellow (with black text) on dark ones.
    primary: virtualColor({ name: 'primary', light: 'ink', dark: 'brand' }),
  },
  primaryColor: 'primary',
  primaryShade: { light: 9, dark: 5 },
  autoContrast: true,
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '800' },
  components: {
    Paper: { defaultProps: { radius: 'lg' } },
    Card: { defaultProps: { radius: 'lg' } },
    Button: { defaultProps: { radius: 'md' } },
  },
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

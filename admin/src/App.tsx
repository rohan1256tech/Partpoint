import { Center, Loader } from '@mantine/core';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSession } from './auth/context';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MfaSetupPage } from './pages/MfaSetupPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }
  if (status === 'signedOut') return <LoginPage />;
  if (status === 'needsMfaSetup') return <MfaSetupPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

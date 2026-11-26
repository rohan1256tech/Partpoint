import { Center, Loader } from '@mantine/core';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSession } from './auth/context';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { MfaSetupPage } from './pages/MfaSetupPage';

// Each section loads on demand, keeping the first load small.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const CategoriesPage = lazy(() => import('./pages/catalog/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const BrandsPage = lazy(() => import('./pages/catalog/BrandsPage').then((m) => ({ default: m.BrandsPage })));
const OrdersPage = lazy(() => import('./pages/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const DeliveryPartnersPage = lazy(() =>
  import('./pages/delivery/DeliveryPartnersPage').then((m) => ({ default: m.DeliveryPartnersPage })),
);
const CouponsPage = lazy(() => import('./pages/marketing/CouponsPage').then((m) => ({ default: m.CouponsPage })));
const BannersPage = lazy(() => import('./pages/marketing/BannersPage').then((m) => ({ default: m.BannersPage })));
const AnnouncementsPage = lazy(() => import('./pages/marketing/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })));
const ReviewsPage = lazy(() => import('./pages/marketing/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const FinancePage = lazy(() => import('./pages/money/FinancePage').then((m) => ({ default: m.FinancePage })));
const ReportsPage = lazy(() => import('./pages/money/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const DeletionRequestsPage = lazy(() => import('./pages/admin/DeletionRequestsPage').then((m) => ({ default: m.DeletionRequestsPage })));
const ProductsPage = lazy(() => import('./pages/catalog/ProductsPage').then((m) => ({ default: m.ProductsPage })));

const Spinner = () => (
  <Center mih="100vh">
    <Loader />
  </Center>
);

export function App() {
  const { status } = useSession();

  if (status === 'loading') return <Spinner />;
  if (status === 'signedOut') return <LoginPage />;
  if (status === 'needsMfaSetup') return <MfaSetupPage />;

  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="delivery-partners" element={<DeliveryPartnersPage />} />
            <Route path="catalog/categories" element={<CategoriesPage />} />
            <Route path="catalog/brands" element={<BrandsPage />} />
            <Route path="catalog/products" element={<ProductsPage />} />
            <Route path="marketing/coupons" element={<CouponsPage />} />
            <Route path="marketing/banners" element={<BannersPage />} />
            <Route path="marketing/reviews" element={<ReviewsPage />} />
            <Route path="marketing/announcements" element={<AnnouncementsPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="account-deletions" element={<DeletionRequestsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

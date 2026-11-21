import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { LookupProvider } from './context/LookupContext';
import { isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import { Button, Card, Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import People from './pages/People';
import PersonDetail from './pages/PersonDetail';
import Activities from './pages/Activities';
import Satsang from './pages/Satsang';
import ActivityDetail from './pages/ActivityDetail';
import Settings from './pages/Settings';
import Interviews from './pages/Interviews';
import Book from './pages/Book';

export default function App() {
  const { session, loading, role, can, signOut, refresh } = useAuth();
  const { pathname } = useLocation();

  // Public candidate booking page – no login required
  if (pathname.startsWith('/book/'))
    return (
      <Routes>
        <Route path="/book/:token" element={<Book />} />
      </Routes>
    );

  if (!isConfigured)
    return (
      <div className="mx-auto max-w-md p-6">
        <Card>
          <h1 className="mb-2 text-lg font-bold">Supabase not configured</h1>
          <p className="text-sm text-stone-600">
            Create a <code>.env</code> file with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).
          </p>
        </Card>
      </div>
    );

  if (loading) return <Spinner />;
  if (!session) return <Login />;

  if (!role || role.permissions.length === 0)
    return (
      <div className="mx-auto max-w-md p-6">
        <Card className="space-y-3 text-center">
          <h1 className="text-lg font-bold">Awaiting approval</h1>
          <p className="text-sm text-stone-600">Your account is created. An admin needs to assign you a role before you can use the app.</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={refresh}>
              Check again
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    );

  return (
    <LookupProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          {can('view') && (
            <>
              <Route path="activities" element={<Activities />} />
              <Route path="activities/:id" element={<ActivityDetail />} />
              <Route path="satsang" element={<Satsang />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<PersonDetail />} />
            </>
          )}
          <Route path="settings" element={<Settings />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LookupProvider>
  );
}

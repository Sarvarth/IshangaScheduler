import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const icons: Record<string, string> = {
  home: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10',
  activities: 'M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  satsang: 'M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.88-9.88 1.42-1.42M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  people: 'M17 20h5v-2a4 4 0 00-5-3.87M9 20H2v-2a4 4 0 015-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 2a3 3 0 11-6 0 3 3 0 016 0z',
  interviews: 'M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.4-4 8-9 8a9.9 9.9 0 01-4.3-.95L3 20l1.4-3.7A7.6 7.6 0 013 12c0-4.4 4-8 9-8s9 3.6 9 8z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003 14H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
};

const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={icons[name]} />
  </svg>
);

export default function Layout() {
  const { can, profile, role, signOut } = useAuth();
  const nav = [
    { to: '/', label: 'Home', icon: 'home', show: true },
    { to: '/activities', label: 'Activities', icon: 'activities', show: can('view') },
    { to: '/satsang', label: 'Satsang', icon: 'satsang', show: can('view') },
    { to: '/people', label: 'Ishangas', icon: 'people', show: can('view') },
    { to: '/interviews', label: 'Interviews', icon: 'interviews', show: can('manage_activities') || (can('opt_in') && !!profile?.person_id) },
    { to: '/settings', label: 'Settings', icon: 'settings', show: can('manage_settings') || can('manage_users') || can('export') },
  ].filter((n) => n.show);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-orange-100 text-orange-900' : 'text-stone-700 hover:bg-stone-100'}`;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200 bg-white p-4 md:flex">
        <div className="mb-6">
          <div className="text-lg font-bold text-orange-900">Ishanga Scheduler</div>
          <div className="text-xs text-stone-500">North Bharat</div>
        </div>
        <nav className="flex-1 space-y-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkCls}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 pt-3 text-xs text-stone-500">
          <div className="truncate font-medium text-stone-700">{profile?.full_name}</div>
          <div className="mb-2">{role?.name}</div>
          <button onClick={signOut} className="text-orange-800 hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div>
          <div className="font-bold text-orange-900">Ishanga Scheduler</div>
          <div className="text-[11px] text-stone-500">
            {profile?.full_name} · {role?.name}
          </div>
        </div>
        <button onClick={signOut} className="text-sm text-orange-800">
          Sign out
        </button>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 md:p-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-orange-800' : 'text-stone-500'}`}
          >
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

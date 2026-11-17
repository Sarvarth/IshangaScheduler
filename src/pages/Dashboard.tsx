import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT, ASSIGNMENT_STATUS, addDaysISO, color, errMsg, fmtDate, safeUrl, todayISO } from '../lib/format';
import { exportAllToExcel } from '../lib/export';
import type { Activity, Assignment, Booking, Candidate } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import { InterviewOverview } from '../components/dashboard/Overview';
import { fmtDay, fmtTime, istDate } from '../lib/time';
import { Badge, Button, Card, ChipSelect, Empty, PageHeader, Select, Spinner, Tabs, useToast } from '../components/ui';

type Asg = Assignment & { people: { full_name: string } };
type Range = 'next7' | 'next30' | 'next90' | 'past30' | 'past90';

const RANGES: Record<Range, { label: string; from: number; to: number }> = {
  next7: { label: 'Next 7 days', from: 0, to: 7 },
  next30: { label: 'Next 30 days', from: 0, to: 30 },
  next90: { label: 'Next 90 days', from: 0, to: 90 },
  past30: { label: 'Last 30 days', from: -30, to: -1 },
  past90: { label: 'Last 90 days', from: -90, to: -1 },
};

export default function Dashboard() {
  const { can, profile } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportAllToExcel();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Namaskaram${profile?.full_name ? ', ' + profile.full_name.split(' ')[0] : ''}`}
        actions={
          can('export') && (
            <Button variant="secondary" onClick={doExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export Excel'}
            </Button>
          )
        }
      />
      {profile?.person_id && can('view') && <MySchedule personId={profile.person_id} />}
      {can('view_dashboard') && <InterviewOverview />}
      {can('view_dashboard') && <Central />}
      {!profile?.person_id && !can('view_dashboard') && (
        <Empty>Your login is not linked to an Ishanga profile yet. Ask an admin to link it so you can opt in to activities.</Empty>
      )}
    </>
  );
}

function MySchedule({ personId }: { personId: string }) {
  const L = useLookups();
  const [mine, setMine] = useState<(Assignment & { activities: Activity })[] | null>(null);
  const [open, setOpen] = useState<Activity[]>([]);
  const [myTypes, setMyTypes] = useState<string[]>([]);
  const [newInterviews, setNewInterviews] = useState(0);
  const [interviews, setInterviews] = useState<(Booking & { candidates: Pick<Candidate, 'full_name' | 'language'> })[]>([]);
  const [hasAvailability, setHasAvailability] = useState(true);

  useEffect(() => {
    const today = todayISO();
    const now = new Date().toISOString();
    supabase
      .from('interview_bookings')
      .select('*, candidates(full_name, language)')
      .eq('person_id', personId)
      .eq('status', 'booked')
      .gt('ends_at', now)
      .order('starts_at')
      .then(({ data }) => {
        const list = (data ?? []) as typeof interviews;
        setInterviews(list);
        setNewInterviews(list.filter((b) => !b.acknowledged_at).length);
      });
    supabase
      .from('interviewer_availability')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', personId)
      .gt('starts_at', now)
      .lt('starts_at', new Date(Date.now() + 14 * 864e5).toISOString())
      .then(({ count }) => setHasAvailability((count ?? 0) > 0));
    (async () => {
      const [m, o, t] = await Promise.all([
        supabase.from('assignments').select('*, activities!inner(*)').eq('person_id', personId).gte('activities.start_date', today).in('status', ACTIVE_ASSIGNMENT),
        supabase.from('activities').select('*').gte('start_date', today).lte('start_date', addDaysISO(today, 60)).eq('opt_in_open', true).in('status', ['planned', 'confirmed']).order('start_date'),
        supabase.from('person_types').select('type_id').eq('person_id', personId),
      ]);
      const list = ((m.data ?? []) as (Assignment & { activities: Activity })[])
        // Interviews are shown from bookings (with Meet link), not as generic activities
        .filter((a) => !L.activityTypeById.get(a.activities.activity_type_id)?.has_candidates)
        .sort((a, b) => a.activities.start_date.localeCompare(b.activities.start_date));
      setMine(list);
      const mineIds = new Set(list.map((x) => x.activity_id));
      setOpen(((o.data ?? []) as Activity[]).filter((a) => !mineIds.has(a.id)));
      setMyTypes((t.data ?? []).map((x) => x.type_id as string));
    })();
  }, [personId, L]);

  const openForMe = open.filter((a) => L.rolesForType(a.activity_type_id).some((r) => r.allow_self_opt_in && L.isEligible(myTypes, r.id)));
  const canInterview = !!L.interviewRoleId && L.isEligible(myTypes, L.interviewRoleId) && myTypes.length > 0;

  return (
    <>
    {newInterviews > 0 && (
      <Link to="/interviews" className="mb-4 block rounded-xl border-2 border-orange-500 bg-orange-50 p-4">
        <div className="font-semibold text-orange-900">
          🎤 You have {newInterviews} new interview{newInterviews > 1 ? 's' : ''} booked
        </div>
        <div className="text-sm text-orange-800">Tap to see the candidate details and confirm →</div>
      </Link>
    )}
    {canInterview && !hasAvailability && (
      <Link to="/interviews" className="mb-4 block rounded-xl border border-sky-300 bg-sky-50 p-4">
        <div className="font-semibold text-sky-900">🗓 Add your free times for interviews</div>
        <div className="text-sm text-sky-800">You have no availability in the next 2 weeks →</div>
      </Link>
    )}
    {interviews.length > 0 && (
      <section className="mb-6">
        <h2 className="mb-2 font-semibold">My upcoming interviews</h2>
        <div className="space-y-2">
          {interviews.map((b) => (
            <Card key={b.id} className="flex items-center justify-between gap-2 !p-3">
              <Link to="/interviews" className="min-w-0">
                <div className="text-xs text-stone-500">
                  {fmtDay(istDate(b.starts_at))} · <b className="text-stone-800">{fmtTime(b.starts_at)}</b>
                </div>
                <div className="truncate font-medium">{b.candidates.full_name}</div>
                <div className="text-xs">
                  {b.acknowledged_at ? <span className="text-emerald-700">✓ Confirmed</span> : <span className="text-amber-700">Please confirm</span>}
                  {b.candidates.language && <span className="text-stone-500"> · {b.candidates.language}</span>}
                </div>
              </Link>
              {safeUrl(b.meeting_link) && (
                <a href={safeUrl(b.meeting_link)!} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-orange-800 px-3 py-2 text-xs font-medium text-white">
                  🎥 Join
                </a>
              )}
            </Card>
          ))}
        </div>
      </section>
    )}
    <div className="mb-8 grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 font-semibold">My upcoming seva</h2>
        {!mine ? (
          <Spinner />
        ) : mine.length === 0 ? (
          <Empty>Nothing scheduled yet.</Empty>
        ) : (
          <div className="space-y-2">
            {mine.map((a) => {
              const at = L.activityTypeById.get(a.activities.activity_type_id);
              return (
                <Link key={a.id} to={`/activities/${a.activity_id}`} className={`block rounded-lg border border-l-4 border-stone-200 bg-white p-3 ${color(at?.color).border}`}>
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="font-medium">{a.activities.title}</div>
                      <div className="text-xs text-stone-500">
                        {fmtDate(a.activities.start_date)} · {L.roleById.get(a.role_id)?.name}
                      </div>
                    </div>
                    <Badge c={ASSIGNMENT_STATUS[a.status].color}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Open for you to opt in</h2>
        {openForMe.length === 0 ? (
          <Empty>No open activities right now.</Empty>
        ) : (
          <div className="space-y-2">
            {openForMe.slice(0, 8).map((a) => {
              const at = L.activityTypeById.get(a.activity_type_id);
              return (
                <Link key={a.id} to={`/activities/${a.id}`} className={`block rounded-lg border border-l-4 border-stone-200 bg-white p-3 ${color(at?.color).border}`}>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-stone-500">
                    {fmtDate(a.start_date)} · {at?.name}
                    {a.city && ` · ${a.city}`}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
    </>
  );
}

function Central() {
  const L = useLookups();
  const [range, setRange] = useState<Range>('next30');
  const [types, setTypes] = useState<string[]>([]);
  const [view, setView] = useState<'coverage' | 'people'>('coverage');
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [asg, setAsg] = useState<Asg[]>([]);
  const [activePeople, setActivePeople] = useState(0);

  useEffect(() => {
    setActs(null);
    const today = todayISO();
    const r = RANGES[range];
    (async () => {
      let q = supabase.from('activities').select('*').gte('start_date', addDaysISO(today, r.from)).lte('start_date', addDaysISO(today, r.to)).neq('status', 'cancelled').order('start_date');
      if (types.length) q = q.in('activity_type_id', types);
      const [{ data }, pc] = await Promise.all([q, supabase.from('people').select('id', { count: 'exact', head: true }).eq('is_active', true)]);
      const list = (data ?? []) as Activity[];
      setActivePeople(pc.count ?? 0);
      if (list.length) {
        const { data: a } = await supabase
          .from('assignments')
          .select('*, people(full_name)')
          .in('activity_id', list.map((x) => x.id))
          .in('status', ACTIVE_ASSIGNMENT);
        setAsg((a ?? []) as Asg[]);
      } else setAsg([]);
      setActs(list);
    })();
  }, [range, types]);

  const stats = useMemo(() => {
    let openSlots = 0;
    for (const a of acts ?? []) {
      for (const r of L.rolesForType(a.activity_type_id)) {
        if (r.default_capacity == null) continue;
        const n = asg.filter((x) => x.activity_id === a.id && x.role_id === r.id).length;
        openSlots += Math.max(0, r.default_capacity - n);
      }
    }
    return {
      activities: acts?.length ?? 0,
      involved: new Set(asg.map((a) => a.person_id)).size,
      pending: asg.filter((a) => a.status === 'opted_in').length,
      openSlots,
    };
  }, [acts, asg, L]);

  const byPerson = useMemo(() => {
    const actById = new Map((acts ?? []).map((a) => [a.id, a]));
    const m = new Map<string, { name: string; items: { a: Activity; role: string; status: Asg['status'] }[] }>();
    for (const x of asg) {
      const a = actById.get(x.activity_id);
      if (!a) continue;
      const e = m.get(x.person_id) ?? { name: x.people.full_name, items: [] };
      e.items.push({ a, role: L.roleById.get(x.role_id)?.name ?? '', status: x.status });
      m.set(x.person_id, e);
    }
    return [...m.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[1].name.localeCompare(b[1].name));
  }, [acts, asg, L]);

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Seva coverage</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="!w-auto" value={range} onChange={(e) => setRange(e.target.value as Range)}>
          {Object.entries(RANGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-4">
        <ChipSelect options={L.activityTypes} value={types} onChange={setTypes} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard n={stats.activities} label="Activities" />
        <StatCard n={`${stats.involved}/${activePeople}`} label="Ishangas involved" />
        <StatCard n={stats.openSlots} label="Open slots" warn={stats.openSlots > 0} />
        <StatCard n={stats.pending} label="Opt-ins to confirm" warn={stats.pending > 0} />
      </div>

      <Tabs
        tabs={[
          { id: 'coverage', label: 'By activity' },
          { id: 'people', label: 'By person' },
        ]}
        value={view}
        onChange={setView}
      />

      {!acts ? (
        <Spinner />
      ) : view === 'coverage' ? (
        acts.length === 0 ? (
          <Empty>No activities in this period.</Empty>
        ) : (
          <div className="space-y-3">
            {acts.map((a) => {
              const at = L.activityTypeById.get(a.activity_type_id);
              return (
                <Card key={a.id} className={`border-l-4 ${color(at?.color).border}`}>
                  <Link to={`/activities/${a.id}`} className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{a.title}</div>
                      <div className="text-xs text-stone-500">
                        {fmtDate(a.start_date)}
                        {a.city && ` · ${a.city}`}
                      </div>
                    </div>
                    <Badge c={at?.color}>{at?.name}</Badge>
                  </Link>
                  <div className="mt-2 space-y-1 text-sm">
                    {L.rolesForType(a.activity_type_id).map((r) => {
                      const list = asg.filter((x) => x.activity_id === a.id && x.role_id === r.id);
                      const short = r.default_capacity != null && list.length < r.default_capacity;
                      return (
                        <div key={r.id} className="flex gap-2">
                          <span className={`w-28 shrink-0 text-xs font-medium ${short ? 'text-amber-700' : 'text-stone-500'}`}>
                            {r.name} {r.default_capacity != null && `(${list.length}/${r.default_capacity})`}
                          </span>
                          <span className="text-xs">
                            {list.length
                              ? list.map((x, i) => (
                                  <span key={x.id}>
                                    {i > 0 && ', '}
                                    <Link to={`/people/${x.person_id}`} className={x.status === 'opted_in' ? 'italic text-amber-700' : ''}>
                                      {x.people.full_name}
                                    </Link>
                                  </span>
                                ))
                              : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : byPerson.length === 0 ? (
        <Empty>No one is scheduled in this period.</Empty>
      ) : (
        <div className="space-y-2">
          {byPerson.map(([pid, e]) => (
            <Card key={pid}>
              <div className="flex items-center justify-between">
                <Link to={`/people/${pid}`} className="font-semibold hover:text-orange-800">
                  {e.name}
                </Link>
                <Badge c="orange">{e.items.length}</Badge>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                {e.items.map((it, i) => (
                  <li key={i}>
                    {fmtDate(it.a.start_date)} · {it.a.title} · {it.role}
                    {it.status === 'opted_in' && <span className="text-amber-700"> (opted in)</span>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

const StatCard = ({ n, label, warn }: { n: number | string; label: string; warn?: boolean }) => (
  <Card className="!p-3">
    <div className={`text-2xl font-bold ${warn ? 'text-amber-700' : ''}`}>{n}</div>
    <div className="text-xs text-stone-500">{label}</div>
  </Card>
);

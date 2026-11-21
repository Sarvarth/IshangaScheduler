import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT, addMonthsISO, errMsg, fmtDate, todayISO } from '../lib/format';
import type { Activity, Assignment } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import ActivityForm from '../components/ActivityForm';
import { Badge, Button, Card, Empty, PageHeader, Select, Spinner, useToast } from '../components/ui';

type Signup = Pick<Assignment, 'activity_id' | 'person_id' | 'role_id' | 'status'>;

export default function Satsang() {
  const { can } = useAuth();
  const { activityTypes } = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const satsangType = activityTypes.find((type) => type.name.toLowerCase() === 'satsang');
  const [events, setEvents] = useState<Activity[] | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [center, setCenter] = useState('all');
  const [adding, setAdding] = useState(false);
  const manage = can('manage_activities');

  const load = async () => {
    if (!satsangType) {
      setEvents([]);
      setSignups([]);
      return;
    }
    setEvents(null);
    const today = todayISO();
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('activity_type_id', satsangType.id)
      .gte('start_date', today)
      .lte('start_date', addMonthsISO(today, 3))
      .neq('status', 'cancelled')
      .order('start_date')
      .order('center');
    if (error) {
      toast(errMsg(error), true);
      setEvents([]);
      return;
    }
    const list = (data ?? []) as Activity[];
    setEvents(list);
    if (!list.length) {
      setSignups([]);
      return;
    }
    const { data: assignments, error: assignmentError } = await supabase
      .from('assignments')
      .select('activity_id, person_id, role_id, status')
      .in('activity_id', list.map((event) => event.id))
      .in('status', ACTIVE_ASSIGNMENT);
    if (assignmentError) toast(errMsg(assignmentError), true);
    setSignups((assignments ?? []) as Signup[]);
  };

  useEffect(() => {
    load();
  }, [satsangType?.id]);

  const centers = useMemo(() => [...new Set((events ?? []).map((event) => event.center).filter((value): value is string => !!value))].sort(), [events]);
  const filtered = (events ?? []).filter((event) => center === 'all' || event.center === center);

  const setVisibility = async (event: Activity) => {
    const show = !event.is_visible;
    const { error } = await supabase
      .from('activities')
      .update({ is_visible: show, visible_from: show ? todayISO() : null })
      .eq('id', event.id);
    if (error) return toast(errMsg(error), true);
    toast(show ? 'Satsang event shown' : 'Satsang event hidden');
    load();
  };

  return (
    <>
      <PageHeader
        title="Satsang"
        subtitle="Monthly Satsang · first Sunday"
        actions={manage && <Button onClick={() => setAdding(true)}>+ Create Satsang</Button>}
      />
      <div className="mb-4 max-w-xs">
        <Select aria-label="Filter Satsang by center" value={center} onChange={(event) => setCenter(event.target.value)}>
          <option value="all">All centers</option>
          {centers.map((name) => <option key={name} value={name}>{name}</option>)}
        </Select>
      </div>
      {!events ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Empty>No upcoming Satsangs in the next three months.</Empty>
      ) : (
        <section>
          <h2 className="mb-3 font-semibold">Upcoming · next 3 months</h2>
          <div className="space-y-3">
            {filtered.map((event) => {
              const count = signups.filter((signup) => signup.activity_id === event.id && (signup.status === 'opted_in' || signup.status === 'confirmed')).length;
              const scheduled = event.visible_from && event.visible_from > todayISO();
              return (
                <Card key={event.id} className="flex flex-wrap items-center justify-between gap-3">
                  <Link to={`/activities/${event.id}`} className="min-w-0 flex-1">
                    <div className="font-semibold">{event.center ? `${event.center} Satsang` : 'Satsang'}</div>
                    <div className="text-sm text-stone-600">
                      {fmtDate(event.start_date)}{event.start_time && ` · ${event.start_time.slice(0, 5)}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge c={event.is_visible ? scheduled ? 'amber' : 'emerald' : 'stone'}>
                        {!event.is_visible ? 'Hidden' : scheduled ? `Shows ${fmtDate(event.visible_from)}` : 'Visible'}
                      </Badge>
                      <Badge c="sky">{count} opted in</Badge>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => nav(`/activities/${event.id}`)}>
                      View &amp; opt in
                    </Button>
                    {manage && (
                      <Button size="sm" variant="ghost" onClick={() => setVisibility(event)}>
                        {event.is_visible ? 'Hide' : 'Show now'}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
      {adding && satsangType && (
        <ActivityForm open defaultTypeId={satsangType.id} onClose={() => setAdding(false)} onSaved={() => load()} />
      )}
    </>
  );
}
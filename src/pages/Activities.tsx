import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT, ACTIVITY_STATUS, color, fmtRange, todayISO } from '../lib/format';
import type { Activity, Assignment } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import ActivityForm from '../components/ActivityForm';
import { Badge, Button, Card, ChipSelect, Empty, PageHeader, Spinner, Tabs } from '../components/ui';

type Tab = 'upcoming' | 'past';

export default function Activities() {
  const { can, profile } = useAuth();
  const { activityTypes, activityTypeById, rolesForType } = useLookups();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [items, setItems] = useState<Activity[] | null>(null);
  const [asg, setAsg] = useState<Pick<Assignment, 'activity_id' | 'person_id' | 'role_id' | 'status'>[]>([]);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setItems(null);
    const today = todayISO();
    let q = supabase.from('activities').select('*');
    q = tab === 'upcoming' ? q.gte('start_date', today).order('start_date') : q.lt('start_date', today).order('start_date', { ascending: false }).limit(200);
    if (typeFilter.length) q = q.in('activity_type_id', typeFilter);
    const { data } = await q;
    const list = (data ?? []) as Activity[];
    setItems(list);
    if (list.length) {
      const { data: a } = await supabase
        .from('assignments')
        .select('activity_id, person_id, role_id, status')
        .in('activity_id', list.map((x) => x.id))
        .in('status', ACTIVE_ASSIGNMENT);
      setAsg((a ?? []) as typeof asg);
    } else setAsg([]);
  };

  useEffect(() => {
    load();
  }, [tab, typeFilter]);

  return (
    <>
      <PageHeader title="Activities" actions={can('manage_activities') && <Button onClick={() => setAdding(true)}>+ New</Button>} />
      <Tabs
        tabs={[
          { id: 'upcoming', label: 'Upcoming' },
          { id: 'past', label: 'Past' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mb-4">
        <ChipSelect options={activityTypes} value={typeFilter} onChange={setTypeFilter} />
      </div>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>No activities.</Empty>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const at = activityTypeById.get(a.activity_type_id);
            const mine = asg.filter((x) => x.activity_id === a.id);
            const roles = rolesForType(a.activity_type_id);
            const st = ACTIVITY_STATUS[a.status];
            const isMine = profile?.person_id && mine.some((x) => x.person_id === profile.person_id);
            return (
              <Card key={a.id} onClick={() => nav(`/activities/${a.id}`)} className={`border-l-4 ${color(at?.color).border}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-stone-500">
                      {fmtRange(a.start_date, a.end_date)}
                      {a.start_time && ` · ${a.start_time.slice(0, 5)}`}
                      {a.city && ` · ${a.city}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge c={at?.color}>{at?.name}</Badge>
                    {a.status !== 'planned' && <Badge c={st.color}>{st.label}</Badge>}
                    {isMine && <Badge c="emerald">You're in</Badge>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600">
                  {roles.map((r) => {
                    const n = mine.filter((x) => x.role_id === r.id).length;
                    const full = r.default_capacity != null && n >= r.default_capacity;
                    return (
                      <span key={r.id} className={full ? 'text-emerald-700' : r.default_capacity != null && n < r.default_capacity ? 'text-amber-700' : ''}>
                        {r.name}: {n}
                        {r.default_capacity != null && `/${r.default_capacity}`}
                      </span>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {adding && (
        <ActivityForm
          open
          defaultTypeId={typeFilter[0]}
          onClose={() => setAdding(false)}
          onSaved={(id) => (id ? nav(`/activities/${id}`) : load())}
        />
      )}
    </>
  );
}

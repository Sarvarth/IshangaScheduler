import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ASSIGNMENT_STATUS, CANDIDATE_RESULT, color, errMsg, fmtDate, todayISO } from '../lib/format';
import type { Activity, Assignment, Candidate, PersonWithTags } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import PersonForm from '../components/PersonForm';
import { Badge, Button, Card, Empty, PageHeader, Spinner, useToast } from '../components/ui';

type Row = Assignment & { activities: Activity };

export default function PersonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { typeById, attributeById, activityTypeById, roleById } = useLookups();
  const [person, setPerson] = useState<PersonWithTags | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    const [p, a, c] = await Promise.all([
      supabase.from('people').select('*, person_types(type_id), person_attributes(attribute_id)').eq('id', id!).maybeSingle(),
      supabase.from('assignments').select('*, activities(*)').eq('person_id', id!),
      supabase.from('candidates').select('*').eq('person_id', id!).order('created_at', { ascending: false }),
    ]);
    setPerson(p.data as PersonWithTags | null);
    setRows(((a.data ?? []) as Row[]).sort((x, y) => y.activities.start_date.localeCompare(x.activities.start_date)));
    setCands((c.data ?? []) as Candidate[]);
  };

  useEffect(() => {
    load();
  }, [id]);

  const remove = async () => {
    if (!confirm('Delete this person and all their activity history?')) return;
    const { error } = await supabase.from('people').delete().eq('id', id!);
    if (error) return toast(errMsg(error), true);
    toast('Deleted');
    nav('/people');
  };

  if (person === undefined) return <Spinner />;
  if (!person) return <Empty>Person not found.</Empty>;

  const today = todayISO();
  const upcoming = rows.filter((r) => r.activities.start_date >= today);
  const past = rows.filter((r) => r.activities.start_date < today);

  const renderRow = (r: Row) => {
    const at = activityTypeById.get(r.activities.activity_type_id);
    const st = ASSIGNMENT_STATUS[r.status];
    return (
      <Link key={r.id} to={`/activities/${r.activity_id}`} className={`block rounded-lg border border-l-4 border-stone-200 bg-white p-3 ${color(at?.color).border}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{r.activities.title}</div>
            <div className="text-xs text-stone-500">
              {fmtDate(r.activities.start_date)} · {at?.name} · {roleById.get(r.role_id)?.name}
            </div>
          </div>
          <Badge c={st.color}>{st.label}</Badge>
        </div>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title={person.full_name}
        subtitle={[person.city, person.center, person.region].filter(Boolean).join(' · ')}
        actions={
          can('manage_people') && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="danger" onClick={remove}>
                Delete
              </Button>
            </>
          )
        }
      />
      <Card className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-1">
          {!person.is_active && <Badge c="stone">Inactive</Badge>}
          {person.person_types.map((t) => (
            <Badge key={t.type_id} c="orange">
              {typeById.get(t.type_id)?.name}
            </Badge>
          ))}
          {person.person_types.length === 0 && <Badge c="stone">Volunteer</Badge>}
          {person.person_attributes.map((a) => (
            <Badge key={a.attribute_id} c="indigo">
              {attributeById.get(a.attribute_id)?.name}
            </Badge>
          ))}
        </div>
        <div className="grid gap-1 text-sm">
          {person.phone && (
            <a className="text-orange-800" href={`tel:${person.phone}`}>
              📞 {person.phone}
            </a>
          )}
          {person.email && (
            <a className="text-orange-800" href={`mailto:${person.email}`}>
              ✉️ {person.email}
            </a>
          )}
          {person.notes && <p className="whitespace-pre-wrap text-stone-600">{person.notes}</p>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat n={upcoming.length} label="Upcoming" />
          <Stat n={past.length} label="Past" />
          <Stat n={rows.length} label="Total" />
        </div>
      </Card>

      <h2 className="mb-2 font-semibold">Upcoming</h2>
      <div className="mb-6 space-y-2">{upcoming.length ? upcoming.map(renderRow) : <Empty>Nothing scheduled.</Empty>}</div>

      <h2 className="mb-2 font-semibold">History</h2>
      <div className="mb-6 space-y-2">{past.length ? past.map(renderRow) : <Empty>No past activities.</Empty>}</div>

      {cands.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Training interviews</h2>
          <div className="space-y-2">
            {cands.map((c) => (
              <Card key={c.id} className="flex items-center justify-between">
                <div className="text-sm">
                  {typeById.get(c.target_type_id)?.name} training
                  {c.activity_id && (
                    <Link className="ml-2 text-orange-800" to={`/activities/${c.activity_id}`}>
                      view interview
                    </Link>
                  )}
                </div>
                <Badge c={CANDIDATE_RESULT[c.result].color}>{CANDIDATE_RESULT[c.result].label}</Badge>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing && <PersonForm open person={person} onClose={() => setEditing(false)} onSaved={load} />}
    </>
  );
}

const Stat = ({ n, label }: { n: number; label: string }) => (
  <div className="rounded-lg bg-stone-100 p-2">
    <div className="text-xl font-bold">{n}</div>
    <div className="text-xs text-stone-500">{label}</div>
  </div>
);

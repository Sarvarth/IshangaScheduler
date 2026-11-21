import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT, ACTIVITY_STATUS, ASSIGNMENT_STATUS, CANDIDATE_RESULT, color, errMsg, fmtRange, todayISO } from '../lib/format';
import type { Activity, ActivityRole, ActivityStatus, Assignment, AssignmentStatus, Candidate, CandidateResult, PersonWithTags } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import ActivityForm from '../components/ActivityForm';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui';

type Asg = Assignment & { people: { full_name: string; phone: string | null } };

export default function ActivityDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can, profile } = useAuth();
  const L = useLookups();
  const [activity, setActivity] = useState<Activity | null | undefined>(undefined);
  const [asg, setAsg] = useState<Asg[]>([]);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [myTypes, setMyTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [assignRole, setAssignRole] = useState<ActivityRole | null>(null);
  const [candEdit, setCandEdit] = useState<Candidate | 'new' | null>(null);

  const manage = can('manage_activities');

  const load = async () => {
    const [a, s, c] = await Promise.all([
      supabase.from('activities').select('*').eq('id', id!).maybeSingle(),
      supabase.from('assignments').select('*, people(full_name, phone)').eq('activity_id', id!).order('created_at'),
      supabase.from('candidates').select('*').eq('activity_id', id!).order('created_at'),
    ]);
    setActivity(a.data as Activity | null);
    setAsg((s.data ?? []) as Asg[]);
    setCands((c.data ?? []) as Candidate[]);
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!profile?.person_id) return;
    supabase
      .from('person_types')
      .select('type_id')
      .eq('person_id', profile.person_id)
      .then(({ data }) => setMyTypes((data ?? []).map((x) => x.type_id as string)));
  }, [profile?.person_id]);

  if (activity === undefined || !L.loaded) return <Spinner />;
  if (!activity) return <Empty>Activity not found.</Empty>;

  const at = L.activityTypeById.get(activity.activity_type_id);
  const roles = L.rolesForType(activity.activity_type_id);
  const visibilityReleased = activity.is_visible && (!activity.visible_from || activity.visible_from <= todayISO());
  const openForOptIn = visibilityReleased && activity.opt_in_open && (activity.status === 'planned' || activity.status === 'confirmed');

  const run = async (p: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await p;
    if (error) return toast(errMsg(error), true);
    toast(ok);
    load();
  };

  const optIn = (role: ActivityRole) =>
    run(supabase.from('assignments').insert({ activity_id: activity.id, person_id: profile!.person_id, role_id: role.id, status: 'opted_in' }), `Opted in as ${role.name}`);

  const setStatus = (a: Asg, status: AssignmentStatus) => run(supabase.from('assignments').update({ status }).eq('id', a.id), 'Updated');

  const removeAsg = (a: Asg) => {
    if (confirm(`Remove ${a.people.full_name}?`)) run(supabase.from('assignments').delete().eq('id', a.id), 'Removed');
  };

  const setActivityStatus = (status: ActivityStatus) => run(supabase.from('activities').update({ status }).eq('id', activity.id), 'Status updated');

  const removeActivity = async () => {
    if (!confirm('Delete this activity and all its assignments?')) return;
    const { error } = await supabase.from('activities').delete().eq('id', activity.id);
    if (error) return toast(errMsg(error), true);
    toast('Deleted');
    nav('/activities');
  };

  const share = async () => {
    const lines = [
      `*${activity.title}* (${at?.name})`,
      fmtRange(activity.start_date, activity.end_date) + (activity.start_time ? ` · ${activity.start_time.slice(0, 5)}` : ''),
      [activity.center, activity.location, activity.city].filter(Boolean).join(', '),
      '',
      ...roles.flatMap((r) => {
        const list = asg.filter((a) => a.role_id === r.id && ACTIVE_ASSIGNMENT.includes(a.status));
        return [`_${r.name}_: ${list.length ? list.map((a) => a.people.full_name).join(', ') : '—'}`];
      }),
    ].filter((l, i) => l || i === 3);
    const text = lines.join('\n');
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  };

  return (
    <>
      <PageHeader
        title={activity.title}
        subtitle={`${fmtRange(activity.start_date, activity.end_date)}${activity.start_time ? ' · ' + activity.start_time.slice(0, 5) : ''}${activity.center ? ' · ' + activity.center : ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={share}>
              Share
            </Button>
            {manage && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={removeActivity}>
                  Delete
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className={`mb-4 space-y-2 border-l-4 ${color(at?.color).border}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge c={at?.color}>{at?.name}</Badge>
          <Badge c={ACTIVITY_STATUS[activity.status].color}>{ACTIVITY_STATUS[activity.status].label}</Badge>
          <Badge c={activity.opt_in_open ? 'emerald' : 'stone'}>{activity.opt_in_open ? 'Opt-in open' : 'Opt-in closed'}</Badge>
        </div>
        {(activity.center || activity.location || activity.city) && <div className="text-sm">📍 {[activity.center, activity.location, activity.city, activity.region].filter(Boolean).join(', ')}</div>}
        {activity.notes && <p className="whitespace-pre-wrap text-sm text-stone-600">{activity.notes}</p>}
        {manage && (
          <Field label="Activity status">
            <Select value={activity.status} onChange={(e) => setActivityStatus(e.target.value as ActivityStatus)}>
              {Object.entries(ACTIVITY_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      <div className="space-y-4">
        {roles.length === 0 && <Empty>No roles defined for this activity type. Add roles in Settings.</Empty>}
        {roles.map((r) => {
          const list = asg.filter((a) => a.role_id === r.id);
          const activeCount = list.filter((a) => ACTIVE_ASSIGNMENT.includes(a.status)).length;
          const elig = L.eligibleTypeIds(r.id).map((t) => L.typeById.get(t)?.name).filter(Boolean);
          const alreadyIn = !!profile?.person_id && list.some((a) => a.person_id === profile.person_id);
          const canOptIn =
            can('opt_in') && !!profile?.person_id && openForOptIn && r.allow_self_opt_in && !alreadyIn && L.isEligible(myTypes, r.id);
          return (
            <Card key={r.id}>
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {r.name}{' '}
                    <span className="text-sm font-normal text-stone-500">
                      {activeCount}
                      {r.default_capacity != null && ` / ${r.default_capacity}`}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500">{elig.length ? `Eligible: ${elig.join(', ')}` : 'Open to everyone'}</div>
                </div>
                <div className="flex gap-2">
                  {canOptIn && (
                    <Button size="sm" onClick={() => optIn(r)}>
                      Opt in
                    </Button>
                  )}
                  {manage && (
                    <Button size="sm" variant="secondary" onClick={() => setAssignRole(r)}>
                      + Assign
                    </Button>
                  )}
                </div>
              </div>
              {list.length === 0 ? (
                <div className="text-sm text-stone-400">No one yet.</div>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {list.map((a) => {
                    const st = ASSIGNMENT_STATUS[a.status];
                    const isMe = a.person_id === profile?.person_id;
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <Link to={`/people/${a.person_id}`} className="font-medium hover:text-orange-800">
                            {a.people.full_name}
                          </Link>
                          {a.people.phone && (
                            <a href={`tel:${a.people.phone}`} className="ml-2 text-xs text-stone-500">
                              {a.people.phone}
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {manage ? (
                            <Select className="!w-auto !py-1 text-xs" value={a.status} onChange={(e) => setStatus(a, e.target.value as AssignmentStatus)}>
                              {Object.entries(ASSIGNMENT_STATUS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Badge c={st.color}>{st.label}</Badge>
                          )}
                          {(manage || (isMe && a.status === 'opted_in')) && (
                            <Button size="sm" variant="ghost" onClick={() => removeAsg(a)}>
                              {manage ? 'Remove' : 'Withdraw'}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}

        {at?.has_candidates && (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Candidates</div>
              {manage && (
                <Button size="sm" variant="secondary" onClick={() => setCandEdit('new')}>
                  + Add candidate
                </Button>
              )}
            </div>
            {cands.length === 0 ? (
              <div className="text-sm text-stone-400">No candidates yet.</div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {cands.map((c) => (
                  <li key={c.id} className={`flex items-center justify-between gap-2 py-2 ${manage ? 'cursor-pointer' : ''}`} onClick={() => manage && setCandEdit(c)}>
                    <div>
                      <div className="font-medium">{c.full_name}</div>
                      <div className="text-xs text-stone-500">
                        For {L.typeById.get(c.target_type_id)?.name} training{c.phone && ` · ${c.phone}`}
                      </div>
                    </div>
                    <Badge c={CANDIDATE_RESULT[c.result].color}>{CANDIDATE_RESULT[c.result].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {editing && <ActivityForm open activity={activity} onClose={() => setEditing(false)} onSaved={load} />}
      {assignRole && (
        <AssignModal activity={activity} role={assignRole} existing={asg.filter((a) => a.role_id === assignRole.id).map((a) => a.person_id)} onClose={() => setAssignRole(null)} onDone={load} />
      )}
      {candEdit && <CandidateModal activityId={activity.id} candidate={candEdit === 'new' ? null : candEdit} onClose={() => setCandEdit(null)} onDone={load} />}
    </>
  );
}

function AssignModal({
  activity,
  role,
  existing,
  onClose,
  onDone,
}: {
  activity: Activity;
  role: ActivityRole;
  existing: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const L = useLookups();
  const toast = useToast();
  const [people, setPeople] = useState<PersonWithTags[] | null>(null);
  const [busyOn, setBusyOn] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AssignmentStatus>('confirmed');

  useEffect(() => {
    (async () => {
      const [p, b] = await Promise.all([
        supabase.from('people').select('*, person_types(type_id), person_attributes(attribute_id)').eq('is_active', true).order('full_name'),
        supabase
          .from('assignments')
          .select('person_id, activities!inner(id, title, start_date)')
          .eq('activities.start_date', activity.start_date)
          .in('status', ACTIVE_ASSIGNMENT),
      ]);
      setPeople((p.data ?? []) as PersonWithTags[]);
      const m = new Map<string, string>();
      for (const r of (b.data ?? []) as unknown as { person_id: string; activities: { id: string; title: string } }[]) {
        if (r.activities.id !== activity.id) m.set(r.person_id, r.activities.title);
      }
      setBusyOn(m);
    })();
  }, [activity]);

  const eligible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (people ?? []).filter(
      (p) =>
        !existing.includes(p.id) &&
        L.isEligible(
          p.person_types.map((t) => t.type_id),
          role.id,
        ) &&
        (!term || p.full_name.toLowerCase().includes(term) || p.city?.toLowerCase().includes(term)),
    );
  }, [people, q, existing, role.id, L]);

  const assign = async (p: PersonWithTags) => {
    const { error } = await supabase.from('assignments').insert({ activity_id: activity.id, person_id: p.id, role_id: role.id, status });
    if (error) return toast(errMsg(error), true);
    toast(`${p.full_name} assigned`);
    onDone();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Assign ${role.name}`}>
      <div className="flex gap-2">
        <Input placeholder="Search eligible people…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Select className="!w-36 shrink-0" value={status} onChange={(e) => setStatus(e.target.value as AssignmentStatus)}>
          <option value="confirmed">Confirmed</option>
          <option value="opted_in">Opted in</option>
        </Select>
      </div>
      {!people ? (
        <Spinner />
      ) : eligible.length === 0 ? (
        <Empty>No eligible people found.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {eligible.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:bg-stone-50" onClick={() => assign(p)}>
                <div>
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-xs text-stone-500">
                    {p.person_types.map((t) => L.typeById.get(t.type_id)?.name).join(', ') || 'Volunteer'}
                    {p.city && ` · ${p.city}`}
                  </div>
                </div>
                {busyOn.has(p.id) && <Badge c="amber">Busy: {busyOn.get(p.id)}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function CandidateModal({ activityId, candidate, onClose, onDone }: { activityId: string; candidate: Candidate | null; onClose: () => void; onDone: () => void }) {
  const L = useLookups();
  const toast = useToast();
  const [people, setPeople] = useState<PersonWithTags[]>([]);
  const [f, setF] = useState({
    person_id: candidate?.person_id ?? '',
    full_name: candidate?.full_name ?? '',
    phone: candidate?.phone ?? '',
    email: candidate?.email ?? '',
    city: candidate?.city ?? '',
    target_type_id: candidate?.target_type_id ?? L.ishangaTypes[0]?.id ?? '',
    result: (candidate?.result ?? 'pending') as CandidateResult,
    notes: candidate?.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    supabase
      .from('people')
      .select('*, person_types(type_id), person_attributes(attribute_id)')
      .order('full_name')
      .then(({ data }) => setPeople((data ?? []) as PersonWithTags[]));
  }, []);

  const target = L.typeById.get(f.target_type_id);
  const prereq = target?.prerequisite_type_id ? L.typeById.get(target.prerequisite_type_id) : null;
  const linked = people.find((p) => p.id === f.person_id);
  const prereqOk = !prereq || !!linked?.person_types.some((t) => t.type_id === prereq.id);

  const pickPerson = (pid: string) => {
    const p = people.find((x) => x.id === pid);
    setF((s) => ({ ...s, person_id: pid, full_name: p?.full_name ?? s.full_name, phone: p?.phone ?? s.phone, email: p?.email ?? s.email, city: p?.city ?? s.city }));
  };

  const save = async () => {
    if (!f.full_name.trim()) return toast('Name is required', true);
    const row = {
      activity_id: activityId,
      person_id: f.person_id || null,
      full_name: f.full_name.trim(),
      phone: f.phone || null,
      email: f.email || null,
      city: f.city || null,
      target_type_id: f.target_type_id,
      result: f.result,
      notes: f.notes || null,
    };
    const { error } = candidate ? await supabase.from('candidates').update(row).eq('id', candidate.id) : await supabase.from('candidates').insert(row);
    if (error) return toast(errMsg(error), true);
    toast('Saved');
    onDone();
    onClose();
  };

  const del = async () => {
    if (!candidate || !confirm('Delete candidate?')) return;
    const { error } = await supabase.from('candidates').delete().eq('id', candidate.id);
    if (error) return toast(errMsg(error), true);
    onDone();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={candidate ? 'Edit candidate' : 'Add candidate'}
      footer={
        <>
          {candidate && (
            <Button variant="danger" className="mr-auto" onClick={del}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!prereqOk}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Interviewing for">
        <Select value={f.target_type_id} onChange={(e) => set('target_type_id', e.target.value)}>
          {L.ishangaTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} training
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Existing person (optional)" hint={prereq ? `Must be an existing ${prereq.name}.` : 'Active volunteers can be added directly by name.'}>
        <Select value={f.person_id} onChange={(e) => pickPerson(e.target.value)}>
          <option value="">— Not in the system —</option>
          {people
            .filter((p) => !prereq || p.person_types.some((t) => t.type_id === prereq.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
        </Select>
      </Field>
      {!prereqOk && <p className="text-sm text-rose-600">Select an existing {prereq?.name} for this training.</p>}
      <Field label="Name *">
        <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
      </div>
      <Field label="Result">
        <Select value={f.result} onChange={(e) => set('result', e.target.value)}>
          {Object.entries(CANDIDATE_RESULT).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  );
}

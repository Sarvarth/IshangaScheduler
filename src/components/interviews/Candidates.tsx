import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { CANDIDATE_RESULT, calendarLabel, errMsg, safeUrl } from '../../lib/format';
import { whatsappUrl } from '../../lib/calendar';
import { csvObjects, downloadText } from '../../lib/csv';
import { addDays, fmtSlot, label12, TIME_OPTIONS, toTs, todayIST } from '../../lib/time';
import type { Availability, Booking, Candidate, CandidateResult, PersonWithTags } from '../../lib/types';
import { useLookups } from '../../context/LookupContext';
import { Badge, Button, Card, Checkbox, Empty, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '../ui';
import { CancelModal, OutcomeModal } from './MyInterviews';

type B = Booking & { people: { full_name: string; phone: string | null } };
type Stage = 'shortlist' | 'noslots' | 'send' | 'waiting' | 'attention' | 'booked' | 'outcome' | 'done';
type Group = 'todo' | 'waiting' | 'booked' | 'done' | 'all';

const STAGE: Record<Stage, { label: string; color: string; group: Group }> = {
  shortlist: { label: 'Choose interviewers', color: 'amber', group: 'todo' },
  noslots: { label: 'Interviewers have no free time', color: 'rose', group: 'todo' },
  send: { label: 'Send booking link', color: 'amber', group: 'todo' },
  attention: { label: 'Needs your help', color: 'rose', group: 'todo' },
  outcome: { label: 'Record result', color: 'amber', group: 'todo' },
  waiting: { label: 'Waiting for candidate', color: 'sky', group: 'waiting' },
  booked: { label: 'Interview booked', color: 'emerald', group: 'booked' },
  done: { label: 'Done', color: 'stone', group: 'done' },
};

const last10 = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10);
const bookingUrl = (c: Candidate) => `${window.location.origin}/book/${c.booking_token}`;

export default function CandidatesTab() {
  const L = useLookups();
  const toast = useToast();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [bookings, setBookings] = useState<B[]>([]);
  const [shortlist, setShortlist] = useState<{ candidate_id: string; person_id: string }[]>([]);
  const [people, setPeople] = useState<PersonWithTags[]>([]);
  const [avail, setAvail] = useState<Availability[]>([]);
  const [group, setGroup] = useState<Group>('todo');
  const [region, setRegion] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [bulkPick, setBulkPick] = useState(false);

  const load = async () => {
    const now = new Date();
    const [c, b, s, p, a] = await Promise.all([
      supabase.from('candidates').select('*').order('created_at', { ascending: false }),
      supabase.from('interview_bookings').select('*, people(full_name, phone)').order('created_at', { ascending: false }),
      supabase.from('candidate_shortlist').select('candidate_id, person_id'),
      supabase.from('people').select('*, person_types(type_id), person_attributes(attribute_id)').eq('is_active', true).order('full_name'),
      supabase
        .from('interviewer_availability')
        .select('*')
        .gt('ends_at', now.toISOString())
        .lt('starts_at', new Date(+now + 21 * 864e5).toISOString()),
    ]);
    setCands((c.data ?? []) as Candidate[]);
    setBookings((b.data ?? []) as B[]);
    setShortlist((s.data ?? []) as typeof shortlist);
    setPeople((p.data ?? []) as PersonWithTags[]);
    setAvail((a.data ?? []) as Availability[]);
  };
  useEffect(() => {
    load();
  }, []);

  // Free 30-min slots per person, excluding already-booked times
  const freeByPerson = useMemo(() => {
    const earliest = Date.now();
    const m = new Map<string, string[]>();
    for (const a of avail) {
      const busy = bookings.filter((b) => b.person_id === a.person_id && (b.status === 'booked' || (b.status === 'cancelled' && b.cancelled_by === 'interviewer')));
      for (let t = +new Date(a.starts_at); t + 1800e3 <= +new Date(a.ends_at); t += 1800e3) {
        if (t < earliest) continue;
        if (busy.some((b) => +new Date(b.starts_at) < t + 1800e3 && +new Date(b.ends_at) > t)) continue;
        m.set(a.person_id, [...(m.get(a.person_id) ?? []), new Date(t).toISOString()]);
      }
    }
    return m;
  }, [avail, bookings]);

  const upcomingCount = useMemo(() => {
    const m = new Map<string, number>();
    const now = new Date();
    for (const b of bookings) if (b.status === 'booked' && new Date(b.starts_at) > now) m.set(b.person_id, (m.get(b.person_id) ?? 0) + 1);
    return m;
  }, [bookings]);

  const info = useMemo(() => {
    const now = new Date();
    return new Map(
      (cands ?? []).map((c) => {
        const bs = bookings.filter((b) => b.candidate_id === c.id);
        const active = bs.find((b) => b.status === 'booked');
        const latest = bs[0];
        const sl = shortlist.filter((s) => s.candidate_id === c.id).map((s) => s.person_id);
        const free = new Set(sl.flatMap((p) => freeByPerson.get(p) ?? [])).size;
        let stage: Stage;
        let note = '';
        if (c.result !== 'pending') stage = 'done';
        else if (active) stage = new Date(active.ends_at) < now ? 'outcome' : 'booked';
        else if (latest && (latest.status === 'completed' || latest.status === 'no_show')) stage = 'outcome';
        else if (latest?.status === 'cancelled' && latest.cancelled_by === 'interviewer') {
          stage = 'attention';
          note = `Interviewer cancelled: ${latest.cancelled_reason ?? ''}`;
        } else if (c.requested_times) {
          stage = 'attention';
          note = `Asked for other times: “${c.requested_times}”`;
        } else if (!sl.length) stage = 'shortlist';
        else if (!free) stage = 'noslots';
        else if (!c.link_sent_at) stage = 'send';
        else stage = 'waiting';
        return [c.id, { stage, note, active, bookings: bs, shortlist: sl, free }];
      }),
    );
  }, [cands, bookings, shortlist, freeByPerson]);

  const regions = useMemo(() => [...new Set((cands ?? []).map((c) => c.region).filter(Boolean) as string[])].sort(), [cands]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (cands ?? []).filter((c) => {
      const i = info.get(c.id)!;
      if (group !== 'all' && STAGE[i.stage].group !== group) return false;
      if (region && c.region !== region) return false;
      if (term && ![c.full_name, c.phone, c.city, c.region, c.language].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [cands, info, group, region, q]);

  const counts = useMemo(() => {
    const m: Record<Group, number> = { todo: 0, waiting: 0, booked: 0, done: 0, all: cands?.length ?? 0 };
    for (const i of info.values()) m[STAGE[i.stage].group]++;
    return m;
  }, [info, cands]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const copyLinks = async () => {
    const chosen = (cands ?? []).filter((c) => selected.has(c.id));
    await navigator.clipboard.writeText(chosen.map((c) => `${c.full_name} – ${c.phone ?? ''} – ${bookingUrl(c)}`).join('\n'));
    await supabase.from('candidates').update({ link_sent_at: new Date().toISOString() }).in('id', [...selected]).is('link_sent_at', null);
    toast(`Copied ${chosen.length} links`);
    load();
  };

  const bulkShortlist = async (ids: string[]) => {
    const rows = [...selected].flatMap((cid) => ids.map((pid) => ({ candidate_id: cid, person_id: pid })));
    const { error } = await supabase.from('candidate_shortlist').upsert(rows, { ignoreDuplicates: true });
    if (error) return toast(errMsg(error), true);
    toast('Interviewers added');
    setBulkPick(false);
    setSelected(new Set());
    load();
  };

  if (!cands) return <Spinner />;
  const open = openId ? cands.find((c) => c.id === openId) : null;
  const selCands = cands.filter((c) => selected.has(c.id));

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={() => setImporting(true)}>⬆ Upload CSV</Button>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Add candidate
        </Button>
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {(
          [
            ['todo', 'To do'],
            ['waiting', 'Waiting'],
            ['booked', 'Booked'],
            ['done', 'Done'],
            ['all', 'All'],
          ] as [Group, string][]
        ).map(([g, label]) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${group === g ? 'border-orange-700 bg-orange-700 text-white' : 'border-stone-300 bg-white'}`}
          >
            {label} <span className="opacity-70">({counts[g]})</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <Input placeholder="Search name, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} />
        {regions.length > 0 && (
          <Select className="!w-40 shrink-0" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        )}
      </div>

      {list.length === 0 ? (
        <Empty>{cands.length ? 'Nothing here.' : 'No candidates yet. Upload a CSV to get started.'}</Empty>
      ) : (
        <div className="space-y-2">
          {list.length > 1 && (
            <button className="text-xs text-orange-800" onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((c) => c.id)))}>
              {selected.size === list.length ? 'Unselect all' : 'Select all shown'}
            </button>
          )}
          {list.map((c) => {
            const i = info.get(c.id)!;
            const st = STAGE[i.stage];
            return (
              <Card key={c.id} className="flex gap-3 !p-3">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-orange-700" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{c.full_name}</div>
                      <div className="text-xs text-stone-500">
                        {[L.typeById.get(c.target_type_id)?.name, c.language, c.region || c.city].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Badge c={st.color}>{i.stage === 'done' ? CANDIDATE_RESULT[c.result].label : st.label}</Badge>
                  </div>
                  {i.active && (
                    <div className="mt-1 text-xs text-emerald-800">
                      🗓 {fmtSlot(i.active.starts_at)} with {i.active.people.full_name}{' '}
                      {i.active.acknowledged_at ? <span className="text-emerald-700">✓ confirmed</span> : <span className="text-amber-700">· not yet seen</span>}
                    </div>
                  )}
                  {i.note && <div className="mt-1 text-xs text-rose-700">{i.note}</div>}
                  {!i.active && i.shortlist.length > 0 && i.stage !== 'done' && (
                    <div className="mt-1 text-xs text-stone-500">
                      {i.shortlist.length} interviewer{i.shortlist.length > 1 ? 's' : ''} · {i.free} free slots
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-900 p-3 text-white shadow-xl md:bottom-4">
          <span className="text-sm">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setBulkPick(true)}>
              Choose interviewers
            </Button>
            <Button size="sm" variant="secondary" onClick={copyLinks}>
              Copy links
            </Button>
            <Button size="sm" variant="ghost" className="!text-white" onClick={() => setSelected(new Set())}>
              ✕
            </Button>
          </div>
        </div>
      )}

      {open && (
        <CandidateSheet
          c={open}
          info={info.get(open.id)!}
          people={people}
          freeByPerson={freeByPerson}
          upcomingCount={upcomingCount}
          onClose={() => setOpenId(null)}
          reload={load}
        />
      )}
      {bulkPick && (
        <InterviewerPicker
          title={`Interviewers for ${selected.size} candidate${selected.size > 1 ? 's' : ''}`}
          people={people}
          freeByPerson={freeByPerson}
          upcomingCount={upcomingCount}
          defaultRegion={selCands.every((c) => c.region === selCands[0]?.region) ? selCands[0]?.region ?? '' : ''}
          defaultLanguage={selCands.every((c) => c.language === selCands[0]?.language) ? selCands[0]?.language ?? '' : ''}
          exclude={[]}
          onClose={() => setBulkPick(false)}
          onPick={bulkShortlist}
        />
      )}
      {importing && <CsvImportModal existing={cands} people={people} onClose={() => setImporting(false)} onDone={load} />}
      {adding && <CandidateEditModal people={people} onClose={() => setAdding(false)} onSaved={load} />}
    </>
  );
}

// ------------------------------------------------------------------
type Info = { stage: Stage; note: string; active?: B; bookings: B[]; shortlist: string[]; free: number };

function CandidateSheet({
  c,
  info,
  people,
  freeByPerson,
  upcomingCount,
  onClose,
  reload,
}: {
  c: Candidate;
  info: Info;
  people: PersonWithTags[];
  freeByPerson: Map<string, string[]>;
  upcomingCount: Map<string, number>;
  onClose: () => void;
  reload: () => void;
}) {
  const L = useLookups();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [outcome, setOutcome] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const training = L.typeById.get(c.target_type_id)?.name ?? 'Ishanga';
  const personById = new Map(people.map((p) => [p.id, p]));
  const url = bookingUrl(c);
  const a = info.active;

  const run = async (p: PromiseLike<{ error: unknown }>, ok?: string) => {
    const { error } = await p;
    if (error) {
      toast(errMsg(error), true);
      return false;
    }
    if (ok) toast(ok);
    reload();
    return true;
  };

  const linkMsg = `Namaskaram ${c.full_name.split(' ')[0]} 🙏\n\nThank you for your interest in ${training} training. Please choose a convenient time for a short (30 min) interview using this link:\n\n${url}\n\nPlease read the guidelines on the page before booking.`;
  const notifyMsg = (b: B) =>
    `Namaskaram ${b.people.full_name.split(' ')[0]} 🙏\n\nAn interview has been booked with you:\n🗓 ${fmtSlot(b.starts_at)} (30 min)\n👤 ${c.full_name}\n📞 ${c.phone ?? '-'}\n📍 ${[c.city, c.region].filter(Boolean).join(', ') || '-'}\n🗣 ${c.language ?? '-'}\n🎓 ${training} training\n🎥 ${b.meeting_link ?? 'Add your Google Meet link in the app'}\n\nPlease confirm in the app (this sends the calendar invites): ${window.location.origin}/interviews`;

  const sendLink = () => {
    window.open(whatsappUrl(c.phone, linkMsg), '_blank');
    run(supabase.from('candidates').update({ link_sent_at: new Date().toISOString() }).eq('id', c.id));
  };

  return (
    <Modal open onClose={onClose} title={c.full_name}>
      {/* Details */}
      <section className="space-y-1 text-sm">
        <div className="flex flex-wrap gap-1">
          <Badge c="orange">{training} training</Badge>
          {c.language && <Badge c="indigo">{c.language}</Badge>}
          {(c.region || c.city) && <Badge c="stone">{[c.city, c.region].filter(Boolean).join(', ')}</Badge>}
          <Badge c={CANDIDATE_RESULT[c.result].color}>{CANDIDATE_RESULT[c.result].label}</Badge>
        </div>
        {c.phone && (
          <div className="flex gap-3 pt-1">
            <a className="text-orange-800" href={`tel:${c.phone}`}>
              📞 {c.phone}
            </a>
            {c.email && <span className="text-stone-500">{c.email}</span>}
          </div>
        )}
        {c.notes && <p className="whitespace-pre-wrap text-stone-600">{c.notes}</p>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit details / result
          </Button>
        </div>
      </section>

      {info.note && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{info.note}</div>}
      {c.requested_times && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm">
          <span>
            <b>Candidate's preferred times:</b> {c.requested_times}
          </span>
          <Button size="sm" variant="ghost" onClick={() => run(supabase.from('candidates').update({ requested_times: null, requested_at: null }).eq('id', c.id), 'Cleared')}>
            Clear
          </Button>
        </div>
      )}

      {/* Step 1 */}
      <Section n={1} title="Interviewers who can take this" done={info.shortlist.length > 0}>
        <div className="flex flex-wrap gap-2">
          {info.shortlist.map((pid) => {
            const p = personById.get(pid);
            return (
              <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-sm">
                {p?.full_name ?? 'Inactive'} <span className="text-xs text-stone-500">({freeByPerson.get(pid)?.length ?? 0} free)</span>
                <button
                  className="rounded-full px-1.5 hover:bg-stone-200"
                  onClick={() => run(supabase.from('candidate_shortlist').delete().eq('candidate_id', c.id).eq('person_id', pid))}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </span>
            );
          })}
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            + Add
          </Button>
        </div>
        {info.shortlist.length > 0 && <p className="mt-2 text-xs text-stone-500">{info.free} free 30-min slots across these interviewers.</p>}
      </Section>

      {/* Step 2 */}
      <Section n={2} title="Send booking link to candidate" done={!!c.link_sent_at}>
        <div className="break-all rounded bg-stone-100 p-2 text-xs">{url}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={sendLink} disabled={!c.phone}>
            💬 Send on WhatsApp
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(linkMsg);
              run(supabase.from('candidates').update({ link_sent_at: new Date().toISOString() }).eq('id', c.id), 'Message copied');
            }}
          >
            Copy message
          </Button>
        </div>
        {c.link_sent_at && <p className="mt-1 text-xs text-stone-500">Sent on {new Date(c.link_sent_at).toLocaleDateString('en-IN')}</p>}
        <div className="mt-2">
          <Checkbox label="Link is active (candidate can book / change)" checked={c.booking_open} onChange={(v) => run(supabase.from('candidates').update({ booking_open: v }).eq('id', c.id))} />
        </div>
      </Section>

      {/* Step 3 */}
      <Section n={3} title="Interview" done={!!a}>
        {a ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm">
              <div className="font-semibold">{fmtSlot(a.starts_at)}</div>
              <div>
                with <b>{a.people.full_name}</b> · booked by {a.booked_by}
              </div>
              <div className={a.acknowledged_at ? 'text-emerald-700' : 'text-amber-700'}>
                {a.acknowledged_at ? '✓ Interviewer confirmed' : 'Interviewer has not confirmed yet'}
              </div>
              {safeUrl(a.meeting_link) ? (
                <a href={safeUrl(a.meeting_link)!} target="_blank" rel="noreferrer" className="block truncate text-orange-800 underline">
                  🎥 {a.meeting_link}
                </a>
              ) : (
                <div className="text-rose-700">No Google Meet link – add one on the interviewer's profile</div>
              )}
              {calendarLabel(a.calendar_status) && (
                <div className="mt-1" title={a.calendar_status ?? ''}>
                  <Badge c={calendarLabel(a.calendar_status)!.color}>{calendarLabel(a.calendar_status)!.text}</Badge>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={whatsappUrl(a.people.phone, notifyMsg(a))} target="_blank" rel="noreferrer">
                <Button size="sm">💬 Notify interviewer</Button>
              </a>
              {new Date(a.ends_at) < new Date() ? (
                <Button size="sm" onClick={() => setOutcome(true)}>
                  Record outcome
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setReassigning(true)}>
                    Change interviewer
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setManual(true)}>
                    Change time
                  </Button>
                  <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setCancelling(true)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-stone-500">Waiting for the candidate to choose a time – or book one for them.</p>
            <Button size="sm" variant="secondary" onClick={() => setManual(true)}>
              Book a time manually
            </Button>
          </div>
        )}
      </Section>

      {info.bookings.filter((b) => b.status !== 'booked').length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-500">History</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {info.bookings
              .filter((b) => b.status !== 'booked')
              .map((b) => (
                <li key={b.id}>
                  {fmtSlot(b.starts_at)} · {b.people.full_name} · <b>{b.status}</b>
                  {b.cancelled_reason && ` – ${b.cancelled_reason}`}
                </li>
              ))}
          </ul>
        </details>
      )}

      <div className="border-t border-stone-200 pt-3">
        <Button
          size="sm"
          variant="ghost"
          className="text-rose-700"
          onClick={async () => {
            if (confirm(`Delete ${c.full_name} and all their bookings?`) && (await run(supabase.from('candidates').delete().eq('id', c.id), 'Deleted'))) onClose();
          }}
        >
          Delete candidate
        </Button>
      </div>

      {editing && <CandidateEditModal candidate={c} people={people} onClose={() => setEditing(false)} onSaved={reload} />}
      {picking && (
        <InterviewerPicker
          title="Choose interviewers"
          people={people}
          freeByPerson={freeByPerson}
          upcomingCount={upcomingCount}
          defaultRegion={c.region ?? ''}
          defaultLanguage={c.language ?? ''}
          exclude={info.shortlist}
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            if (await run(supabase.from('candidate_shortlist').insert(ids.map((person_id) => ({ candidate_id: c.id, person_id }))), 'Added')) setPicking(false);
          }}
        />
      )}
      {manual && (
        <ManualBookModal
          candidate={c}
          shortlist={info.shortlist}
          people={people}
          freeByPerson={freeByPerson}
          onClose={() => setManual(false)}
          onDone={() => {
            setManual(false);
            reload();
          }}
        />
      )}
      {cancelling && a && (
        <CancelModal
          onClose={() => setCancelling(false)}
          onConfirm={async (reason) => {
            if (await run(supabase.rpc('cancel_interview', { p_booking: a.id, p_reason: reason }), 'Cancelled')) setCancelling(false);
          }}
        />
      )}
      {outcome && a && <OutcomeModal row={a} onClose={() => setOutcome(false)} onDone={reload} />}
      {reassigning && a && (
        <ReassignModal
          booking={a}
          shortlist={info.shortlist}
          people={people}
          freeByPerson={freeByPerson}
          upcomingCount={upcomingCount}
          onClose={() => setReassigning(false)}
          onDone={() => {
            setReassigning(false);
            reload();
          }}
        />
      )}
    </Modal>
  );
}

const Section = ({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) => (
  <section className="rounded-xl border border-stone-200 p-3">
    <div className="mb-2 flex items-center gap-2 font-semibold">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${done ? 'bg-emerald-600' : 'bg-orange-700'}`}>{done ? '✓' : n}</span>
      {title}
    </div>
    {children}
  </section>
);

// ------------------------------------------------------------------
function InterviewerPicker({
  title,
  people,
  freeByPerson,
  upcomingCount,
  defaultRegion,
  defaultLanguage,
  exclude,
  onClose,
  onPick,
}: {
  title: string;
  people: PersonWithTags[];
  freeByPerson: Map<string, string[]>;
  upcomingCount: Map<string, number>;
  defaultRegion: string;
  defaultLanguage: string;
  exclude: string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const L = useLookups();
  const eligible = people.filter((p) => !L.interviewRoleId || L.isEligible(p.person_types.map((t) => t.type_id), L.interviewRoleId));
  const regions = [...new Set(eligible.map((p) => p.region).filter(Boolean))].sort();
  const [region, setRegion] = useState(regions.includes(defaultRegion) ? defaultRegion : '');
  const [langOnly, setLangOnly] = useState(!!defaultLanguage);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);

  const list = eligible
    .filter((p) => !exclude.includes(p.id))
    .filter((p) => !region || p.region === region)
    .filter((p) => !langOnly || !defaultLanguage || p.languages?.includes(defaultLanguage))
    .filter((p) => !q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase()) || p.city?.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (freeByPerson.get(b.id)?.length ?? 0) - (freeByPerson.get(a.id)?.length ?? 0));

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!sel.length} onClick={() => onPick(sel)}>
            Add {sel.length || ''}
          </Button>
        </>
      }
    >
      <div className="flex gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="!w-40 shrink-0" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </div>
      {defaultLanguage && <Checkbox label={`Only those who speak ${defaultLanguage}`} checked={langOnly} onChange={setLangOnly} />}
      {list.length === 0 ? (
        <Empty>No matching Ishangas. Try "All regions" or untick the language filter.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {list.map((p) => {
            const free = freeByPerson.get(p.id)?.length ?? 0;
            const on = sel.includes(p.id);
            return (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2.5">
                  <input type="checkbox" className="h-5 w-5 accent-orange-700" checked={on} onChange={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.full_name}</div>
                    <div className="truncate text-xs text-stone-500">
                      {[p.city, p.region].filter(Boolean).join(', ')}
                      {p.languages?.length ? ` · ${p.languages.join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className={free ? 'text-emerald-700' : 'text-rose-600'}>{free} free</div>
                    <div className="text-stone-500">{upcomingCount.get(p.id) ?? 0} booked</div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------
function ManualBookModal({
  candidate,
  shortlist,
  people,
  freeByPerson,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  shortlist: string[];
  people: PersonWithTags[];
  freeByPerson: Map<string, string[]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const L = useLookups();
  const toast = useToast();
  const eligible = people.filter((p) => !L.interviewRoleId || L.isEligible(p.person_types.map((t) => t.type_id), L.interviewRoleId));
  const ordered = [...eligible.filter((p) => shortlist.includes(p.id)), ...eligible.filter((p) => !shortlist.includes(p.id))];
  const [person, setPerson] = useState(ordered[0]?.id ?? '');
  const [date, setDate] = useState(addDays(todayIST(), 1));
  const [time, setTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const free = freeByPerson.get(person) ?? [];

  const book = async (startTs: string) => {
    setBusy(true);
    if (!shortlist.includes(person)) await supabase.from('candidate_shortlist').upsert({ candidate_id: candidate.id, person_id: person }, { ignoreDuplicates: true });
    const { error } = await supabase.rpc('staff_book_interview', { p_candidate: candidate.id, p_person: person, p_start: startTs });
    setBusy(false);
    if (error) return toast(errMsg(error), true);
    toast('Interview booked');
    onDone();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Book for ${candidate.full_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!person || busy} onClick={() => book(toTs(date, time))}>
            Book {label12(time)}
          </Button>
        </>
      }
    >
      {candidate.requested_times && <div className="rounded-lg bg-amber-50 p-3 text-sm">Candidate prefers: {candidate.requested_times}</div>}
      <Field label="Interviewer">
        <Select value={person} onChange={(e) => setPerson(e.target.value)}>
          {ordered.map((p) => (
            <option key={p.id} value={p.id}>
              {shortlist.includes(p.id) ? '★ ' : ''}
              {p.full_name} ({freeByPerson.get(p.id)?.length ?? 0} free)
            </option>
          ))}
        </Select>
      </Field>
      {free.length > 0 && (
        <Field label="Their free times – tap to book">
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {free.slice(0, 40).map((s) => (
              <button key={s} disabled={busy} onClick={() => book(s)} className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
                {fmtSlot(s)}
              </button>
            ))}
          </div>
        </Field>
      )}
      <p className="text-xs text-stone-500">Or agree any time directly with both and enter it here:</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <Select value={time} onChange={(e) => setTime(e.target.value)}>
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {label12(t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------
function ReassignModal({
  booking,
  shortlist,
  people,
  freeByPerson,
  upcomingCount,
  onClose,
  onDone,
}: {
  booking: B;
  shortlist: string[];
  people: PersonWithTags[];
  freeByPerson: Map<string, string[]>;
  upcomingCount: Map<string, number>;
  onClose: () => void;
  onDone: () => void;
}) {
  const L = useLookups();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const slot = new Date(booking.starts_at).toISOString();
  const isFree = (pid: string) => freeByPerson.get(pid)?.includes(slot) ?? false;
  const list = people
    .filter((p) => p.id !== booking.person_id)
    .filter((p) => !L.interviewRoleId || L.isEligible(p.person_types.map((t) => t.type_id), L.interviewRoleId))
    .sort((x, y) => Number(isFree(y.id)) - Number(isFree(x.id)) || Number(shortlist.includes(y.id)) - Number(shortlist.includes(x.id)) || x.full_name.localeCompare(y.full_name));

  const pick = async (p: PersonWithTags) => {
    if (!isFree(p.id) && !confirm(`${p.full_name} has not marked ${fmtSlot(booking.starts_at)} as free. Assign anyway?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('reassign_interview', { p_booking: booking.id, p_person: p.id });
    setBusy(false);
    if (error) return toast(errMsg(error), true);
    toast(`Reassigned to ${p.full_name}. Please notify them.`);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Change interviewer">
      <p className="text-sm text-stone-600">
        Same time (<b>{fmtSlot(booking.starts_at)}</b>). The candidate is not informed and sees no change. Currently: <b>{booking.people.full_name}</b>.
      </p>
      {list.length === 0 ? (
        <Empty>No other eligible Ishangas.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {list.map((p) => {
            const free = isFree(p.id);
            return (
              <li key={p.id}>
                <button disabled={busy} onClick={() => pick(p)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:bg-stone-50">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {shortlist.includes(p.id) && '★ '}
                      {p.full_name}
                    </div>
                    <div className="truncate text-xs text-stone-500">
                      {[p.city, p.region].filter(Boolean).join(', ')}
                      {p.languages?.length ? ` · ${p.languages.join(', ')}` : ''} · {upcomingCount.get(p.id) ?? 0} booked
                    </div>
                  </div>
                  <Badge c={free ? 'emerald' : 'stone'}>{free ? 'Free then' : 'Not marked free'}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------
function CandidateEditModal({ candidate, people, onClose, onSaved }: { candidate?: Candidate; people: PersonWithTags[]; onClose: () => void; onSaved: () => void }) {
  const L = useLookups();
  const toast = useToast();
  const [f, setF] = useState({
    full_name: candidate?.full_name ?? '',
    phone: candidate?.phone ?? '',
    email: candidate?.email ?? '',
    city: candidate?.city ?? '',
    region: candidate?.region ?? 'North Bharat',
    language: candidate?.language ?? '',
    target_type_id: candidate?.target_type_id ?? L.ishangaTypes[0]?.id ?? '',
    person_id: candidate?.person_id ?? '',
    result: (candidate?.result ?? 'pending') as CandidateResult,
    notes: candidate?.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const target = L.typeById.get(f.target_type_id);
  const prereq = target?.prerequisite_type_id ? L.typeById.get(target.prerequisite_type_id) : null;
  const options = people.filter((p) => !prereq || p.person_types.some((t) => t.type_id === prereq.id));

  const save = async () => {
    if (!f.full_name.trim()) return toast('Name is required', true);
    let personId = f.person_id;
    if (!personId && f.phone) personId = options.find((p) => last10(p.phone) && last10(p.phone) === last10(f.phone))?.id ?? '';
    const row = {
      ...f,
      full_name: f.full_name.trim(),
      person_id: personId || null,
      phone: f.phone || null,
      email: f.email || null,
      city: f.city || null,
      region: f.region || null,
      language: f.language || null,
      notes: f.notes || null,
    };
    const { error } = candidate ? await supabase.from('candidates').update(row).eq('id', candidate.id) : await supabase.from('candidates').insert(row);
    if (error) return toast(errMsg(error), true);
    toast('Saved');
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={candidate ? 'Edit candidate' : 'Add candidate'} footer={<Button onClick={save}>Save</Button>}>
      <Field label="Name *">
        <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Region">
          <Input value={f.region} onChange={(e) => set('region', e.target.value)} />
        </Field>
        <Field label="Interview language">
          <Select value={f.language} onChange={(e) => set('language', e.target.value)}>
            <option value="">—</option>
            {[...new Set([...L.languages, f.language].filter(Boolean))].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Training">
          <Select value={f.target_type_id} onChange={(e) => set('target_type_id', e.target.value)}>
            {L.ishangaTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {prereq && (
        <Field label={`Existing ${prereq.name} *`} hint={`Only ${prereq.name}s can be interviewed for ${target?.name} training.`}>
          <Select value={f.person_id} onChange={(e) => set('person_id', e.target.value)}>
            <option value="">— Match by phone number —</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </Field>
      )}
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

// ------------------------------------------------------------------
const ALIASES: Record<string, string[]> = {
  full_name: ['name', 'fullname', 'candidatename', 'candidate'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact', 'contactnumber', 'whatsapp'],
  email: ['email', 'emailid', 'mail'],
  city: ['city', 'town', 'center', 'centre'],
  region: ['region', 'state', 'zone'],
  language: ['language', 'interviewlanguage', 'lang'],
  training: ['training', 'trainingfor', 'for', 'type', 'ishangatype'],
  notes: ['notes', 'remarks', 'comments'],
};

function CsvImportModal({ existing, people, onClose, onDone }: { existing: Candidate[]; people: PersonWithTags[]; onClose: () => void; onDone: () => void }) {
  const L = useLookups();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [defType, setDefType] = useState(L.ishangaTypes[0]?.id ?? '');
  const [defRegion, setDefRegion] = useState('North Bharat');
  const [busy, setBusy] = useState(false);

  const pick = (r: Record<string, string>, field: string) => ALIASES[field].map((k) => r[k]).find((v) => v) ?? '';
  const existingPhones = new Set(existing.map((c) => last10(c.phone)).filter(Boolean));

  const parsed = (rows ?? []).map((r) => {
    const trainingText = pick(r, 'training').toLowerCase();
    const type = (trainingText && L.ishangaTypes.find((t) => t.name.toLowerCase().includes(trainingText) || trainingText.includes(t.name.toLowerCase().split(' ')[0]))) || L.typeById.get(defType);
    const prereq = type?.prerequisite_type_id;
    const phone = pick(r, 'phone');
    const person = people.find((p) => last10(p.phone) && last10(p.phone) === last10(phone));
    let error = '';
    if (!pick(r, 'full_name')) error = 'Missing name';
    else if (!type) error = 'Unknown training';
    else if (phone && existingPhones.has(last10(phone))) error = 'Already exists (same phone)';
    else if (prereq && !person?.person_types.some((t) => t.type_id === prereq)) error = `Not found as ${L.typeById.get(prereq)?.name} (match by phone)`;
    return {
      error,
      row: {
        full_name: pick(r, 'full_name'),
        phone: phone || null,
        email: pick(r, 'email') || null,
        city: pick(r, 'city') || null,
        region: pick(r, 'region') || defRegion || null,
        language: pick(r, 'language') || null,
        notes: pick(r, 'notes') || null,
        target_type_id: type?.id ?? '',
        person_id: person?.id ?? null,
      },
    };
  });
  const ok = parsed.filter((p) => !p.error);
  const bad = parsed.filter((p) => p.error);

  const importNow = async () => {
    setBusy(true);
    const { error } = await supabase.from('candidates').insert(ok.map((p) => p.row));
    setBusy(false);
    if (error) return toast(errMsg(error), true);
    toast(`${ok.length} candidates imported`);
    onDone();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload candidates (CSV)"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok.length || busy} onClick={importNow}>
            Import {ok.length || ''}
          </Button>
        </>
      }
    >
      <p className="text-sm text-stone-600">
        Columns (any order): <b>Name</b>, <b>Phone</b>, Email, City, Region, Language, Training, Notes. Save your Excel sheet as “CSV” first.
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          downloadText('candidates-template.csv', 'Name,Phone,Email,City,Region,Language,Training,Notes\nRam Kumar,9876543210,ram@example.com,Delhi,North Bharat,Hindi,SPS Ishanga,\n')
        }
      >
        ⬇ Download template
      </Button>
      <Input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setRows(csvObjects(await file.text()));
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Training if not in file">
          <Select value={defType} onChange={(e) => setDefType(e.target.value)}>
            {L.ishangaTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Region if not in file">
          <Input value={defRegion} onChange={(e) => setDefRegion(e.target.value)} />
        </Field>
      </div>
      {rows && (
        <div className="space-y-2 text-sm">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">✓ {ok.length} ready to import</div>
          {bad.length > 0 && (
            <div className="rounded-lg bg-rose-50 p-2 text-rose-800">
              ✕ {bad.length} will be skipped:
              <ul className="mt-1 max-h-32 list-inside list-disc overflow-y-auto text-xs">
                {bad.map((b, i) => (
                  <li key={i}>
                    {b.row.full_name || '(no name)'} – {b.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

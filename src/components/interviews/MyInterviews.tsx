import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CANDIDATE_RESULT, calendarLabel, errMsg, safeUrl } from '../../lib/format';
import { downloadIcs, googleCalUrl, whatsappUrl } from '../../lib/calendar';
import { fmtDay, fmtSlot, fmtTime, istDate } from '../../lib/time';
import type { Booking, Candidate, CandidateResult } from '../../lib/types';
import { useLookups } from '../../context/LookupContext';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '../ui';

type Row = Booking & { candidates: Candidate };

export default function MyInterviews({ personId }: { personId: string }) {
  const toast = useToast();
  const L = useLookups();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState<Row | null>(null);

  const load = async () => {
    const { data } = await supabase.from('interview_bookings').select('*, candidates(*)').eq('person_id', personId).order('starts_at');
    setRows((data ?? []) as Row[]);
  };
  useEffect(() => {
    load();
  }, [personId]);

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast(errMsg(error), true);
    toast(ok);
    load();
  };

  if (!rows) return <Spinner />;
  const now = new Date().toISOString();
  const upcoming = rows.filter((r) => r.status === 'booked' && new Date(r.ends_at).toISOString() > now);
  const toRecord = rows.filter((r) => r.status === 'booked' && new Date(r.ends_at).toISOString() <= now);
  const past = rows.filter((r) => r.status !== 'booked').reverse().slice(0, 20);

  const card = (r: Row) => {
    const c = r.candidates;
    const training = L.typeById.get(c.target_type_id)?.name;
    const isNew = !r.acknowledged_at && r.status === 'booked';
    const ev = {
      title: `Interview: ${c.full_name}`,
      start: r.starts_at,
      end: r.ends_at,
      location: safeUrl(r.meeting_link) ?? undefined,
      details: `Candidate: ${c.full_name}\nPhone: ${c.phone ?? '-'}\nTraining: ${training ?? '-'}\nLanguage: ${c.language ?? '-'}\nRegion: ${c.region ?? c.city ?? '-'}`,
    };
    return (
      <Card key={r.id} className={isNew ? 'border-2 border-orange-500' : ''}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-bold">{fmtDay(istDate(r.starts_at), { weekday: 'long', day: 'numeric', month: 'short' })}</div>
            <div className="text-2xl font-bold text-orange-900">
              {fmtTime(r.starts_at)} <span className="text-sm font-normal text-stone-500">– {fmtTime(r.ends_at)}</span>
            </div>
          </div>
          {isNew && <Badge c="orange">NEW</Badge>}
          {r.status !== 'booked' && <Badge c={r.status === 'completed' ? 'emerald' : 'rose'}>{r.status === 'no_show' ? 'No show' : r.status}</Badge>}
        </div>
        <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">
          <div className="text-base font-semibold">{c.full_name}</div>
          <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-y-1">
            <dt className="text-stone-500">Training</dt>
            <dd>{training}</dd>
            <dt className="text-stone-500">Language</dt>
            <dd>{c.language || '—'}</dd>
            <dt className="text-stone-500">Region</dt>
            <dd>{[c.city, c.region].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-stone-500">Phone</dt>
            <dd>{c.phone || '—'}</dd>
          </dl>
          {c.notes && <p className="mt-2 whitespace-pre-wrap text-stone-600">{c.notes}</p>}
          {r.status === 'cancelled' && r.cancelled_reason && <p className="mt-2 text-rose-700">Cancelled: {r.cancelled_reason}</p>}
        </div>
        {r.status === 'booked' && (
          <>
            {safeUrl(r.meeting_link) && (
              <a href={safeUrl(r.meeting_link)!} target="_blank" rel="noreferrer" className="mt-3 block">
                <Button className="w-full">🎥 Join Google Meet</Button>
              </a>
            )}
            {calendarLabel(r.calendar_status) && (
              <div className="mt-2">
                <Badge c={calendarLabel(r.calendar_status)!.color}>{calendarLabel(r.calendar_status)!.text}</Badge>
              </div>
            )}
            {c.phone && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={`tel:${c.phone}`}>
                  <Button variant="secondary" className="w-full">
                    📞 Call
                  </Button>
                </a>
                <a href={whatsappUrl(c.phone, `Namaskaram ${c.full_name}, this is regarding your Ishanga training interview on ${fmtSlot(r.starts_at)}.`)} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="w-full">
                    💬 WhatsApp
                  </Button>
                </a>
              </div>
            )}
            <MeetingLink row={r} onSaved={load} />
            <div className="mt-3 flex flex-wrap gap-2">
              {isNew && (
                <Button onClick={() => rpc('acknowledge_interview', { p_booking: r.id }, 'Confirmed! Calendar invites are being sent to you and the candidate.')}>
                  ✓ Confirm – I'll be there
                </Button>
              )}
              <a href={googleCalUrl(ev)} target="_blank" rel="noreferrer">
                <Button variant="secondary">📅 Google Calendar</Button>
              </a>
              <Button variant="secondary" onClick={() => downloadIcs(ev)}>
                📲 Phone calendar
              </Button>
              {new Date(r.ends_at) <= new Date() ? (
                <Button onClick={() => setOutcome(r)}>Record outcome</Button>
              ) : (
                <Button variant="ghost" className="text-rose-700" onClick={() => setCancelling(r)}>
                  Can't make it
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    );
  };

  return (
    <>
      <MyMeetCard personId={personId} />
      {toRecord.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold text-amber-800">Please record the outcome</h2>
          <div className="mb-6 space-y-3">{toRecord.map(card)}</div>
        </>
      )}
      <h2 className="mb-2 font-semibold">Upcoming interviews</h2>
      <div className="mb-6 space-y-3">{upcoming.length ? upcoming.map(card) : <Empty>No interviews booked yet. Make sure your availability is filled in.</Empty>}</div>
      {past.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Past</h2>
          <div className="space-y-3">{past.map(card)}</div>
        </>
      )}

      {cancelling && (
        <CancelModal
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => rpc('cancel_interview', { p_booking: cancelling.id, p_reason: reason }, 'Cancelled. The coordinator will re-arrange.').then(() => setCancelling(null))}
        />
      )}
      {outcome && <OutcomeModal row={outcome} onClose={() => setOutcome(null)} onDone={load} />}
    </>
  );
}

function MyMeetCard({ personId }: { personId: string }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<{ meet_link: string | null; email: string | null } | null>(null);
  const [link, setLink] = useState('');
  const [email, setEmail] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    supabase
      .from('people')
      .select('meet_link, email')
      .eq('id', personId)
      .single()
      .then(({ data }) => {
        setLoaded(data ?? { meet_link: null, email: null });
        setLink(data?.meet_link ?? '');
        setEmail(data?.email ?? '');
        setEditing(!data?.meet_link || !data?.email);
      });
  }, [personId]);

  if (!loaded) return null;
  const save = async () => {
    const { error } = await supabase.rpc('set_my_interview_profile', { p_meet_link: link, p_email: email });
    if (error) return toast(errMsg(error), true);
    setLoaded({ meet_link: link || null, email: email || loaded.email });
    setEditing(false);
    toast('Saved');
  };

  if (!editing)
    return (
      <Card className="mb-4 flex items-center justify-between gap-2 !p-3 text-sm">
        <div className="min-w-0">
          <div className="truncate">🎥 {loaded.meet_link}</div>
          <div className="truncate text-xs text-stone-500">📧 Invites go to {loaded.email}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </Card>
    );

  return (
    <Card className="mb-4 space-y-3 border-orange-300 bg-orange-50">
      <div className="font-semibold">Your interview details</div>
      <p className="text-sm text-stone-600">Candidates join your Google Meet link. Calendar invites are sent to your email when you confirm an interview.</p>
      <Field label="My Google Meet link" hint="Open meet.google.com → New meeting → Create a meeting for later → copy the link.">
        <Input type="url" placeholder="https://meet.google.com/abc-defg-hij" value={link} onChange={(e) => setLink(e.target.value)} />
      </Field>
      <Field label="My email (Google account)">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button onClick={save}>Save</Button>
    </Card>
  );
}

function MeetingLink({ row, onSaved }: { row: Booking; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(row.meeting_link ?? '');
  const dirty = v !== (row.meeting_link ?? '');
  return (
    <div className="mt-3 flex gap-2">
      <Input type="url" placeholder="Different link for this interview (optional)" value={v} onChange={(e) => setV(e.target.value)} />
      {dirty && (
        <Button
          variant="secondary"
          onClick={async () => {
            const { error } = await supabase.rpc('set_interview_link', { p_booking: row.id, p_link: v });
            if (error) return toast(errMsg(error), true);
            toast('Link saved – candidate will see it on their booking page');
            onSaved();
          }}
        >
          Save
        </Button>
      )}
    </div>
  );
}

export function CancelModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel this interview?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant="danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Cancel interview
          </Button>
        </>
      }
    >
      <p className="text-sm text-stone-600">The coordinator will be shown this and will help the candidate pick a new time.</p>
      <Field label="Reason">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Called for urgent seva" />
      </Field>
    </Modal>
  );
}

export function OutcomeModal({ row, onClose, onDone }: { row: Booking; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'completed' | 'no_show'>('completed');
  const [result, setResult] = useState<CandidateResult | ''>('');
  const [notes, setNotes] = useState('');
  const save = async () => {
    const { error } = await supabase.rpc('record_interview_outcome', { p_booking: row.id, p_status: status, p_result: result, p_notes: notes });
    if (error) return toast(errMsg(error), true);
    toast('Saved');
    onDone();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="How did the interview go?" footer={<Button onClick={save}>Save</Button>}>
      <div className="grid grid-cols-2 gap-2">
        {(['completed', 'no_show'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-xl border p-3 ${status === s ? 'border-orange-700 bg-orange-50 font-semibold' : 'border-stone-300'}`}>
            {s === 'completed' ? '✅ Interview done' : '❌ Candidate did not join'}
          </button>
        ))}
      </div>
      {status === 'completed' && (
        <Field label="Recommendation (optional – coordinator can set later)">
          <Select value={result} onChange={(e) => setResult(e.target.value as CandidateResult | '')}>
            <option value="">Leave for coordinator</option>
            {(['selected', 'not_selected', 'on_hold'] as const).map((k) => (
              <option key={k} value={k}>
                {CANDIDATE_RESULT[k].label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errMsg, safeUrl } from '../lib/format';
import { downloadIcs, googleCalUrl } from '../lib/calendar';
import { fmtDay, fmtSlot, fmtTime, istDate } from '../lib/time';
import { Button, Card, Modal, Spinner, Textarea } from '../components/ui';

interface PageData {
  name: string;
  language: string | null;
  training: string | null;
  open: boolean;
  guidelines: string | null;
  requested_times: string | null;
  booking: { starts_at: string; ends_at: string; status: string; meeting_link: string | null } | null;
  slots: string[];
}

export default function Book() {
  const { token } = useParams();
  const [data, setData] = useState<PageData | null | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [changing, setChanging] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reqText, setReqText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { data: d, error: e } = await supabase.rpc(fn, { p_token: token, ...args });
    setBusy(false);
    if (e) {
      setError(errMsg(e));
      // Refresh slots in case someone else took the time
      const { data: fresh } = await supabase.rpc('booking_page', { p_token: token });
      setData(fresh as PageData | null);
      return false;
    }
    setData(d as PageData | null);
    return true;
  };

  useEffect(() => {
    supabase.rpc('booking_page', { p_token: token }).then(({ data: d }) => setData(d as PageData | null));
  }, [token]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of data?.slots ?? []) {
      const d = istDate(s);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [data]);

  useEffect(() => {
    if (!day || !byDay.has(day)) setDay(byDay.keys().next().value ?? null);
  }, [byDay, day]);

  if (data === undefined) return <Spinner />;
  if (!data)
    return (
      <Shell>
        <Card className="text-center">This link is not valid. Please contact the person who sent it to you.</Card>
      </Shell>
    );

  const booked = data.booking?.status === 'booked' ? data.booking : null;
  const done = data.booking?.status === 'completed';
  const event = booked && {
    title: `${data.training ?? 'Ishanga'} training interview`,
    start: booked.starts_at,
    end: booked.ends_at,
    details: `Interview for ${data.training ?? 'Ishanga'} training.${safeUrl(booked.meeting_link) ? '\nJoin on Google Meet: ' + booked.meeting_link : ''}`,
    location: safeUrl(booked.meeting_link) ?? undefined,
  };

  return (
    <Shell>
      <h1 className="text-2xl font-bold">Namaskaram {data.name} 🙏</h1>
      <p className="mb-4 text-stone-600">
        Please choose a time for your interview{data.training && <> for <b>{data.training} training</b></>}.
        {data.language && <> The interview will be in <b>{data.language}</b>.</>}
      </p>

      {error && <Card className="mb-4 border-rose-300 bg-rose-50 text-rose-800">{error}</Card>}

      {done ? (
        <Card className="text-center">Your interview has been completed. Thank you! 🙏</Card>
      ) : booked && !changing ? (
        <Card className="space-y-4 border-emerald-300 bg-emerald-50">
          <div className="text-center">
            <div className="text-4xl">✅</div>
            <div className="text-sm text-emerald-800">Your interview is booked for</div>
            <div className="text-xl font-bold text-emerald-900">{fmtDay(istDate(booked.starts_at), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <div className="text-2xl font-bold text-emerald-900">{fmtTime(booked.starts_at)}</div>
            <div className="text-xs text-emerald-700">India time · about 30 minutes</div>
          </div>
          {safeUrl(booked.meeting_link) ? (
            <a href={safeUrl(booked.meeting_link)!} target="_blank" rel="noreferrer" className="block">
              <Button className="w-full">🎥 Join Google Meet</Button>
              <div className="mt-1 break-all text-center text-xs text-emerald-800">{booked.meeting_link}</div>
            </a>
          ) : (
            <p className="text-center text-sm text-emerald-800">You will receive the meeting link or a call at this time. Please keep your phone with you.</p>
          )}
          <p className="text-center text-xs text-emerald-800">A calendar invite will also be sent to your email once confirmed.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={googleCalUrl(event!)} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="w-full">
                📅 Add to Google Calendar
              </Button>
            </a>
            <Button variant="secondary" onClick={() => downloadIcs(event!)}>
              📲 Add to phone calendar
            </Button>
          </div>
          {data.open && (
            <div className="flex justify-center gap-4 pt-2 text-sm">
              <button className="text-orange-800 underline" onClick={() => setChanging(true)}>
                Change time
              </button>
              <button
                className="text-rose-700 underline"
                onClick={() => window.confirm('Cancel your interview?') && call('cancel_my_interview', {})}
                disabled={busy}
              >
                Cancel interview
              </button>
            </div>
          )}
        </Card>
      ) : !data.open ? (
        <Card className="text-center">Booking is closed for this link. Please contact the coordinator.</Card>
      ) : (
        <>
          {/* Step 1: guidelines */}
          <Card className="mb-4">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <Step n={1} done={agreed} /> Please read before booking
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{data.guidelines}</div>
            <label className="mt-3 flex items-center gap-3 rounded-lg bg-orange-50 p-3 text-sm font-medium">
              <input type="checkbox" className="h-5 w-5 accent-orange-700" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              I have read and understood the above
            </label>
          </Card>

          {/* Step 2: pick a time */}
          <Card className={agreed ? '' : 'pointer-events-none opacity-40'}>
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <Step n={2} /> Choose a day and time
              <span className="ml-auto text-xs font-normal text-stone-500">India time</span>
            </div>

            {byDay.size === 0 ? (
              <p className="py-4 text-center text-sm text-stone-600">There are no free times right now.</p>
            ) : (
              <>
                <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {[...byDay.entries()].map(([d, list]) => (
                    <button
                      key={d}
                      onClick={() => setDay(d)}
                      className={`flex min-w-[4.5rem] flex-col items-center rounded-xl border px-3 py-2 ${
                        day === d ? 'border-orange-700 bg-orange-700 text-white' : 'border-stone-300 bg-white'
                      }`}
                    >
                      <span className="text-xs">{fmtDay(d, { weekday: 'short' })}</span>
                      <span className="text-xl font-bold">{fmtDay(d, { day: 'numeric' })}</span>
                      <span className="text-xs">{fmtDay(d, { month: 'short' })}</span>
                      <span className={`mt-1 text-[10px] ${day === d ? 'text-orange-100' : 'text-stone-500'}`}>{list.length} free</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {(day ? byDay.get(day) ?? [] : []).map((s) => (
                    <button key={s} onClick={() => setConfirm(s)} className="rounded-lg border border-orange-300 bg-white py-3 text-sm font-semibold text-orange-900 hover:bg-orange-50">
                      {fmtTime(s)}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-5 border-t border-stone-200 pt-4 text-center">
              {data.requested_times ? (
                <p className="text-sm text-stone-600">
                  ✔️ We received your preferred times: <i>“{data.requested_times}”</i>. We will contact you soon. You can still pick a time above if one becomes available.
                </p>
              ) : (
                <button className="text-sm font-medium text-orange-800 underline" onClick={() => setRequesting(true)}>
                  None of these times work for me
                </button>
              )}
            </div>
            {changing && (
              <div className="mt-3 text-center">
                <button className="text-sm text-stone-500 underline" onClick={() => setChanging(false)}>
                  Keep my current time
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm your interview"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await call('book_interview', { p_start: confirm })) setChanging(false);
                setConfirm(null);
              }}
            >
              {busy ? 'Booking…' : 'Yes, book it'}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="text-center">
            <div className="text-lg font-bold">{fmtSlot(confirm)}</div>
            <div className="text-sm text-stone-500">India time · about 30 minutes</div>
            {booked && <p className="mt-3 text-sm text-amber-700">Your earlier time ({fmtSlot(booked.starts_at)}) will be released.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={requesting}
        onClose={() => setRequesting(false)}
        title="Tell us what suits you"
        footer={
          <Button
            disabled={busy || reqText.trim().length < 3}
            onClick={async () => {
              if (await call('request_other_times', { p_text: reqText })) setRequesting(false);
            }}
          >
            Send
          </Button>
        }
      >
        <p className="text-sm text-stone-600">Write the days and times that work for you. A coordinator will arrange the interview and send you a new link.</p>
        <Textarea rows={4} placeholder="e.g. Weekdays after 7 PM, or Sunday morning" value={reqText} onChange={(e) => setReqText(e.target.value)} />
      </Modal>
    </Shell>
  );
}

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto min-h-screen max-w-xl p-4 pb-10">
    <div className="mb-6 text-center">
      <div className="text-lg font-bold text-orange-900">Ishanga Interview Booking</div>
    </div>
    {children}
  </div>
);

const Step = ({ n, done }: { n: number; done?: boolean }) => (
  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${done ? 'bg-emerald-600' : 'bg-orange-700'}`}>{done ? '✓' : n}</span>
);

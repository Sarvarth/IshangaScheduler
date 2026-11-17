import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { errMsg } from '../../lib/format';
import { addDays, fmtDay, fmtTime, istDate, label12, mondayOf, slotCount, TIME_OPTIONS, toTs, todayIST } from '../../lib/time';
import type { Availability, Booking } from '../../lib/types';
import { Button, Card, ChipSelect, Field, Modal, Select, Spinner, useToast } from '../ui';

const PRESETS = [
  { label: '🌅 Morning', from: '09:00', to: '12:00' },
  { label: '☀️ Afternoon', from: '14:00', to: '17:00' },
  { label: '🌆 Evening', from: '18:00', to: '21:00' },
  { label: '🌙 Late evening', from: '20:00', to: '22:00' },
];

type Range = { start: string; end: string };

/** Merge new ranges into existing ones for one person; returns ids to delete and ranges to insert. */
function mergePlan(existing: Availability[], add: Range[]) {
  const all = [...existing.map((e) => ({ start: e.starts_at, end: e.ends_at, id: e.id })), ...add.map((a) => ({ ...a, id: '' }))].sort(
    (a, b) => +new Date(a.start) - +new Date(b.start),
  );
  const merged: { start: string; end: string; ids: string[]; touched: boolean }[] = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && +new Date(r.start) <= +new Date(last.end)) {
      if (+new Date(r.end) > +new Date(last.end)) last.end = r.end;
      if (r.id) last.ids.push(r.id);
      last.touched = true;
    } else merged.push({ start: r.start, end: r.end, ids: r.id ? [r.id] : [], touched: !r.id });
  }
  const changed = merged.filter((m) => m.touched);
  return { del: changed.flatMap((m) => m.ids), ins: changed.map((m) => ({ starts_at: m.start, ends_at: m.end })) };
}

export default function MyAvailability({ personId, personName }: { personId: string; personName?: string }) {
  const toast = useToast();
  const today = todayIST();
  const [week, setWeek] = useState(mondayOf(today));
  const [rows, setRows] = useState<Availability[] | null>(null);
  const [booked, setBooked] = useState<Booking[]>([]);
  const [addFor, setAddFor] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  const load = async () => {
    setRows(null);
    const from = toTs(week, '00:00');
    const to = toTs(addDays(week, 7), '00:00');
    const [a, b] = await Promise.all([
      supabase.from('interviewer_availability').select('*').eq('person_id', personId).gte('starts_at', from).lt('starts_at', to).order('starts_at'),
      supabase.from('interview_bookings').select('*').eq('person_id', personId).eq('status', 'booked').gte('starts_at', from).lt('starts_at', to),
    ]);
    setRows((a.data ?? []) as Availability[]);
    setBooked((b.data ?? []) as Booking[]);
  };

  useEffect(() => {
    load();
  }, [week, personId]);

  const addRanges = async (ranges: Range[]) => {
    if (!ranges.length) return;
    const min = ranges.reduce((m, r) => (r.start < m ? r.start : m), ranges[0].start);
    const max = ranges.reduce((m, r) => (r.end > m ? r.end : m), ranges[0].end);
    const { data, error } = await supabase.from('interviewer_availability').select('*').eq('person_id', personId).lte('starts_at', max).gte('ends_at', min);
    if (error) return toast(errMsg(error), true);
    const plan = mergePlan((data ?? []) as Availability[], ranges);
    if (plan.del.length) {
      const { error: e } = await supabase.from('interviewer_availability').delete().in('id', plan.del);
      if (e) return toast(errMsg(e), true);
    }
    const { error: e2 } = await supabase.from('interviewer_availability').insert(plan.ins.map((r) => ({ ...r, person_id: personId })));
    if (e2) return toast(errMsg(e2), true);
    toast('Availability saved');
    load();
  };

  const remove = async (a: Availability) => {
    const clash = booked.some((b) => b.starts_at < a.ends_at && b.ends_at > a.starts_at);
    if (clash && !confirm('You have an interview booked in this time. Removing availability will NOT cancel it. Continue?')) return;
    const { error } = await supabase.from('interviewer_availability').delete().eq('id', a.id);
    if (error) return toast(errMsg(error), true);
    load();
  };

  const copyLastWeek = async () => {
    const prevFrom = toTs(addDays(week, -7), '00:00');
    const { data } = await supabase.from('interviewer_availability').select('*').eq('person_id', personId).gte('starts_at', prevFrom).lt('starts_at', toTs(week, '00:00'));
    const shifted = ((data ?? []) as Availability[])
      .map((a) => ({ start: new Date(+new Date(a.starts_at) + 7 * 864e5).toISOString(), end: new Date(+new Date(a.ends_at) + 7 * 864e5).toISOString() }))
      .filter((r) => istDate(r.start) >= today);
    if (!shifted.length) return toast('Nothing to copy from last week', true);
    addRanges(shifted);
  };

  const clearWeek = async () => {
    const future = (rows ?? []).filter((r) => istDate(r.starts_at) >= today);
    if (!future.length || !confirm('Remove all your availability for this week?')) return;
    const { error } = await supabase.from('interviewer_availability').delete().in('id', future.map((r) => r.id));
    if (error) return toast(errMsg(error), true);
    load();
  };

  const totalSlots = (rows ?? []).reduce((n, r) => n + slotCount(r.starts_at, r.ends_at), 0);

  return (
    <>
      <Card className="mb-4 bg-orange-50">
        <p className="text-sm text-stone-700">
          {personName ? <b>{personName}: </b> : null}
          Add the times you are free to take interviews. Each interview is <b>30 minutes</b>. Candidates will only see free times and pick one. You'll be told as soon as a candidate books.
        </p>
      </Card>

      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(week, -7))} disabled={week <= mondayOf(today)}>
          ‹ Prev
        </Button>
        <div className="text-center">
          <div className="font-semibold">
            {fmtDay(week, { day: 'numeric', month: 'short' })} – {fmtDay(addDays(week, 6), { day: 'numeric', month: 'short' })}
          </div>
          <div className="text-xs text-stone-500">{totalSlots} interview slots this week</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(week, 7))}>
          Next ›
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="ghost" onClick={copyLastWeek}>
          ⧉ Same as last week
        </Button>
        <Button size="sm" variant="ghost" onClick={clearWeek}>
          🗑 Clear this week
        </Button>
      </div>

      {!rows ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {days.map((d) => {
            const past = d < today;
            const mine = rows.filter((r) => istDate(r.starts_at) === d);
            const ints = booked.filter((b) => istDate(b.starts_at) === d);
            return (
              <div key={d} className={`rounded-xl border bg-white p-3 ${d === today ? 'border-orange-400' : 'border-stone-200'} ${past ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {fmtDay(d, { weekday: 'long', day: 'numeric', month: 'short' })}
                    {d === today && <span className="ml-2 text-xs text-orange-700">Today</span>}
                  </div>
                  {!past && (
                    <Button size="sm" variant="secondary" onClick={() => setAddFor(d)}>
                      + Add time
                    </Button>
                  )}
                </div>
                {(mine.length > 0 || ints.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mine.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 py-1 pl-3 pr-1 text-sm text-emerald-900">
                        {fmtTime(r.starts_at)} – {fmtTime(r.ends_at)}
                        {!past && (
                          <button onClick={() => remove(r)} className="ml-1 rounded-full px-1.5 text-emerald-700 hover:bg-emerald-200" aria-label="Remove">
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                    {ints.map((b) => (
                      <span key={b.id} className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
                        🎤 Interview {fmtTime(b.starts_at)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addFor && <AddTimeModal date={addFor} week={days} today={today} onClose={() => setAddFor(null)} onSave={(r) => addRanges(r).then(() => setAddFor(null))} />}
    </>
  );
}

function AddTimeModal({ date, week, today, onClose, onSave }: { date: string; week: string[]; today: string; onClose: () => void; onSave: (r: Range[]) => void }) {
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('20:00');
  const [daysSel, setDaysSel] = useState<string[]>([date]);
  const [repeat, setRepeat] = useState(0);

  const valid = to > from && daysSel.length > 0;
  const slots = valid ? slotCount(toTs(date, from), toTs(date, to)) : 0;

  const save = () => {
    const ranges: Range[] = [];
    for (let w = 0; w <= repeat; w++) for (const d of daysSel) ranges.push({ start: toTs(addDays(d, 7 * w), from), end: toTs(addDays(d, 7 * w), to) });
    onSave(ranges.filter((r) => new Date(r.start) > new Date()));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="When are you free?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className={`rounded-xl border p-3 text-left ${from === p.from && to === p.to ? 'border-orange-700 bg-orange-50' : 'border-stone-300'}`}
          >
            <div className="font-medium">{p.label}</div>
            <div className="text-xs text-stone-500">
              {label12(p.from)} – {label12(p.to)}
            </div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {TIME_OPTIONS.slice(0, -1).map((t) => (
              <option key={t} value={t}>
                {label12(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {TIME_OPTIONS.slice(1).map((t) => (
              <option key={t} value={t} disabled={t <= from}>
                {label12(t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {valid && <p className="text-center text-sm text-emerald-700">= {slots} interview slot{slots === 1 ? '' : 's'} of 30 min</p>}
      <Field label="Same time on these days too">
        <ChipSelect
          options={week.filter((d) => d >= today).map((d) => ({ id: d, name: fmtDay(d, { weekday: 'short', day: 'numeric' }) }))}
          value={daysSel}
          onChange={setDaysSel}
        />
      </Field>
      <Field label="Repeat">
        <Select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
          <option value={0}>Only this week</option>
          <option value={1}>This week + next week</option>
          <option value={3}>Every week for 4 weeks</option>
          <option value={7}>Every week for 8 weeks</option>
        </Select>
      </Field>
    </Modal>
  );
}

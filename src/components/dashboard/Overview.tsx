import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ACTIVE_ASSIGNMENT, addDaysISO, calendarLabel, safeUrl, todayISO } from '../../lib/format';
import { fmtDay, fmtTime, istDate } from '../../lib/time';
import type { Activity, Booking, Candidate } from '../../lib/types';
import { useLookups } from '../../context/LookupContext';
import { Badge, Card, Spinner } from '../ui';

type B = Booking & { people: { full_name: string }; candidates: Pick<Candidate, 'full_name' | 'language' | 'region' | 'city'> };
type Item = { key: string; icon: string; text: string; to: string; tone: 'rose' | 'amber' };

/** Coordinator view: actionable items first, then this week's interviews, then pipeline. */
export function InterviewOverview() {
  const L = useLookups();
  const [data, setData] = useState<{ items: Item[]; week: B[]; pipeline: Record<string, number> } | null>(null);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const today = todayISO();
      const [bk, cands, acts, optins] = await Promise.all([
        supabase.from('interview_bookings').select('*, people(full_name), candidates(full_name, language, region, city)').in('status', ['booked', 'cancelled']).order('starts_at'),
        supabase.from('candidates').select('id, result, requested_times, link_sent_at'),
        supabase.from('activities').select('*').gte('start_date', today).lte('start_date', addDaysISO(today, 7)).in('status', ['planned', 'confirmed']),
        supabase.from('assignments').select('id, activities!inner(start_date)', { count: 'exact', head: true }).eq('status', 'opted_in').gte('activities.start_date', today),
      ]);
      const bookings = (bk.data ?? []) as B[];
      const booked = bookings.filter((b) => b.status === 'booked');
      const activeCand = new Set(booked.map((b) => b.candidate_id));
      const candList = (cands.data ?? []) as Pick<Candidate, 'id' | 'result' | 'requested_times' | 'link_sent_at'>[];
      const pendingCand = candList.filter((c) => c.result === 'pending');

      const unconfirmed = booked.filter((b) => !b.acknowledged_at && new Date(b.starts_at) > now);
      const soon = unconfirmed.filter((b) => +new Date(b.starts_at) - +now < 48 * 3600e3);
      const calIssues = booked.filter((b) => b.acknowledged_at && b.calendar_status && b.calendar_status !== 'sent' && new Date(b.starts_at) > now);
      const noLink = booked.filter((b) => !safeUrl(b.meeting_link) && new Date(b.starts_at) > now);
      const outcome = booked.filter((b) => new Date(b.ends_at) < now);
      const interviewerCancelled = new Set(
        bookings.filter((b) => b.status === 'cancelled' && b.cancelled_by === 'interviewer' && !activeCand.has(b.candidate_id)).map((b) => b.candidate_id),
      );
      const needHelp = pendingCand.filter((c) => !activeCand.has(c.id) && (c.requested_times || interviewerCancelled.has(c.id)));

      // Open role slots in the next 7 days
      const actList = (acts.data ?? []) as Activity[];
      let openSlots = 0;
      if (actList.length) {
        const { data: asg } = await supabase.from('assignments').select('activity_id, role_id').in('activity_id', actList.map((a) => a.id)).in('status', ACTIVE_ASSIGNMENT);
        for (const a of actList)
          for (const r of L.rolesForType(a.activity_type_id))
            if (r.default_capacity != null)
              openSlots += Math.max(0, r.default_capacity - (asg ?? []).filter((x) => x.activity_id === a.id && x.role_id === r.id).length);
      }

      const items: Item[] = [];
      const add = (n: number, icon: string, text: string, to: string, tone: Item['tone']) => n > 0 && items.push({ key: text, icon, text: text.replace('{n}', String(n)), to, tone });
      add(soon.length, '⏰', '{n} interview(s) in the next 48h not confirmed by the Ishanga', '/interviews', 'rose');
      add(needHelp.length, '🙋', '{n} candidate(s) need help finding a time', '/interviews', 'rose');
      add(calIssues.length, '📅', '{n} calendar invite(s) had a problem', '/interviews', 'rose');
      add(unconfirmed.length - soon.length, '🕐', '{n} other interview(s) awaiting Ishanga confirmation', '/interviews', 'amber');
      add(noLink.length, '🎥', '{n} upcoming interview(s) without a Google Meet link', '/interviews', 'amber');
      add(outcome.length, '📝', '{n} interview(s) need an outcome recorded', '/interviews', 'amber');
      add(openSlots, '👥', '{n} open seva slot(s) in the next 7 days', '/activities', 'amber');
      add(optins.count ?? 0, '✋', '{n} opt-in(s) waiting for your confirmation', '/activities', 'amber');

      const weekEnd = addDaysISO(today, 7);
      setData({
        items,
        week: booked.filter((b) => new Date(b.starts_at) > now && istDate(b.starts_at) <= weekEnd),
        pipeline: {
          'Not started': pendingCand.filter((c) => !activeCand.has(c.id) && !c.link_sent_at).length,
          'Link sent': pendingCand.filter((c) => !activeCand.has(c.id) && c.link_sent_at).length,
          Booked: activeCand.size,
          Done: candList.length - pendingCand.length,
        },
      });
    })();
  }, [L]);

  if (!data) return <Spinner />;

  return (
    <>
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Needs attention</h2>
        {data.items.length === 0 ? (
          <Card className="text-sm text-emerald-800">✅ All good – nothing needs your attention right now.</Card>
        ) : (
          <div className="space-y-2">
            {data.items.map((i) => (
              <Link
                key={i.key}
                to={i.to}
                className={`flex items-center gap-3 rounded-xl border bg-white p-3 text-sm ${i.tone === 'rose' ? 'border-rose-300' : 'border-amber-300'}`}
              >
                <span className="text-xl">{i.icon}</span>
                <span className="flex-1">{i.text}</span>
                <span className="text-stone-400">›</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Interviews this week</h2>
          <Link to="/interviews" className="text-sm text-orange-800">
            All candidates ›
          </Link>
        </div>
        <div className="mb-3 grid grid-cols-4 gap-2 text-center">
          {Object.entries(data.pipeline).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white p-2 shadow-sm">
              <div className="text-xl font-bold">{v}</div>
              <div className="text-[11px] text-stone-500">{k}</div>
            </div>
          ))}
        </div>
        {data.week.length === 0 ? (
          <Card className="text-sm text-stone-500">No interviews in the next 7 days.</Card>
        ) : (
          <div className="space-y-2">
            {data.week.map((b) => {
              const cal = calendarLabel(b.calendar_status);
              const meet = safeUrl(b.meeting_link);
              return (
                <Card key={b.id} className="!p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-stone-500">
                        {fmtDay(istDate(b.starts_at))} · <b className="text-stone-800">{fmtTime(b.starts_at)}</b>
                      </div>
                      <div className="truncate font-medium">{b.candidates.full_name}</div>
                      <div className="truncate text-xs text-stone-500">
                        with {b.people.full_name}
                        {b.candidates.language && ` · ${b.candidates.language}`}
                        {(b.candidates.region || b.candidates.city) && ` · ${b.candidates.region || b.candidates.city}`}
                      </div>
                    </div>
                    {meet && (
                      <a href={meet} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-orange-800 px-2.5 py-1.5 text-xs font-medium text-white">
                        🎥 Meet
                      </a>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge c={b.acknowledged_at ? 'emerald' : 'amber'}>{b.acknowledged_at ? '✓ Ishanga confirmed' : 'Awaiting Ishanga'}</Badge>
                    {cal && <Badge c={cal.color}>{cal.text}</Badge>}
                    {!meet && <Badge c="rose">No Meet link</Badge>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

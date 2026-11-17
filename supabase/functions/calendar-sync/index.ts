// Supabase Edge Function: keeps Google Calendar in sync with interview_bookings.
// Triggered by a Database Webhook (INSERT/UPDATE on public.interview_bookings).
// Creates two separate events so the candidate never sees the interviewer's identity:
//   - one for the Ishanga (with candidate details)
//   - one for the candidate (time + Meet link only)
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
const CALENDAR_ID = Deno.env.get('GOOGLE_CALENDAR_ID') ?? 'primary';
const TZ = 'Asia/Kolkata';
const WATCHED = ['status', 'acknowledged_at', 'person_id', 'starts_at', 'ends_at', 'meeting_link'] as const;

type Booking = {
  id: string;
  candidate_id: string;
  person_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  meeting_link: string | null;
  acknowledged_at: string | null;
  cal_event_ishanga: string | null;
  cal_event_candidate: string | null;
} & Record<string, unknown>;

let cachedToken: { value: string; exp: number } | null = null;
async function accessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Google sign-in failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cachedToken.value;
}

async function gcal(method: 'POST' | 'PATCH' | 'DELETE', eventId: string | null, body?: unknown, sendUpdates: 'all' | 'none' = 'all') {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events${eventId ? '/' + encodeURIComponent(eventId) : ''}?sendUpdates=${sendUpdates}`;
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'DELETE' && (r.status === 404 || r.status === 410)) return null;
  if (!r.ok) throw new Error(`Google Calendar ${method} failed: ${r.status} ${await r.text()}`);
  return method === 'DELETE' ? null : await r.json();
}

const reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 30 }] };

async function sync(b: Booking, old: Booking | null) {
  const changed = (k: string) => !old || old[k] !== b[k];
  if (old && !WATCHED.some(changed)) return 'no relevant change';
  if (!old && b.status !== 'booked') return 'ignored';

  let ish = b.cal_event_ishanga;
  let cand = b.cal_event_candidate;
  const notes: string[] = [];
  const cancelled = b.status === 'cancelled';
  const live = b.status === 'booked' && !!b.acknowledged_at;
  const timeOrLink = changed('starts_at') || changed('ends_at') || changed('meeting_link');

  // Ishanga event: removed on cancel, reassignment or un-confirm (a new one is created when the new Ishanga confirms)
  if (ish && (cancelled || changed('person_id') || !b.acknowledged_at)) {
    await gcal('DELETE', ish);
    ish = null;
  }
  if (cand && cancelled) {
    await gcal('DELETE', cand);
    cand = null;
  }

  if (b.status === 'booked' && (live || cand)) {
    const [{ data: c }, { data: p }] = await Promise.all([
      sb.from('candidates').select('*, ishanga_types(name)').eq('id', b.candidate_id).single(),
      sb.from('people').select('full_name, email').eq('id', b.person_id).single(),
    ]);
    const training = c?.ishanga_types?.name ?? 'Ishanga';
    const link = b.meeting_link ?? '';
    const when = { start: { dateTime: b.starts_at, timeZone: TZ }, end: { dateTime: b.ends_at, timeZone: TZ } };

    const ishBody = {
      summary: `Interview: ${c.full_name} (${training} training)`,
      location: link,
      description: [
        link && `Google Meet: ${link}`,
        '',
        `Candidate: ${c.full_name}`,
        `Phone: ${c.phone ?? '-'}`,
        `Region: ${[c.city, c.region].filter(Boolean).join(', ') || '-'}`,
        `Language: ${c.language ?? '-'}`,
        `Training: ${training}`,
        c.notes && `Notes: ${c.notes}`,
      ]
        .filter((x) => x !== null && x !== undefined && x !== false)
        .join('\n'),
      ...when,
      attendees: p?.email ? [{ email: p.email }] : [],
      reminders,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
    };
    const candBody = {
      summary: `${training} training interview`,
      location: link,
      description: [
        link ? `Join on Google Meet: ${link}` : 'You will receive a call at this time.',
        '',
        'Please join 5 minutes early from a quiet place with good network.',
        'To change the time, use the booking link you received.',
      ].join('\n'),
      ...when,
      attendees: c?.email ? [{ email: c.email }] : [],
      reminders,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
    };

    if (live) {
      if (!ish) {
        if (p?.email) ish = (await gcal('POST', null, ishBody)).id;
        else notes.push('Ishanga has no email');
      } else if (timeOrLink) await gcal('PATCH', ish, ishBody);

      if (!cand) {
        if (c?.email) cand = (await gcal('POST', null, candBody)).id;
        else notes.push('Candidate has no email');
      }
    }
    // Candidate event is updated silently when only the link changes (e.g. interviewer swapped)
    if (cand && old && timeOrLink) await gcal('PATCH', cand, candBody, changed('starts_at') ? 'all' : 'none');
  }

  const status = notes.length ? `partial: ${notes.join('; ')}` : ish || cand ? 'sent' : null;
  await sb
    .from('interview_bookings')
    .update({ cal_event_ishanga: ish, cal_event_candidate: cand, calendar_status: status, calendar_synced_at: new Date().toISOString() })
    .eq('id', b.id);
  return status ?? 'nothing to do';
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== env('WEBHOOK_SECRET')) return new Response('Unauthorized', { status: 401 });
  const { type, table, record, old_record } = await req.json();
  if (table !== 'interview_bookings' || !record || (type !== 'INSERT' && type !== 'UPDATE')) return new Response('ignored');
  try {
    return Response.json({ result: await sync(record, old_record ?? null) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Only bookkeeping columns change here, so this does not re-trigger a sync loop
    await sb.from('interview_bookings').update({ calendar_status: `error: ${msg.slice(0, 300)}` }).eq('id', record.id);
    return new Response(msg, { status: 500 });
  }
});

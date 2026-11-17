import type { ActivityStatus, AssignmentStatus, CandidateResult } from './types';

export const COLORS: Record<string, { badge: string; dot: string; border: string }> = {
  orange: { badge: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', border: 'border-l-orange-500' },
  emerald: { badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', border: 'border-l-emerald-500' },
  sky: { badge: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500', border: 'border-l-sky-500' },
  violet: { badge: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500', border: 'border-l-violet-500' },
  rose: { badge: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500', border: 'border-l-rose-500' },
  amber: { badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', border: 'border-l-amber-500' },
  teal: { badge: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500', border: 'border-l-teal-500' },
  indigo: { badge: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500', border: 'border-l-indigo-500' },
  stone: { badge: 'bg-stone-200 text-stone-800', dot: 'bg-stone-500', border: 'border-l-stone-500' },
};

export const color = (c: string | undefined) => COLORS[c ?? ''] ?? COLORS.stone;

export const ACTIVITY_STATUS: Record<ActivityStatus, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'sky' },
  confirmed: { label: 'Confirmed', color: 'emerald' },
  completed: { label: 'Completed', color: 'stone' },
  cancelled: { label: 'Cancelled', color: 'rose' },
};

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; color: string }> = {
  opted_in: { label: 'Opted in', color: 'amber' },
  confirmed: { label: 'Confirmed', color: 'emerald' },
  completed: { label: 'Completed', color: 'stone' },
  declined: { label: 'Declined', color: 'rose' },
  cancelled: { label: 'Cancelled', color: 'rose' },
};

export const CANDIDATE_RESULT: Record<CandidateResult, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'amber' },
  selected: { label: 'Selected', color: 'emerald' },
  not_selected: { label: 'Not selected', color: 'rose' },
  on_hold: { label: 'On hold', color: 'sky' },
  withdrawn: { label: 'Withdrawn', color: 'stone' },
};

// Statuses that count as "involved" in an activity
export const ACTIVE_ASSIGNMENT: AssignmentStatus[] = ['opted_in', 'confirmed', 'completed'];

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const addDaysISO = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : '';

export const fmtRange = (start: string, end: string | null) =>
  end && end !== start ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start);

export const errMsg = (e: unknown) =>
  e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e);

/** Only https links are rendered as clickable (blocks javascript: etc.). */
export const safeUrl = (u: string | null | undefined) => (u && /^https:\/\//i.test(u.trim()) ? u.trim() : null);

export const calendarLabel = (s: string | null | undefined) =>
  !s ? null : s === 'sent' ? { text: '📅 Calendar invites sent', color: 'emerald' } : s.startsWith('partial') ? { text: `📅 ${s.replace('partial: ', '')}`, color: 'amber' } : { text: '⚠ Calendar invite failed', color: 'rose' };

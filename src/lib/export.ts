import { supabase } from './supabase';
import type { Activity, ActivityRole, ActivityType, AppRole, Assignment, Availability, Booking, Candidate, IshangaAttribute, IshangaType, PersonWithTags, RoleEligibility } from './types';
import { fmtSlot, fmtTime } from './time';

// Supabase returns max 1000 rows per request, so page through everything.
async function fetchAll<T>(table: string, select = '*'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function exportAllToExcel() {
  const [types, attrs, aTypes, roles, elig, people, acts, asg, cands, appRoles, bookings, avail] = await Promise.all([
    fetchAll<IshangaType>('ishanga_types'),
    fetchAll<IshangaAttribute>('ishanga_attributes'),
    fetchAll<ActivityType>('activity_types'),
    fetchAll<ActivityRole>('activity_roles'),
    fetchAll<RoleEligibility>('activity_role_eligibility'),
    fetchAll<PersonWithTags>('people', '*, person_types(type_id), person_attributes(attribute_id)'),
    fetchAll<Activity>('activities'),
    fetchAll<Assignment>('assignments'),
    fetchAll<Candidate>('candidates'),
    fetchAll<AppRole>('app_roles'),
    fetchAll<Booking>('interview_bookings').catch(() => [] as Booking[]),
    fetchAll<Availability>('interviewer_availability').catch(() => [] as Availability[]),
  ]);

  const name = <T extends { id: string; name: string }>(list: T[]) => {
    const m = new Map(list.map((x) => [x.id, x.name]));
    return (id: string | null | undefined) => (id ? m.get(id) ?? '' : '');
  };
  const typeName = name(types);
  const attrName = name(attrs);
  const aTypeName = name(aTypes);
  const roleName = name(roles);
  const personName = name(people.map((p) => ({ id: p.id, name: p.full_name })));
  const actById = new Map(acts.map((a) => [a.id, a]));

  // exceljs ships a CJS/UMD bundle, so the classes may live on `default` depending on the bundler
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sheet = (title: string, rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(title);
    const cols = rows.length ? Object.keys(rows[0]) : ['(empty)'];
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }));
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };

  sheet(
    'People',
    people.map((p) => ({
      Name: p.full_name,
      Phone: p.phone,
      Email: p.email,
      City: p.city,
      Center: p.center,
      Region: p.region,
      Languages: (p.languages ?? []).join(', '),
      Active: p.is_active ? 'Yes' : 'No',
      'Ishanga Types': p.person_types.map((t) => typeName(t.type_id)).join(', '),
      Attributes: p.person_attributes.map((a) => attrName(a.attribute_id)).join(', '),
      Notes: p.notes,
    })),
  );

  sheet(
    'Schedule History',
    asg
      .map((s) => {
        const a = actById.get(s.activity_id);
        return {
          Date: a?.start_date,
          'End Date': a?.end_date,
          Activity: a?.title,
          'Activity Type': aTypeName(a?.activity_type_id),
          City: a?.city,
          Region: a?.region,
          Person: personName(s.person_id),
          Role: roleName(s.role_id),
          Status: s.status,
          Notes: s.notes,
          'Recorded At': s.created_at,
        };
      })
      .sort((x, y) => String(y.Date).localeCompare(String(x.Date))),
  );

  sheet(
    'Activities',
    acts
      .sort((x, y) => y.start_date.localeCompare(x.start_date))
      .map((a) => ({
        Date: a.start_date,
        'End Date': a.end_date,
        Time: a.start_time,
        Title: a.title,
        Type: aTypeName(a.activity_type_id),
        Location: a.location,
        City: a.city,
        Region: a.region,
        Status: a.status,
        'Opt-in Open': a.opt_in_open ? 'Yes' : 'No',
        'People Assigned': asg.filter((s) => s.activity_id === a.id).length,
        Notes: a.notes,
      })),
  );

  sheet(
    'Interview Candidates',
    cands.map((c) => ({
      Name: c.full_name,
      Phone: c.phone,
      Email: c.email,
      City: c.city,
      Region: c.region,
      Language: c.language,
      'Linked Person': personName(c.person_id),
      'Training For': typeName(c.target_type_id),
      'Interview Date': c.activity_id ? actById.get(c.activity_id)?.start_date : '',
      Result: c.result,
      'Link Sent': c.link_sent_at,
      'Requested Times': c.requested_times,
      Notes: c.notes,
    })),
  );

  const candName = name(cands.map((c) => ({ id: c.id, name: c.full_name })));
  sheet(
    'Interview Bookings',
    bookings
      .sort((x, y) => y.starts_at.localeCompare(x.starts_at))
      .map((b) => ({
        When: fmtSlot(b.starts_at),
        Candidate: candName(b.candidate_id),
        Interviewer: personName(b.person_id),
        Status: b.status,
        'Booked By': b.booked_by,
        'Interviewer Confirmed': b.acknowledged_at ? 'Yes' : 'No',
        'Cancelled By': b.cancelled_by,
        'Cancel Reason': b.cancelled_reason,
        'Meeting Link': b.meeting_link,
      })),
  );
  sheet(
    'Interviewer Availability',
    avail
      .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
      .map((a) => ({ Person: personName(a.person_id), From: fmtSlot(a.starts_at), To: fmtTime(a.ends_at) })),
  );

  sheet('Ishanga Types', types.map((t) => ({ Name: t.name, Description: t.description, Prerequisite: typeName(t.prerequisite_type_id) })));
  sheet('Attributes', attrs.map((a) => ({ Name: a.name, Description: a.description })));
  sheet(
    'Activity Roles',
    roles.map((r) => ({
      'Activity Type': aTypeName(r.activity_type_id),
      Role: r.name,
      Capacity: r.default_capacity,
      'Self Opt-in': r.allow_self_opt_in ? 'Yes' : 'No',
      'Eligible Types': elig.filter((e) => e.role_id === r.id).map((e) => typeName(e.type_id)).join(', ') || 'Anyone',
    })),
  );
  sheet('App Roles', appRoles.map((r) => ({ Name: r.name, Description: r.description, Permissions: r.permissions.join(', ') })));

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ishanga-scheduler-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

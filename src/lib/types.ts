export const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'admin', label: 'Admin (everything)' },
  { key: 'view', label: 'View people & activities' },
  { key: 'view_dashboard', label: 'See central dashboard' },
  { key: 'opt_in', label: 'Opt in to activities (self)' },
  { key: 'manage_people', label: 'Manage people' },
  { key: 'manage_activities', label: 'Manage activities & scheduling' },
  { key: 'manage_settings', label: 'Manage settings (types, attributes, activity types)' },
  { key: 'manage_users', label: 'Manage users & app roles' },
  { key: 'export', label: 'Export to Excel' },
];

export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_default: boolean;
}

export interface IshangaType {
  id: string;
  name: string;
  description: string | null;
  prerequisite_type_id: string | null;
  sort_order: number;
}

export interface IshangaAttribute {
  id: string;
  name: string;
  description: string | null;
}

export interface ActivityType {
  id: string;
  name: string;
  description: string | null;
  color: string;
  has_candidates: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ActivityRole {
  id: string;
  activity_type_id: string;
  name: string;
  description: string | null;
  default_capacity: number | null;
  allow_self_opt_in: boolean;
  sort_order: number;
}

export interface RoleEligibility {
  role_id: string;
  type_id: string;
}

export interface Person {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  center: string | null;
  region: string;
  is_active: boolean;
  notes: string | null;
  languages: string[];
  meet_link: string | null;
  created_at: string;
}

export interface PersonWithTags extends Person {
  person_types: { type_id: string }[];
  person_attributes: { attribute_id: string }[];
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  person_id: string | null;
}

export type ActivityStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled';

export interface Activity {
  id: string;
  activity_type_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  city: string | null;
  region: string;
  status: ActivityStatus;
  opt_in_open: boolean;
  notes: string | null;
  created_at: string;
}

export type AssignmentStatus = 'opted_in' | 'confirmed' | 'completed' | 'declined' | 'cancelled';

export interface Assignment {
  id: string;
  activity_id: string;
  person_id: string;
  role_id: string;
  status: AssignmentStatus;
  notes: string | null;
  created_at: string;
}

export type CandidateResult = 'pending' | 'selected' | 'not_selected' | 'on_hold' | 'withdrawn';

export interface Candidate {
  id: string;
  activity_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  person_id: string | null;
  target_type_id: string;
  result: CandidateResult;
  notes: string | null;
  region: string | null;
  language: string | null;
  booking_token: string;
  booking_open: boolean;
  link_sent_at: string | null;
  requested_times: string | null;
  requested_at: string | null;
  created_at: string;
}

export interface Availability {
  id: string;
  person_id: string;
  starts_at: string;
  ends_at: string;
}

export type BookingStatus = 'booked' | 'completed' | 'cancelled' | 'no_show';

export interface Booking {
  id: string;
  candidate_id: string;
  person_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  booked_by: 'candidate' | 'coordinator';
  meeting_link: string | null;
  activity_id: string | null;
  acknowledged_at: string | null;
  cancelled_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cal_event_ishanga: string | null;
  cal_event_candidate: string | null;
  calendar_status: string | null;
  created_at: string;
}

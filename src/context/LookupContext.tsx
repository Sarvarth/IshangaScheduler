import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { ActivityRole, ActivityType, IshangaAttribute, IshangaType, RoleEligibility } from '../lib/types';

interface Lookups {
  loaded: boolean;
  ishangaTypes: IshangaType[];
  attributes: IshangaAttribute[];
  activityTypes: ActivityType[];
  roles: ActivityRole[];
  eligibility: RoleEligibility[];
  typeById: Map<string, IshangaType>;
  attributeById: Map<string, IshangaAttribute>;
  activityTypeById: Map<string, ActivityType>;
  roleById: Map<string, ActivityRole>;
  rolesForType: (activityTypeId: string) => ActivityRole[];
  eligibleTypeIds: (roleId: string) => string[];
  isEligible: (personTypeIds: string[], roleId: string) => boolean;
  settings: Record<string, string>;
  languages: string[];
  /** Interview activity type's first role, used for interviewer eligibility. */
  interviewRoleId: string | null;
  reload: () => Promise<void>;
}

const LookupContext = createContext<Lookups>(null as unknown as Lookups);

export function LookupProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [ishangaTypes, setTypes] = useState<IshangaType[]>([]);
  const [attributes, setAttributes] = useState<IshangaAttribute[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [roles, setRoles] = useState<ActivityRole[]>([]);
  const [eligibility, setEligibility] = useState<RoleEligibility[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const [t, a, at, r, e, s] = await Promise.all([
      supabase.from('ishanga_types').select('*').order('sort_order').order('name'),
      supabase.from('ishanga_attributes').select('*').order('name'),
      supabase.from('activity_types').select('*').order('sort_order').order('name'),
      supabase.from('activity_roles').select('*').order('sort_order').order('name'),
      supabase.from('activity_role_eligibility').select('*'),
      supabase.from('app_settings').select('key, value'),
    ]);
    setTypes((t.data ?? []) as IshangaType[]);
    setAttributes((a.data ?? []) as IshangaAttribute[]);
    setActivityTypes((at.data ?? []) as ActivityType[]);
    setRoles((r.data ?? []) as ActivityRole[]);
    setEligibility((e.data ?? []) as RoleEligibility[]);
    setSettings(Object.fromEntries(((s.data ?? []) as { key: string; value: string | null }[]).map((x) => [x.key, x.value ?? ''])));
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<Lookups>(() => {
    const eligibleTypeIds = (roleId: string) => eligibility.filter((e) => e.role_id === roleId).map((e) => e.type_id);
    const interviewType = activityTypes.find((t) => t.has_candidates);
    const interviewRole = interviewType ? roles.find((r) => r.activity_type_id === interviewType.id) : undefined;
    return {
      loaded,
      ishangaTypes,
      attributes,
      activityTypes,
      roles,
      eligibility,
      typeById: new Map(ishangaTypes.map((x) => [x.id, x])),
      attributeById: new Map(attributes.map((x) => [x.id, x])),
      activityTypeById: new Map(activityTypes.map((x) => [x.id, x])),
      roleById: new Map(roles.map((x) => [x.id, x])),
      rolesForType: (id) => roles.filter((r) => r.activity_type_id === id),
      eligibleTypeIds,
      isEligible: (personTypeIds, roleId) => {
        const req = eligibleTypeIds(roleId);
        return req.length === 0 || req.some((t) => personTypeIds.includes(t));
      },
      settings,
      languages: (settings.languages ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      interviewRoleId: interviewRole?.id ?? null,
      reload,
    };
  }, [loaded, ishangaTypes, attributes, activityTypes, roles, eligibility, settings, reload]);

  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}

export const useLookups = () => useContext(LookupContext);

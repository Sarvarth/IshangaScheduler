import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COLORS, errMsg } from '../lib/format';
import { exportAllToExcel } from '../lib/export';
import { PERMISSIONS, type ActivityRole, type ActivityType, type AppRole, type IshangaAttribute, type IshangaType, type Person, type Profile } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import { Badge, Button, Card, Checkbox, ChipSelect, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from '../components/ui';

type Tab = 'types' | 'attributes' | 'activities' | 'users' | 'roles' | 'export';

export default function Settings() {
  const { can } = useAuth();
  const tabs = (
    [
      { id: 'activities', label: 'Activity types & roles', show: can('manage_settings') },
      { id: 'types', label: 'Ishanga types', show: can('manage_settings') },
      { id: 'attributes', label: 'Attributes', show: can('manage_settings') },
      { id: 'users', label: 'Users', show: can('manage_users') },
      { id: 'roles', label: 'App roles', show: can('manage_users') },
      { id: 'export', label: 'Export', show: can('export') },
    ] as { id: Tab; label: string; show: boolean }[]
  ).filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'export');

  if (!tabs.length) return <Empty>You do not have access to settings.</Empty>;

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'types' && <IshangaTypes />}
      {tab === 'attributes' && <Attributes />}
      {tab === 'activities' && <ActivityTypes />}
      {tab === 'users' && <Users />}
      {tab === 'roles' && <AppRoles />}
      {tab === 'export' && <ExportTab />}
    </>
  );
}

function useSave() {
  const toast = useToast();
  return async (p: PromiseLike<{ error: unknown }>, ok = 'Saved') => {
    const { error } = await p;
    if (error) {
      toast(errMsg(error), true);
      return false;
    }
    toast(ok);
    return true;
  };
}

// ---------------- Ishanga types ----------------
function IshangaTypes() {
  const L = useLookups();
  const save = useSave();
  const [edit, setEdit] = useState<Partial<IshangaType> | null>(null);

  const submit = async () => {
    if (!edit?.name?.trim()) return;
    const row = { name: edit.name.trim(), description: edit.description || null, prerequisite_type_id: edit.prerequisite_type_id || null, sort_order: edit.sort_order ?? 0 };
    const ok = await save(edit.id ? supabase.from('ishanga_types').update(row).eq('id', edit.id) : supabase.from('ishanga_types').insert(row));
    if (ok) {
      setEdit(null);
      L.reload();
    }
  };
  const del = async (t: IshangaType) => {
    if (confirm(`Delete "${t.name}"? It will be removed from all people and role eligibility.`) && (await save(supabase.from('ishanga_types').delete().eq('id', t.id), 'Deleted'))) L.reload();
  };

  return (
    <>
      <div className="mb-3 flex justify-between gap-2">
        <p className="text-sm text-stone-500">Main Ishanga categories (e.g. SPS, Satsang). A person can hold several.</p>
        <Button onClick={() => setEdit({ sort_order: L.ishangaTypes.length + 1 })}>+ Add</Button>
      </div>
      <div className="space-y-2">
        {L.ishangaTypes.map((t) => (
          <Card key={t.id} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-stone-500">
                {t.description}
                {t.prerequisite_type_id && ` · Training requires: ${L.typeById.get(t.prerequisite_type_id)?.name}`}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => del(t)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Edit Ishanga type' : 'New Ishanga type'}
          footer={<Button onClick={submit}>Save</Button>}
        >
          <Field label="Name">
            <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <Field label="Training prerequisite" hint="Candidates interviewed for this training must already hold this type.">
            <Select value={edit.prerequisite_type_id ?? ''} onChange={(e) => setEdit({ ...edit, prerequisite_type_id: e.target.value || null })}>
              <option value="">None (open to active volunteers)</option>
              {L.ishangaTypes
                .filter((t) => t.id !== edit.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Sort order">
            <Input type="number" value={edit.sort_order ?? 0} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} />
          </Field>
        </Modal>
      )}
    </>
  );
}

// ---------------- Attributes ----------------
function Attributes() {
  const L = useLookups();
  const save = useSave();
  const [edit, setEdit] = useState<Partial<IshangaAttribute> | null>(null);

  const submit = async () => {
    if (!edit?.name?.trim()) return;
    const row = { name: edit.name.trim(), description: edit.description || null };
    const ok = await save(edit.id ? supabase.from('ishanga_attributes').update(row).eq('id', edit.id) : supabase.from('ishanga_attributes').insert(row));
    if (ok) {
      setEdit(null);
      L.reload();
    }
  };
  const del = async (a: IshangaAttribute) => {
    if (confirm(`Delete "${a.name}"? It will be removed from all people.`) && (await save(supabase.from('ishanga_attributes').delete().eq('id', a.id), 'Deleted'))) L.reload();
  };

  return (
    <>
      <div className="mb-3 flex justify-between gap-2">
        <p className="text-sm text-stone-500">Tags like Ashram, Fulltime, Borrowed, IE. Assign any number to a person.</p>
        <Button onClick={() => setEdit({})}>+ Add</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {L.attributes.map((a) => (
          <Card key={a.id} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{a.name}</div>
              {a.description && <div className="text-xs text-stone-500">{a.description}</div>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setEdit(a)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => del(a)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit attribute' : 'New attribute'} footer={<Button onClick={submit}>Save</Button>}>
          <Field label="Name">
            <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
        </Modal>
      )}
    </>
  );
}

// ---------------- Activity types & roles ----------------
function ActivityTypes() {
  const L = useLookups();
  const save = useSave();
  const [editType, setEditType] = useState<Partial<ActivityType> | null>(null);
  const [editRole, setEditRole] = useState<(Partial<ActivityRole> & { eligible: string[] }) | null>(null);

  const submitType = async () => {
    if (!editType?.name?.trim()) return;
    const row = {
      name: editType.name.trim(),
      description: editType.description || null,
      color: editType.color ?? 'orange',
      has_candidates: editType.has_candidates ?? false,
      is_active: editType.is_active ?? true,
      sort_order: editType.sort_order ?? 0,
    };
    const ok = await save(editType.id ? supabase.from('activity_types').update(row).eq('id', editType.id) : supabase.from('activity_types').insert(row));
    if (ok) {
      setEditType(null);
      L.reload();
    }
  };

  const delType = async (t: ActivityType) => {
    if (confirm(`Delete "${t.name}"? This only works if no activities of this type exist — otherwise mark it inactive.`) && (await save(supabase.from('activity_types').delete().eq('id', t.id), 'Deleted')))
      L.reload();
  };

  const submitRole = async () => {
    if (!editRole?.name?.trim() || !editRole.activity_type_id) return;
    const row = {
      activity_type_id: editRole.activity_type_id,
      name: editRole.name.trim(),
      description: editRole.description || null,
      default_capacity: editRole.default_capacity ?? null,
      allow_self_opt_in: editRole.allow_self_opt_in ?? true,
      sort_order: editRole.sort_order ?? 0,
    };
    let id = editRole.id;
    if (id) {
      if (!(await save(supabase.from('activity_roles').update(row).eq('id', id)))) return;
    } else {
      const { data, error } = await supabase.from('activity_roles').insert(row).select('id').single();
      if (error) return save(Promise.resolve({ error }));
      id = data.id as string;
    }
    await supabase.from('activity_role_eligibility').delete().eq('role_id', id);
    if (editRole.eligible.length) {
      const ok = await save(supabase.from('activity_role_eligibility').insert(editRole.eligible.map((type_id) => ({ role_id: id, type_id }))));
      if (!ok) return;
    }
    setEditRole(null);
    L.reload();
  };

  const delRole = async (r: ActivityRole) => {
    if (confirm(`Delete role "${r.name}"? Not possible if people are already assigned to it.`) && (await save(supabase.from('activity_roles').delete().eq('id', r.id), 'Deleted'))) L.reload();
  };

  return (
    <>
      <div className="mb-3 flex justify-between gap-2">
        <p className="text-sm text-stone-500">Define activities and the roles people can take in them, with who is eligible.</p>
        <Button onClick={() => setEditType({ color: 'orange', is_active: true, sort_order: L.activityTypes.length + 1 })}>+ Activity type</Button>
      </div>
      <div className="space-y-3">
        {L.activityTypes.map((t) => (
          <Card key={t.id} className={`border-l-4 ${COLORS[t.color]?.border ?? ''}`}>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">
                  {t.name} {!t.is_active && <Badge c="stone">Inactive</Badge>} {t.has_candidates && <Badge c="violet">Candidates</Badge>}
                </div>
                {t.description && <div className="text-xs text-stone-500">{t.description}</div>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEditType(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => delType(t)}>
                  Delete
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-stone-100">
              {L.rolesForType(t.id).map((r) => {
                const elig = L.eligibleTypeIds(r.id);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-xs text-stone-500">
                        {' · '}
                        {elig.length ? elig.map((e) => L.typeById.get(e)?.name).join(' / ') : 'Anyone'}
                        {r.default_capacity != null && ` · need ${r.default_capacity}`}
                        {!r.allow_self_opt_in && ' · assign only'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditRole({ ...r, eligible: elig })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => delRole(r)}>
                        ✕
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => setEditRole({ activity_type_id: t.id, allow_self_opt_in: true, eligible: [], sort_order: L.rolesForType(t.id).length + 1 })}
            >
              + Role
            </Button>
          </Card>
        ))}
      </div>

      {editType && (
        <Modal open onClose={() => setEditType(null)} title={editType.id ? 'Edit activity type' : 'New activity type'} footer={<Button onClick={submitType}>Save</Button>}>
          <Field label="Name">
            <Input value={editType.name ?? ''} onChange={(e) => setEditType({ ...editType, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={editType.description ?? ''} onChange={(e) => setEditType({ ...editType, description: e.target.value })} />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {Object.entries(COLORS).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEditType({ ...editType, color: k })}
                  className={`h-8 w-8 rounded-full ${v.dot} ${editType.color === k ? 'ring-2 ring-stone-900 ring-offset-2' : ''}`}
                  aria-label={k}
                />
              ))}
            </div>
          </Field>
          <Field label="Sort order">
            <Input type="number" value={editType.sort_order ?? 0} onChange={(e) => setEditType({ ...editType, sort_order: Number(e.target.value) })} />
          </Field>
          <Checkbox label="Tracks candidates (e.g. interviews)" checked={editType.has_candidates ?? false} onChange={(v) => setEditType({ ...editType, has_candidates: v })} />
          <Checkbox label="Active (available for new activities)" checked={editType.is_active ?? true} onChange={(v) => setEditType({ ...editType, is_active: v })} />
        </Modal>
      )}

      {editRole && (
        <Modal open onClose={() => setEditRole(null)} title={editRole.id ? 'Edit role' : 'New role'} footer={<Button onClick={submitRole}>Save</Button>}>
          <Field label="Role name">
            <Input value={editRole.name ?? ''} onChange={(e) => setEditRole({ ...editRole, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={editRole.description ?? ''} onChange={(e) => setEditRole({ ...editRole, description: e.target.value })} />
          </Field>
          <Field label="Eligible Ishanga types" hint="Leave empty to allow anyone, including volunteers.">
            <ChipSelect options={L.ishangaTypes} value={editRole.eligible} onChange={(v) => setEditRole({ ...editRole, eligible: v })} />
          </Field>
          <Field label="People needed per activity" hint="Optional. Used to highlight open slots.">
            <Input
              type="number"
              min={0}
              value={editRole.default_capacity ?? ''}
              onChange={(e) => setEditRole({ ...editRole, default_capacity: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="Sort order">
            <Input type="number" value={editRole.sort_order ?? 0} onChange={(e) => setEditRole({ ...editRole, sort_order: Number(e.target.value) })} />
          </Field>
          <Checkbox label="Ishangas can opt in themselves" checked={editRole.allow_self_opt_in ?? true} onChange={(v) => setEditRole({ ...editRole, allow_self_opt_in: v })} />
        </Modal>
      )}
    </>
  );
}

// ---------------- Users ----------------
function Users() {
  const save = useSave();
  const { profile: me, refresh } = useAuth();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [people, setPeople] = useState<Pick<Person, 'id' | 'full_name'>[]>([]);

  const load = async () => {
    const [u, r, p] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('app_roles').select('*').order('name'),
      supabase.from('people').select('id, full_name').order('full_name'),
    ]);
    setUsers((u.data ?? []) as Profile[]);
    setRoles((r.data ?? []) as AppRole[]);
    setPeople((p.data ?? []) as typeof people);
  };
  useEffect(() => {
    load();
  }, []);

  const update = async (u: Profile, patch: Partial<Profile>) => {
    if (await save(supabase.from('profiles').update(patch).eq('id', u.id))) {
      load();
      if (u.id === me?.id) refresh();
    }
  };

  if (!users) return <Spinner />;
  const linked = new Set(users.map((u) => u.person_id).filter(Boolean));

  return (
    <>
      <p className="mb-3 text-sm text-stone-500">
        People sign in with Google. If their email matches an Ishanga profile they are linked automatically – you only need to give them an app role.
      </p>
      <div className="space-y-2">
        {users.map((u) => (
          <Card key={u.id} className="space-y-2">
            <div>
              <div className="font-medium">
                {u.full_name} {u.id === me?.id && <Badge c="sky">You</Badge>}
              </div>
              <div className="text-xs text-stone-500">{u.email}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="App role">
                <Select value={u.role_id ?? ''} onChange={(e) => update(u, { role_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Linked Ishanga profile">
                <Select value={u.person_id ?? ''} onChange={(e) => update(u, { person_id: e.target.value || null })}>
                  <option value="">— Not linked —</option>
                  {people
                    .filter((p) => p.id === u.person_id || !linked.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

// ---------------- App roles ----------------
function AppRoles() {
  const save = useSave();
  const { refresh } = useAuth();
  const [roles, setRoles] = useState<AppRole[] | null>(null);
  const [edit, setEdit] = useState<Partial<AppRole> | null>(null);

  const load = async () => {
    const { data } = await supabase.from('app_roles').select('*').order('name');
    setRoles((data ?? []) as AppRole[]);
  };
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!edit?.name?.trim()) return;
    const row = { name: edit.name.trim(), description: edit.description || null, permissions: edit.permissions ?? [], is_default: edit.is_default ?? false };
    if (row.is_default) await supabase.from('app_roles').update({ is_default: false }).neq('id', edit.id ?? '00000000-0000-0000-0000-000000000000');
    const ok = await save(edit.id ? supabase.from('app_roles').update(row).eq('id', edit.id) : supabase.from('app_roles').insert(row));
    if (ok) {
      setEdit(null);
      load();
      refresh();
    }
  };

  const del = async (r: AppRole) => {
    if (confirm(`Delete app role "${r.name}"? Users with it will lose access.`) && (await save(supabase.from('app_roles').delete().eq('id', r.id), 'Deleted'))) load();
  };

  if (!roles) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex justify-between gap-2">
        <p className="text-sm text-stone-500">App roles control what each login can see and do.</p>
        <Button onClick={() => setEdit({ permissions: ['view'] })}>+ Add</Button>
      </div>
      <div className="space-y-2">
        {roles.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {r.name} {r.is_default && <Badge c="amber">Default for sign-ups</Badge>}
                </div>
                {r.description && <div className="text-xs text-stone-500">{r.description}</div>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => del(r)}>
                  Delete
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {r.permissions.length === 0 && <span className="text-xs text-stone-400">No access</span>}
              {r.permissions.map((p) => (
                <Badge key={p} c="stone">
                  {PERMISSIONS.find((x) => x.key === p)?.label ?? p}
                </Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit app role' : 'New app role'} footer={<Button onClick={submit}>Save</Button>}>
          <Field label="Name">
            <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <Field label="Permissions">
            <div className="space-y-2">
              {PERMISSIONS.map((p) => (
                <Checkbox
                  key={p.key}
                  label={p.label}
                  checked={edit.permissions?.includes(p.key) ?? false}
                  onChange={(v) => setEdit({ ...edit, permissions: v ? [...(edit.permissions ?? []), p.key] : (edit.permissions ?? []).filter((x) => x !== p.key) })}
                />
              ))}
            </div>
          </Field>
          <Checkbox label="Default role for new sign-ups" checked={edit.is_default ?? false} onChange={(v) => setEdit({ ...edit, is_default: v })} />
        </Modal>
      )}
    </>
  );
}

// ---------------- Export ----------------
function ExportTab() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <p className="text-sm text-stone-600">
        Download everything as an Excel workbook: people, full schedule history, activities, interview candidates and all settings.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await exportAllToExcel();
          } catch (e) {
            toast(errMsg(e), true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Exporting…' : 'Download Excel'}
      </Button>
    </Card>
  );
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.TEST_USER_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !password) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and TEST_USER_PASSWORD before running this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const testUsers = [
  { email: 'ishanga-scheduler-test-admin@example.com', fullName: 'Test Admin', role: 'Admin' },
  { email: 'ishanga-scheduler-test-coordinator@example.com', fullName: 'Test Coordinator', role: 'Coordinator' },
  { email: 'ishanga-scheduler-test-viewer@example.com', fullName: 'Test Dashboard Viewer', role: 'Dashboard Viewer' },
  { email: 'ishanga-scheduler-test-ishanga@example.com', fullName: 'Test Ishanga', role: 'Ishanga' },
  { email: 'ishanga-scheduler-test-pending@example.com', fullName: 'Test Pending User', role: 'Pending' },
];

function requireData({ data, error }) {
  if (error) throw error;
  return data;
}

async function main() {
  const defaultRoles = [
    { name: 'Admin', description: 'Full access', permissions: ['admin'], is_default: false },
    {
      name: 'Coordinator',
      description: 'Manages people, activities and scheduling',
      permissions: ['view', 'view_dashboard', 'opt_in', 'manage_people', 'manage_activities', 'export'],
      is_default: false,
    },
    { name: 'Dashboard Viewer', description: 'Read-only access with dashboard and export', permissions: ['view', 'view_dashboard', 'export'], is_default: false },
    { name: 'Ishanga', description: 'Can view activities and opt in for themselves', permissions: ['view', 'opt_in'], is_default: false },
    { name: 'Pending', description: 'New sign-up awaiting approval', permissions: [], is_default: true },
  ];
  const { error: seedError } = await supabase.from('app_roles').upsert(defaultRoles, {
    onConflict: 'name',
    ignoreDuplicates: true,
  });
  if (seedError) throw seedError;

  const roleRows = requireData(await supabase.from('app_roles').select('id, name'));
  const roleIds = new Map(roleRows.map((role) => [role.name, role.id]));
  for (const user of testUsers) {
    if (!roleIds.has(user.role)) throw new Error(`Missing app role: ${user.role}. Run supabase/schema.sql first.`);
  }

  const { data: userPage, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const usersByEmail = new Map(userPage.users.map((user) => [user.email?.toLowerCase(), user]));
  const createdUsers = new Map();

  for (const testUser of testUsers) {
    const existing = usersByEmail.get(testUser.email);
    const result = existing
      ? await supabase.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: { full_name: testUser.fullName },
        })
      : await supabase.auth.admin.createUser({
          email: testUser.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: testUser.fullName },
        });
    const authUser = requireData(result).user;
    createdUsers.set(testUser.email, { ...testUser, id: authUser.id });
  }

  const ishanga = createdUsers.get('ishanga-scheduler-test-ishanga@example.com');
  const profile = requireData(
    await supabase.from('profiles').select('person_id').eq('id', ishanga.id).maybeSingle(),
  );
  let personId = profile?.person_id;

  if (!personId) {
    const person = requireData(
      await supabase
        .from('people')
        .insert({
          full_name: ishanga.fullName,
          email: ishanga.email,
          region: 'North Bharat',
          is_active: true,
          notes: 'Test account created by demo/create-test-users.mjs',
        })
        .select('id')
        .single(),
    );
    personId = person.id;
  }

  const { data: types, error: typesError } = await supabase.from('ishanga_types').select('id');
  if (typesError) throw typesError;
  if (types.length) {
    const { error } = await supabase.from('person_types').upsert(
      types.map((type) => ({ person_id: personId, type_id: type.id })),
      { onConflict: 'person_id,type_id', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  for (const testUser of testUsers) {
    const authUser = createdUsers.get(testUser.email);
    const { error } = await supabase.from('profiles').upsert({
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.fullName,
      role_id: roleIds.get(authUser.role),
      person_id: authUser.role === 'Ishanga' ? personId : null,
    });
    if (error) throw error;
    console.log(`${authUser.role}: ${authUser.email}`);
  }

  console.log('\nAll test accounts use the password supplied in TEST_USER_PASSWORD.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
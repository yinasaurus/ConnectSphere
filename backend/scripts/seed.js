require('dotenv').config();

const bcrypt = require('bcryptjs');
const { supabase, throwIf, insertOne, insertMany } = require('../src/config/db');
const { BCRYPT_ROUNDS } = require('../src/constants/auth');

const PASSWORD = 'Password123!';

const CLEAR_ORDER = [
  'notifications',
  'audit_logs',
  'registrations',
  'equipment_reservations',
  'equipment_requests',
  'venue_bookings',
  'event_documents',
  'event_comments',
  'event_sessions',
  'event_status_history',
  'coordinator_reassignments',
  'events',
  'venue_unavailability',
  'venue_layouts',
  'equipment',
  'venues',
  'user_roles',
  'users',
  'organisations',
];

async function clear(table) {
  const { error } = await supabase.from(table).delete().gte('id', 0);
  throwIf(error);
}

async function seed() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env. ' +
      'The publishable/anon key is not enough — use the service_role secret from Settings → API. ' +
      'Also run supabase/schema.sql in the SQL editor first.'
    );
  }

  for (const table of CLEAR_ORDER) {
    await clear(table);
  }

  const hash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  const acme = await insertOne('organisations', {
    name: 'Acme Holdings',
    industry: 'Finance',
    contact_email: 'events@acme.example',
    phone: '+65 6000 1000',
  });
  const apex = await insertOne('organisations', {
    name: 'Apex Learning',
    industry: 'Education',
    contact_email: 'hello@apex.example',
    phone: '+65 6000 2000',
  });

  const users = [
    { email: 'organiser@acme.example', full_name: 'Aisha Rahman', organisation_id: acme.id, department: null, roles: ['EVENT_ORGANISER'] },
    { email: 'organiser@apex.example', full_name: 'Ben Tan', organisation_id: apex.id, department: null, roles: ['EVENT_ORGANISER'] },
    { email: 'coordinator@connectsphere.sg', full_name: 'Chloe Lim', organisation_id: null, department: 'Event Operations', roles: ['EVENT_COORDINATOR'] },
    { email: 'coordinator2@connectsphere.sg', full_name: 'Daniel Ong', organisation_id: null, department: 'Event Operations', roles: ['EVENT_COORDINATOR'] },
    { email: 'venue@connectsphere.sg', full_name: 'Elena Wong', organisation_id: null, department: 'Venues', roles: ['VENUE_STAFF'] },
    { email: 'tech@connectsphere.sg', full_name: 'Farid Hassan', organisation_id: null, department: 'Technical Support', roles: ['TECHNICAL_SUPPORT'] },
    { email: 'hybrid@connectsphere.sg', full_name: 'Gina Koh', organisation_id: null, department: 'Operations', roles: ['EVENT_COORDINATOR', 'VENUE_STAFF'] },
    { email: 'attendee@example.com', full_name: 'Hari Patel', organisation_id: null, department: null, roles: ['ATTENDEE'] },
  ];

  const userIds = {};
  for (const user of users) {
    const created = await insertOne('users', {
      email: user.email,
      password_hash: hash,
      full_name: user.full_name,
      organisation_id: user.organisation_id,
      department: user.department,
      communication_preference: 'IN_APP',
      is_active: true,
    });
    userIds[user.email] = created.id;
    await insertMany('user_roles', user.roles.map((role) => ({ user_id: created.id, role })));
  }

  const hall = await insertOne('venues', {
    name: 'Helix Hall',
    location: 'ConnectSphere Campus, Level 2',
    capacity: 180,
    facilities: 'Projector, lecture capture, hearing loop, stage',
    accessibility: 'Wheelchair access, accessible washrooms, lift',
    operating_hours: '08:00-22:00',
    setup_minutes: 45,
    teardown_minutes: 30,
  });
  const board = await insertOne('venues', {
    name: 'Orchid Boardroom',
    location: 'ConnectSphere Campus, Level 8',
    capacity: 16,
    facilities: 'Video conferencing, whiteboard, catering pantry',
    accessibility: 'Wheelchair access, lift',
    operating_hours: '08:00-20:00',
    setup_minutes: 15,
    teardown_minutes: 15,
  });
  const studio = await insertOne('venues', {
    name: 'Studio 3',
    location: 'ConnectSphere Campus, Basement 1',
    capacity: 60,
    facilities: 'PA system, lighting rig, hybrid camera kit',
    accessibility: 'Limited step-free access',
    operating_hours: '09:00-21:00',
    setup_minutes: 60,
    teardown_minutes: 45,
  });

  await insertMany('venue_layouts', [
    { venue_id: hall.id, layout: 'THEATRE' },
    { venue_id: hall.id, layout: 'CLASSROOM' },
    { venue_id: hall.id, layout: 'EXHIBITION' },
    { venue_id: board.id, layout: 'BOARDROOM' },
    { venue_id: studio.id, layout: 'THEATRE' },
    { venue_id: studio.id, layout: 'BANQUET' },
  ]);

  await insertOne('venue_unavailability', {
    venue_id: studio.id,
    reason: 'Lighting rig maintenance',
    start_at: '2026-10-01T00:00:00.000Z',
    end_at: '2026-10-03T23:59:59.000Z',
    created_by: userIds['venue@connectsphere.sg'],
  });

  await insertMany('equipment', [
    { name: 'Wireless handheld mic', type: 'AUDIO', description: 'Shure handheld microphone', quantity: 8, location: 'Tech store B1', status: 'AVAILABLE' },
    { name: 'Hybrid camera kit', type: 'VIDEO', description: 'PTZ camera + capture card', quantity: 3, location: 'Studio cage', status: 'AVAILABLE' },
    { name: 'Lectern with confidence monitor', type: 'STAGING', quantity: 2, location: 'Helix store', status: 'AVAILABLE' },
    { name: 'Portable hearing loop', type: 'ACCESSIBILITY', quantity: 1, location: 'Tech store B1', status: 'MAINTENANCE' },
  ]);

  await insertOne('events', {
    organisation_id: acme.id,
    organiser_id: userIds['organiser@acme.example'],
    coordinator_id: userIds['coordinator@connectsphere.sg'],
    name: 'Acme Q4 Leadership Forum',
    description: 'Closed-door leadership briefing with a hybrid overflow option.',
    purpose: 'Internal leadership alignment',
    category: 'CONFERENCE',
    status: 'PLANNING',
    start_at: '2026-11-12T09:00:00.000Z',
    end_at: '2026-11-12T17:00:00.000Z',
    expected_attendance: 120,
    accessibility_needs: 'Wheelchair access and reserved front-row seating',
    layout_preference: 'THEATRE',
    venue_requirements: 'Large hall with stage and hybrid cameras',
    equipment_notes: '2 handheld mics, 1 hybrid camera kit',
    special_requests: 'Quiet room for overflow attendees',
    registration_required: true,
    registration_capacity: 120,
  });

  console.log('Seeded ConnectSphere demo data in Supabase.');
  console.log('Password for every demo user:', PASSWORD);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

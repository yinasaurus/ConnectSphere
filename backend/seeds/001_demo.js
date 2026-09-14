const bcrypt = require('bcryptjs');

const PASSWORD = 'Password123!';

exports.seed = async function seed(knex) {
  await knex('notifications').del();
  await knex('audit_logs').del();
  await knex('registrations').del();
  await knex('equipment_reservations').del();
  await knex('equipment_requests').del();
  await knex('venue_bookings').del();
  await knex('event_documents').del();
  await knex('event_comments').del();
  await knex('event_sessions').del();
  await knex('event_status_history').del();
  await knex('coordinator_reassignments').del();
  await knex('events').del();
  await knex('venue_unavailability').del();
  await knex('venue_layouts').del();
  await knex('equipment').del();
  await knex('venues').del();
  await knex('user_roles').del();
  await knex('users').del();
  await knex('organisations').del();

  const hash = await bcrypt.hash(PASSWORD, 10);

  const [acmeId] = await knex('organisations').insert({
    name: 'Acme Holdings',
    industry: 'Finance',
    contact_email: 'events@acme.example',
    phone: '+65 6000 1000',
  });

  const [apexId] = await knex('organisations').insert({
    name: 'Apex Learning',
    industry: 'Education',
    contact_email: 'hello@apex.example',
    phone: '+65 6000 2000',
  });

  const users = [
    {
      email: 'organiser@acme.example',
      full_name: 'Aisha Rahman',
      organisation_id: acmeId,
      department: null,
      roles: ['EVENT_ORGANISER'],
    },
    {
      email: 'organiser@apex.example',
      full_name: 'Ben Tan',
      organisation_id: apexId,
      department: null,
      roles: ['EVENT_ORGANISER'],
    },
    {
      email: 'coordinator@connectsphere.sg',
      full_name: 'Chloe Lim',
      organisation_id: null,
      department: 'Event Operations',
      roles: ['EVENT_COORDINATOR'],
    },
    {
      email: 'coordinator2@connectsphere.sg',
      full_name: 'Daniel Ong',
      organisation_id: null,
      department: 'Event Operations',
      roles: ['EVENT_COORDINATOR'],
    },
    {
      email: 'venue@connectsphere.sg',
      full_name: 'Elena Wong',
      organisation_id: null,
      department: 'Venues',
      roles: ['VENUE_STAFF'],
    },
    {
      email: 'tech@connectsphere.sg',
      full_name: 'Farid Hassan',
      organisation_id: null,
      department: 'Technical Support',
      roles: ['TECHNICAL_SUPPORT'],
    },
    {
      email: 'hybrid@connectsphere.sg',
      full_name: 'Gina Koh',
      organisation_id: null,
      department: 'Operations',
      roles: ['EVENT_COORDINATOR', 'VENUE_STAFF'],
    },
    {
      email: 'attendee@example.com',
      full_name: 'Hari Patel',
      organisation_id: null,
      department: null,
      roles: ['ATTENDEE'],
    },
  ];

  const userIds = {};
  for (const user of users) {
    const [id] = await knex('users').insert({
      email: user.email,
      password_hash: hash,
      full_name: user.full_name,
      organisation_id: user.organisation_id,
      department: user.department,
      communication_preference: 'IN_APP',
      is_active: true,
    });
    userIds[user.email] = id;
    await knex('user_roles').insert(user.roles.map((role) => ({ user_id: id, role })));
  }

  const [hallId] = await knex('venues').insert({
    name: 'Helix Hall',
    location: 'ConnectSphere Campus, Level 2',
    capacity: 180,
    facilities: 'Projector, lecture capture, hearing loop, stage',
    accessibility: 'Wheelchair access, accessible washrooms, lift',
    operating_hours: '08:00-22:00',
    setup_minutes: 45,
    teardown_minutes: 30,
  });
  const [boardId] = await knex('venues').insert({
    name: 'Orchid Boardroom',
    location: 'ConnectSphere Campus, Level 8',
    capacity: 16,
    facilities: 'Video conferencing, whiteboard, catering pantry',
    accessibility: 'Wheelchair access, lift',
    operating_hours: '08:00-20:00',
    setup_minutes: 15,
    teardown_minutes: 15,
  });
  const [studioId] = await knex('venues').insert({
    name: 'Studio 3',
    location: 'ConnectSphere Campus, Basement 1',
    capacity: 60,
    facilities: 'PA system, lighting rig, hybrid camera kit',
    accessibility: 'Limited step-free access',
    operating_hours: '09:00-21:00',
    setup_minutes: 60,
    teardown_minutes: 45,
  });

  await knex('venue_layouts').insert([
    { venue_id: hallId, layout: 'THEATRE' },
    { venue_id: hallId, layout: 'CLASSROOM' },
    { venue_id: hallId, layout: 'EXHIBITION' },
    { venue_id: boardId, layout: 'BOARDROOM' },
    { venue_id: studioId, layout: 'THEATRE' },
    { venue_id: studioId, layout: 'BANQUET' },
  ]);

  await knex('venue_unavailability').insert({
    venue_id: studioId,
    reason: 'Lighting rig maintenance',
    start_at: '2026-10-01 00:00:00',
    end_at: '2026-10-03 23:59:59',
    created_by: userIds['venue@connectsphere.sg'],
  });

  await knex('equipment').insert([
    {
      name: 'Wireless handheld mic',
      type: 'AUDIO',
      description: 'Shure handheld microphone',
      quantity: 8,
      location: 'Tech store B1',
      status: 'AVAILABLE',
    },
    {
      name: 'Hybrid camera kit',
      type: 'VIDEO',
      description: 'PTZ camera + capture card',
      quantity: 3,
      location: 'Studio cage',
      status: 'AVAILABLE',
    },
    {
      name: 'Lectern with confidence monitor',
      type: 'STAGING',
      quantity: 2,
      location: 'Helix store',
      status: 'AVAILABLE',
    },
    {
      name: 'Portable hearing loop',
      type: 'ACCESSIBILITY',
      quantity: 1,
      location: 'Tech store B1',
      status: 'MAINTENANCE',
    },
  ]);

  await knex('events').insert({
    organisation_id: acmeId,
    organiser_id: userIds['organiser@acme.example'],
    coordinator_id: userIds['coordinator@connectsphere.sg'],
    name: 'Acme Q4 Leadership Forum',
    description: 'Closed-door leadership briefing with a hybrid overflow option.',
    purpose: 'Internal leadership alignment',
    category: 'CONFERENCE',
    status: 'PLANNING',
    start_at: '2026-11-12 09:00:00',
    end_at: '2026-11-12 17:00:00',
    expected_attendance: 120,
    accessibility_needs: 'Wheelchair access and reserved front-row seating',
    layout_preference: 'THEATRE',
    venue_requirements: 'Large hall with stage and hybrid cameras',
    equipment_notes: '2 handheld mics, 1 hybrid camera kit',
    special_requests: 'Quiet room for overflow attendees',
    registration_required: true,
    registration_capacity: 120,
  });
};

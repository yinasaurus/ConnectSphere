/**
 * Initial ConnectSphere schema.
 * Keep this migration additive-only in later sprints — add new files instead of editing this one
 * after it has been applied on anyone's machine.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('organisations', (table) => {
    table.increments('id').primary();
    table.string('name', 160).notNullable();
    table.string('industry', 80);
    table.string('contact_email', 160);
    table.string('phone', 40);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 160).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('full_name', 160).notNullable();
    table.string('phone', 40);
    table.integer('organisation_id').unsigned().nullable()
      .references('id').inTable('organisations').onDelete('SET NULL');
    table.string('department', 120);
    table.string('communication_preference', 32).notNullable().defaultTo('IN_APP');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('user_roles', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('role', 40).notNullable();
    table.unique(['user_id', 'role']);
  });

  await knex.schema.createTable('venues', (table) => {
    table.increments('id').primary();
    table.string('name', 160).notNullable();
    table.string('location', 255);
    table.integer('capacity').unsigned().notNullable().defaultTo(0);
    table.text('facilities');
    table.text('accessibility');
    table.string('operating_hours', 120);
    table.integer('setup_minutes').unsigned().notNullable().defaultTo(30);
    table.integer('teardown_minutes').unsigned().notNullable().defaultTo(30);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('venue_layouts', (table) => {
    table.increments('id').primary();
    table.integer('venue_id').unsigned().notNullable()
      .references('id').inTable('venues').onDelete('CASCADE');
    table.string('layout', 80).notNullable();
    table.unique(['venue_id', 'layout']);
  });

  await knex.schema.createTable('venue_unavailability', (table) => {
    table.increments('id').primary();
    table.integer('venue_id').unsigned().notNullable()
      .references('id').inTable('venues').onDelete('CASCADE');
    table.string('reason', 255).notNullable();
    table.datetime('start_at').notNullable();
    table.datetime('end_at').notNullable();
    table.integer('created_by').unsigned().references('id').inTable('users');
    table.timestamps(true, true);
    table.index(['venue_id', 'start_at', 'end_at']);
  });

  await knex.schema.createTable('equipment', (table) => {
    table.increments('id').primary();
    table.string('name', 160).notNullable();
    table.string('type', 80).notNullable().defaultTo('GENERAL');
    table.text('description');
    table.integer('quantity').unsigned().notNullable().defaultTo(1);
    table.string('location', 160);
    table.string('status', 40).notNullable().defaultTo('AVAILABLE');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.integer('organisation_id').unsigned()
      .references('id').inTable('organisations').onDelete('SET NULL');
    table.integer('organiser_id').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('coordinator_id').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('cloned_from_event_id').unsigned()
      .references('id').inTable('events').onDelete('SET NULL');
    table.string('name', 200).notNullable();
    table.text('description');
    table.string('purpose', 255);
    table.string('category', 80).notNullable().defaultTo('OTHER');
    table.string('status', 40).notNullable().defaultTo('DRAFT').index();
    table.datetime('start_at').index();
    table.datetime('end_at');
    table.integer('expected_attendance').unsigned();
    table.text('accessibility_needs');
    table.string('layout_preference', 80);
    table.text('venue_requirements');
    table.text('equipment_notes');
    table.text('special_requests');
    table.boolean('registration_required').notNullable().defaultTo(false);
    table.datetime('registration_opens_at');
    table.datetime('registration_closes_at');
    table.integer('registration_capacity').unsigned();
    table.boolean('registration_open').notNullable().defaultTo(false);
    table.text('rejection_reason');
    table.text('operational_notes');
    table.boolean('venue_ready').notNullable().defaultTo(false);
    table.boolean('equipment_ready').notNullable().defaultTo(false);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('event_status_history', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('actor_id').unsigned().references('id').inTable('users');
    table.string('from_status', 40);
    table.string('to_status', 40).notNullable();
    table.text('note');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('event_sessions', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.string('title', 200).notNullable();
    table.datetime('start_at');
    table.datetime('end_at');
    table.string('session_type', 80);
    table.text('notes');
  });

  await knex.schema.createTable('event_comments', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('author_id').unsigned().notNullable()
      .references('id').inTable('users');
    table.text('body').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('event_documents', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('uploaded_by').unsigned().references('id').inTable('users');
    table.string('file_name', 255).notNullable();
    table.string('file_path', 500).notNullable();
    table.string('mime_type', 120);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('venue_bookings', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('venue_id').unsigned().notNullable()
      .references('id').inTable('venues').onDelete('RESTRICT');
    table.integer('requested_by').unsigned().references('id').inTable('users');
    table.integer('decided_by').unsigned().references('id').inTable('users');
    table.string('status', 40).notNullable().defaultTo('PENDING').index();
    table.datetime('start_at').notNullable();
    table.datetime('end_at').notNullable();
    table.integer('setup_minutes').unsigned().notNullable().defaultTo(30);
    table.integer('teardown_minutes').unsigned().notNullable().defaultTo(30);
    table.text('notes');
    table.text('decision_reason');
    table.text('alternative_suggestion');
    table.datetime('decided_at');
    table.timestamps(true, true);
    table.index(['venue_id', 'start_at', 'end_at']);
  });

  await knex.schema.createTable('equipment_requests', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('equipment_id').unsigned()
      .references('id').inTable('equipment').onDelete('SET NULL');
    table.integer('quantity').unsigned().notNullable().defaultTo(1);
    table.text('notes');
    table.string('status', 40).notNullable().defaultTo('PENDING');
    table.integer('requested_by').unsigned().references('id').inTable('users');
    table.integer('decided_by').unsigned().references('id').inTable('users');
    table.text('decision_reason');
    table.datetime('decided_at');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('equipment_reservations', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('equipment_id').unsigned().notNullable()
      .references('id').inTable('equipment').onDelete('CASCADE');
    table.integer('quantity').unsigned().notNullable().defaultTo(1);
    table.string('status', 40).notNullable().defaultTo('RESERVED');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('registrations', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('attendee_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('status', 40).notNullable().defaultTo('REGISTERED');
    table.integer('waitlist_position').unsigned();
    table.datetime('withdrawn_at');
    table.timestamps(true, true);
    table.index(['event_id', 'status']);
  });

  await knex.schema.createTable('notifications', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('event_id').unsigned()
      .references('id').inTable('events').onDelete('SET NULL');
    table.string('type', 80).notNullable();
    table.string('title', 200).notNullable();
    table.text('body');
    table.datetime('read_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('audit_logs', (table) => {
    table.increments('id').primary();
    table.integer('actor_id').unsigned().references('id').inTable('users');
    table.string('action', 80).notNullable();
    table.string('entity_type', 80).notNullable();
    table.integer('entity_id').unsigned();
    table.json('metadata');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('coordinator_reassignments', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable()
      .references('id').inTable('events').onDelete('CASCADE');
    table.integer('from_coordinator_id').unsigned().references('id').inTable('users');
    table.integer('to_coordinator_id').unsigned().references('id').inTable('users');
    table.string('status', 40).notNullable().defaultTo('PENDING');
    table.datetime('resolved_at');
    table.timestamps(true, true);
  });
};

exports.down = async function down(knex) {
  const tables = [
    'coordinator_reassignments',
    'audit_logs',
    'notifications',
    'registrations',
    'equipment_reservations',
    'equipment_requests',
    'venue_bookings',
    'event_documents',
    'event_comments',
    'event_sessions',
    'event_status_history',
    'events',
    'equipment',
    'venue_unavailability',
    'venue_layouts',
    'venues',
    'user_roles',
    'users',
    'organisations',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
};

const ORGANISER_EMAIL = 'organiser@acme.example';
const COORDINATOR_EMAIL = 'coordinator@connectsphere.sg';
const PASSWORD = 'Password123!';

function login(email, password) {
  cy.visit('/');
  cy.get('#email').clear().type(email);
  cy.get('#password').clear().type(password, { log: false });
  cy.contains('button', 'Continue').click();
  cy.location('pathname').should('not.eq', '/');
}

describe('TC-DRAFT-04: Draft Saving & Resuming', () => {
  const draftName = `Draft Event ${Date.now()}`;
  const draftPurpose = 'Showcase new prototype';

  it('enters partial details into event form, saves as draft, and resumes editing without validation errors', () => {
    login(ORGANISER_EMAIL, PASSWORD);

    // 1. Enter partial details into event form
    cy.visit('/app/events/new');
    cy.contains('h1', 'New event request').should('be.visible');

    cy.get('#eventName').clear().type(draftName);
    cy.get('#eventPurpose').clear().type(draftPurpose);

    // 2. Select "Save as Draft"
    cy.contains('button', 'Save as draft').click();

    // 3. Expected Result: Data persists as draft record and lands on My Drafts
    cy.location('pathname').should('eq', '/app/drafts');
    cy.contains('h3', draftName).should('be.visible');

    // 4. Resume editing later
    cy.contains('h3', draftName).click();
    cy.location('pathname').should('match', /\/app\/events\/\d+\/edit/);

    // Form persists previous details
    cy.get('#eventName').should('have.value', draftName);
    cy.get('#eventPurpose').should('have.value', draftPurpose);

    // Verify NO validation errors are triggered upon resuming
    cy.get('.field-hint').should('not.exist');
    cy.get('.alert').should('not.exist');
  });
});

describe('SCUM-16: Request Clarification on Event Request', () => {
  const eventName = `Clarification Test ${Date.now()}`;

  it('allows coordinator to request clarification and organizer to inspect attention view and respond', () => {
    // Step 1: Organiser submits an event
    login(ORGANISER_EMAIL, PASSWORD);
    cy.visit('/app/events/new');

    cy.get('#eventName').clear().type(eventName);
    cy.get('#eventPurpose').clear().type('Test purpose');
    cy.get('#eventDescription').clear().type('Test description for clarification workflow');
    cy.get('#eventStartAt').clear().type('2026-11-15T09:00');
    cy.get('#eventEndAt').clear().type('2026-11-15T17:00');
    cy.get('#eventExpectedAttendance').clear().type('75');
    cy.get('#eventAccessibilityNeeds').clear().type('None');
    cy.get('#eventVenueRequirements').clear().type('Conference Hall A');

    cy.contains('button', 'Submit for review').click();
    cy.location('pathname').should('match', /\/app\/events\/\d+/);
    cy.contains('h1', eventName).should('be.visible');
    cy.contains('.badge', 'Under review').should('be.visible');

    // Get event ID from URL
    cy.url().then((url) => {
      const eventId = url.split('/').pop();

      // Step 2: Sign in as Coordinator
      login(COORDINATOR_EMAIL, PASSWORD);
      cy.visit(`/app/events/${eventId}`);
      cy.contains('h1', eventName).should('be.visible');

      // Coordinator requests clarification
      cy.contains('button', 'Request Clarification / Amendments').click();
      cy.get('textarea[placeholder*="State incomplete details"]').type('Please specify exact AV microphone requirements.');
      cy.contains('button', 'Send Clarification Request').click();

      // Status badge shows sub-state
      cy.contains('.badge', 'Clarification requested').should('be.visible');

      // Step 3: Sign in as Organiser to inspect requests needing attention
      login(ORGANISER_EMAIL, PASSWORD);
      cy.visit('/app');

      // Dashboard shows Requests Needing Attention
      cy.contains('Requests Needing Attention').should('be.visible');
      cy.contains(eventName).should('be.visible');
      cy.contains('Please specify exact AV microphone requirements.').should('be.visible');

      // Organiser opens event detail
      cy.visit(`/app/events/${eventId}`);
      cy.contains('Action Required: Clarification Requested').should('be.visible');
      cy.contains('Please specify exact AV microphone requirements.').should('be.visible');

      // Organiser submits clarification response
      cy.contains('button', 'Send Clarification Response').click();
      cy.get('textarea[placeholder*="Describe the changes made"]').type('We need 4 wireless handheld mics and 1 podium mic.');
      cy.contains('button', 'Submit Response').click();

      // Sub-state updates to Clarification Provided
      cy.contains('Clarification Provided').should('be.visible');
    });
  });
});

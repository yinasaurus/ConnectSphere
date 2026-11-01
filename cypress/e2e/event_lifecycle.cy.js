// Browser journeys for the main event path. Each test starts from a new request
// so a later step does not depend on an earlier test having passed.
// Run with the app up (`npm run dev`) and the demo seed loaded.
// Password for every demo account: Password123!

const PASSWORD = 'Password123!';

const ORGANISER = 'organiser@acme.example';
const LEAD = 'lead@connectsphere.sg';
const COORDINATOR = 'coordinator@connectsphere.sg';
const VENUE_STAFF = 'venue@connectsphere.sg';
const SAFETY_OFFICER = 'safety@connectsphere.sg';

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A daytime slot far enough ahead, and different on every run, so a second
// run does not hit a venue booking left by the first run.
function slot(spread) {
  const start = new Date();
  start.setDate(start.getDate() + 200 + spread + (Math.floor(Date.now() / 1000) % 5000));
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(17, 0, 0, 0);
  return {
    start: toLocalInput(start),
    end: toLocalInput(end),
  };
}

function login(email) {
  cy.clearCookies();
  cy.visit('/');
  cy.get('#email').should('be.visible').type(email);
  cy.get('#password').type(PASSWORD, { log: false });
  cy.contains('button', 'Continue').click();
  cy.contains('button', 'Sign out').should('be.visible');
}

function submitEvent({ name, start, end }) {
  cy.visit('/app/events/new');
  cy.get('#eventName').type(name);
  cy.get('#eventPurpose').type('Team briefing');
  cy.get('#eventDescription').type('A complete request for the browser journey.');
  cy.get('#eventStartAt').type(start);
  cy.get('#eventEndAt').type(end);
  cy.get('#eventExpectedAttendance').should('have.value', '40');
  cy.get('#eventAccessibilityNeeds').type('Step-free access');
  cy.get('#eventVenueRequirements').type('A room with a projector');
  cy.contains('button', 'Submit for review').click();
  cy.contains('h1', name).should('be.visible');
  cy.location('pathname').should('match', /\/app\/events\/\d+$/).as('eventPath');
}

function openEvent() {
  cy.get('@eventPath').then((path) => {
    cy.visit(path);
  });
}

function assignChloe() {
  login(LEAD);
  openEvent();
  cy.get('#assign-coordinator').select('Chloe Lim');
  cy.contains('button', 'Assign coordinator').click();
  cy.contains('.badge', 'Under Review').should('be.visible');
}

function approveAndStartPlanning() {
  login(COORDINATOR);
  openEvent();
  cy.contains('button', /^Approve$/).click();
  cy.contains('.badge', 'Approved').should('be.visible');
  cy.contains('button', 'Start planning').click();
  cy.contains('.badge', 'Planning').should('be.visible');
}

function bookHelixHall() {
  cy.contains('a', 'Book a venue').click();
  cy.get('#venue-select option').contains('Helix Hall').invoke('val').then((value) => {
    cy.get('#venue-select').select(value);
  });
  cy.contains('button', 'Submit request').should('not.be.disabled').click();
  cy.contains('Venue booking request submitted').should('be.visible');
}

function approveVenueBooking() {
  login(VENUE_STAFF);
  openEvent();
  cy.contains('button', 'Approve venue').click();
  cy.contains('Confirmed venue booking').should('be.visible');
}

function sendToSafetyCheck() {
  login(COORDINATOR);
  openEvent();
  cy.contains('button', 'Send to safety check').should('not.be.disabled').click();
  cy.contains('.badge', 'Awaiting Safety Check').should('be.visible');
}

function recordSafetyApproval() {
  login(SAFETY_OFFICER);
  cy.get('@eventPath').then((path) => {
    cy.visit(`${path}/safety-check`);
  });
  cy.get('#safety-outcome').should('have.value', 'APPROVE');
  cy.contains('button', 'Record outcome').click();
  cy.contains('Safety check outcome recorded.').should('be.visible');
}

describe('event lifecycle', { defaultCommandTimeout: 20000 }, () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
  });

  it('an Organiser submits a request and sees it as Submitted', () => {
    const name = `E2E submit ${Date.now()}`;
    const when = slot(0);
    login(ORGANISER);
    submitEvent({ name, start: when.start, end: when.end });
    cy.contains('.badge', 'Submitted').should('be.visible');
    cy.contains('Unassigned').should('be.visible');
  });

  it('a Lead assigns a Coordinator, and that Coordinator can open the event', () => {
    const name = `E2E assign ${Date.now()}`;
    const when = slot(3);
    login(ORGANISER);
    submitEvent({ name, start: when.start, end: when.end });
    assignChloe();

    login(COORDINATOR);
    openEvent();
    cy.contains('h1', name).should('be.visible');
    cy.contains('.badge', 'Under Review').should('be.visible');
    cy.contains('Coordinator:').parent().should('contain', 'Chloe Lim');
  });

  it('Venue Staff approve a booking, and the Coordinator sees the notice', () => {
    const name = `E2E venue ${Date.now()}`;
    const when = slot(6);
    login(ORGANISER);
    submitEvent({ name, start: when.start, end: when.end });
    assignChloe();
    approveAndStartPlanning();
    bookHelixHall();
    approveVenueBooking();

    login(COORDINATOR);
    cy.visit('/app/notifications');
    cy.contains('.comment', name).should('contain', 'Venue booking approved');
    cy.contains('.comment', name).contains('a', 'Open event').click();
    cy.contains('h1', name).should('be.visible');
    cy.contains('Confirmed venue booking').should('be.visible');
  });

  it('a Safety Officer approves the check, and the event reaches Preparation', () => {
    const name = `E2E safety ${Date.now()}`;
    const when = slot(9);
    login(ORGANISER);
    submitEvent({ name, start: when.start, end: when.end });
    assignChloe();
    approveAndStartPlanning();
    bookHelixHall();
    approveVenueBooking();
    sendToSafetyCheck();
    recordSafetyApproval();

    login(COORDINATOR);
    openEvent();
    cy.contains('h1', name).should('be.visible');
    cy.contains('.badge', 'Preparation').should('be.visible');
    cy.contains('Outcome:').parent().should('contain', 'APPROVED');
  });
});

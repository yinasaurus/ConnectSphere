/**
 * SCRUM-82: Sign out stays on screen for every role on a short desktop screen.
 * Needs the app running (npm run dev) and the seed data loaded.
 */
const PASSWORD = 'Password123!';
const SHORT_DESKTOP = { width: 1280, height: 500 };

function loginOnShortScreen(email) {
  cy.viewport(SHORT_DESKTOP.width, SHORT_DESKTOP.height);
  cy.visit('/');
  cy.get('#email').clear().type(email);
  cy.get('#password').clear().type(PASSWORD, { log: false });
  cy.contains('button', 'Continue').click();
  cy.location('pathname').should('match', /^\/app/);
  cy.visit('/app');
}

function expectSignOutOnScreen() {
  cy.contains('button', 'Sign out').should(($button) => {
    const rect = $button[0].getBoundingClientRect();
    const viewportHeight = $button[0].ownerDocument.defaultView.innerHeight;
    expect(rect.top, 'top of Sign out').to.be.at.least(0);
    expect(rect.bottom, 'bottom of Sign out').to.be.at.most(viewportHeight);
  });
}

function signOut() {
  cy.contains('button', 'Sign out').click();
  cy.location('pathname').should('eq', '/');
  cy.contains('h2', 'Sign in').should('be.visible');
}

describe('SCRUM-82 Sign out stays on screen', () => {
  /*
   * AC:       SCRUM-82
   * Scenario: Chloe (Event Coordinator) opens Home on a short desktop screen.
   * Setup:    1280x500 window. Her nav has Venues, Venue availability and Equipment.
   * Expected: Sign out is fully inside the window, and clicking it returns to Sign in.
   * Type:     normal
   */
  // SCRUM-82-TC03
  it('keeps Sign out on screen for an Event Coordinator', () => {
    loginOnShortScreen('coordinator@connectsphere.sg');
    cy.contains('.nav a', 'Equipment').should('exist');
    expectSignOutOnScreen();
    signOut();
  });

  /*
   * AC:       SCRUM-82
   * Scenario: Ivy (Lead) opens Home on a short desktop screen.
   * Setup:    1280x500 window. Her nav has Unassigned queue and Assignments.
   * Expected: Sign out is fully inside the window, and clicking it returns to Sign in.
   * Type:     normal
   */
  // SCRUM-82-TC04
  it('keeps Sign out on screen for a Lead', () => {
    loginOnShortScreen('lead@connectsphere.sg');
    cy.contains('.nav a', 'Assignments').should('exist');
    expectSignOutOnScreen();
    signOut();
  });

  /*
   * AC:       SCRUM-82
   * Scenario: Jordan (Coordinator + Lead) has the longest nav.
   * Setup:    1280x500 window. His nav has both the Coordinator and the Lead links.
   * Expected: Sign out is fully inside the window, and clicking it returns to Sign in.
   * Type:     boundary
   */
  // SCRUM-82-TC05
  it('keeps Sign out on screen for a Coordinator + Lead', () => {
    loginOnShortScreen('leadcoord@connectsphere.sg');
    cy.contains('.nav a', 'Equipment').should('exist');
    cy.contains('.nav a', 'Assignments').should('exist');
    expectSignOutOnScreen();
    signOut();
  });

  /*
   * AC:       SCRUM-82
   * Scenario: Aisha (Event Organiser) has a short nav.
   * Setup:    1280x500 window.
   * Expected: Sign out is still fully inside the window after the fix.
   * Type:     normal
   */
  // SCRUM-82-TC06
  it('keeps Sign out on screen for an Event Organiser', () => {
    loginOnShortScreen('organiser@acme.example');
    expectSignOutOnScreen();
    signOut();
  });

  /*
   * AC:       SCRUM-82
   * Scenario: Chloe needs a link that sits below the fold in the sidebar.
   * Setup:    1280x500 window. The links do not all fit.
   * Expected: The link list scrolls to Profile, and Sign out stays in the window.
   * Type:     boundary
   */
  // SCRUM-82-TC07
  it('lets a Coordinator scroll the sidebar links to reach the last one', () => {
    loginOnShortScreen('coordinator@connectsphere.sg');
    cy.get('.nav').scrollTo('bottom');
    cy.contains('.nav a', 'Profile').should('be.visible');
    expectSignOutOnScreen();
  });
});

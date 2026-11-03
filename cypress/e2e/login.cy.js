const EMAIL = 'organiser@acme.example';
const PASSWORD = 'Password123!';

function login(email, password) {
  cy.get('#email').clear().type(email);
  cy.get('#password').clear().type(password, { log: false });
  cy.contains('button', 'Continue').click();
}

describe('SCUM-12 login', () => {
  // SCRUM-12-TC17
  it('logs in with valid credentials and lands on the organiser dashboard', () => {
    cy.visit('/');
    login(EMAIL, PASSWORD);
    cy.location('pathname').should('eq', '/app/events');
    cy.contains('h1', 'Events').should('be.visible');
  });

  // SCRUM-12-TC18
  it('stays on the login page with a generic error for invalid credentials', () => {
    cy.visit('/');
    login(EMAIL, 'wrong-password');
    cy.get('[role="alert"]').should('contain', 'Invalid email or password');
    cy.location('pathname').should('eq', '/');
    cy.contains('h2', 'Sign in').should('be.visible');
  });

  // SCRUM-12-TC19
  it('keeps the session after a page refresh', () => {
    cy.visit('/');
    login(EMAIL, PASSWORD);
    cy.location('pathname').should('eq', '/app/events');
    cy.reload();
    cy.location('pathname').should('eq', '/app/events');
    cy.contains('h1', 'Events').should('be.visible');
  });

  // SCRUM-12-TC20
  it('redirects a logged-out visitor from a protected route to login', () => {
    cy.visit('/app/events');
    cy.location('pathname').should('eq', '/');
    cy.contains('h2', 'Sign in').should('be.visible');
  });
});

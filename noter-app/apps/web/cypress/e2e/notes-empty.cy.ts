describe('Notes empty state', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [],
    }).as('getNotes');

    cy.intercept('GET', '**/tasks', {
      statusCode: 200,
      body: [],
    }).as('getTasks');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'notes');
      },
    });
  });

  it('renders empty notes state without freezing', () => {
    cy.wait('@getNotes');
    cy.contains('Inga anteckningar').should('be.visible');
    cy.contains('Välj en anteckning').should('be.visible');
  });
});

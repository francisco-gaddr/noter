describe('Noter - Auth logout', () => {
  it('returns to auth screen after logout from an authenticated session', () => {
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
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.get('button[aria-label="Logout"], button[aria-label="Logga ut"]').click();
    cy.contains(/Login|Logga in/).should('be.visible');
  });
});

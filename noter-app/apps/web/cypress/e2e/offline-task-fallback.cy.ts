describe('Noter - Offline task fallback', () => {
  it('stays stable when task api returns offline fallback payload', () => {
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [],
    }).as('getNotes');

    cy.intercept('GET', '**/tasks', {
      statusCode: 200,
      body: { offline: true, message: 'You are offline' },
    }).as('getTasks');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'tasks');
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.contains(/Tasks|Uppgifter/).click();
    cy.contains(/Select a list|Välj en lista|No tasks|Inga uppgifter/).should('be.visible');
  });
});

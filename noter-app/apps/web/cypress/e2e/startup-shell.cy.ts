describe('Noter - Startup shell', () => {
  it('shows startup shell before authenticated data finishes loading', () => {
    cy.intercept('GET', '**/notes', (req) => {
      req.reply({
        statusCode: 200,
        delay: 1200,
        body: [],
      });
    }).as('getNotes');

    cy.intercept('GET', '**/tasks', (req) => {
      req.reply({
        statusCode: 200,
        delay: 1200,
        body: [],
      });
    }).as('getTasks');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'notes');
      },
    });

    cy.contains('Laddar Noter…').should('be.visible');
    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.get('header').should('contain.text', 'Noter');
  });
});

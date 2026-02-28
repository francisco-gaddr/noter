describe('Notes CRUD', () => {
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

  it('creates a note from the sidebar', () => {
    cy.wait('@getNotes');

    cy.intercept('POST', '**/notes', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          _id: 'note-1',
          userId: 'user-1',
          title: req.body.title,
          content: req.body.content,
          parentId: req.body.parentId ?? null,
          locked: false,
          type: 'note',
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }).as('createNote');

    cy.get('button[aria-label="Ny anteckning"]').click();
    cy.get('input[aria-label="Titel"]').type('Min anteckning');
    cy.contains('button', 'Spara').click();

    cy.wait('@createNote');
    cy.contains('Min anteckning').should('be.visible');
  });
});

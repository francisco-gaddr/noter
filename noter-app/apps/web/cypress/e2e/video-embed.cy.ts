describe('Video embed', () => {
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

  it('inserts youtube video via toolbar button', () => {
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
    cy.get('input[aria-label="Titel"]').type('Video Note');
    cy.contains('button', 'Spara').click();
    cy.wait('@createNote');
    cy.contains('Video Note', { timeout: 10000 }).should('be.visible').click();
    cy.get('button[aria-label="Video"]').click();
    cy.get('input[placeholder*="URL"]').type('https://youtu.be/abc123');
    cy.contains('button', 'Spara').click();
    cy.get('[data-testid="note-video"]', { timeout: 10000 })
      .should('have.attr', 'data-url')
      .and('include', 'youtu');
  });

  it('inserts tiktok video via toolbar button', () => {
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
    cy.get('input[aria-label="Titel"]').type('Video Note');
    cy.contains('button', 'Spara').click();
    cy.wait('@createNote');
    cy.contains('Video Note', { timeout: 10000 }).should('be.visible').click();
    cy.get('button[aria-label="Video"]').click();
    cy.get('input[placeholder*="URL"]').type('https://www.tiktok.com/@user/video/1234567890');
    cy.contains('button', 'Spara').click();
    cy.get('[data-testid="note-video"]', { timeout: 10000 })
      .should('have.attr', 'data-url')
      .and('include', 'tiktok.com');
  });
});

describe('Noter App E2E', () => {
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

  it('loads the sidebar and notes', () => {
    cy.get('h1').contains('Noter').should('exist');
    // Check if task link is present
    cy.contains(/Tasks|Uppgifter/).should('be.visible');
  });

  it('allows sorting notes by Last Modified', () => {
    // Check sort dropdown
    cy.get('select').should('exist');
    // The value for "Senast ändrad" is "updated-desc"
    cy.get('select').last().select('updated-desc');
    // Verify selection
    cy.get('select').last().should('have.value', 'updated-desc');
  });

  it('creates a task and opens the task detail modal', () => {
    cy.contains(/Tasks|Uppgifter/).click();

    cy.intercept('POST', '**/tasks', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          _id: 'task-1',
          userId: 'user-1',
          clientId: req.body.clientId || 'client-1',
          title: req.body.title,
          description: req.body.description || '',
          parentNoteId: req.body.parentNoteId || null,
          completed: false,
          priority: req.body.priority || 'medium',
          dueDate: req.body.dueDate || null,
          recurrenceType: req.body.recurrenceType || 'none',
          recurrenceDays: req.body.recurrenceDays || [],
          reminderEnabled: req.body.reminderEnabled || false,
          reminderOffsetMinutes: req.body.reminderOffsetMinutes || 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }).as('createTask');

    cy.get('input[aria-label="Lägg till en uppgift..."], input[aria-label="Add a task..."]')
      .type('Test task');
    cy.get('button[aria-label="Skapa uppgift"], button[aria-label="Create task"]').click();
    cy.wait('@createTask');

    cy.contains('Test task').click();
    cy.get('[role="dialog"]').should('be.visible');
  });

  it('persists task filters and sort after reload', () => {
    cy.contains(/Tasks|Uppgifter/).click();

    cy.get('button[title="Filter"], button[title="Filtrera"]').first().click();
    cy.contains('button', /Today|Idag/).click();

    cy.get('select[aria-label="Sort"], select[aria-label="Sortering"], select[aria-label="Sortera"]').first().select('dueDate');

    cy.window().then((win) => {
      expect(win.localStorage.getItem('taskQuickFilter')).to.eq('today');
      expect(win.localStorage.getItem('taskSortBy')).to.eq('dueDate');
    });

    cy.reload();
    cy.contains(/Tasks|Uppgifter/).click();

    cy.window().then((win) => {
      expect(win.localStorage.getItem('taskQuickFilter')).to.eq('today');
      expect(win.localStorage.getItem('taskSortBy')).to.eq('dueDate');
    });
  });
});

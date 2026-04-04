describe('Noter - Task modal save', () => {
  it('edits due date and reminder settings through the task modal', () => {
    const listId = 'task-list-1';
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [
        {
          _id: listId,
          title: 'Teamlista',
          content: '',
          type: 'task_list',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }).as('getNotes');

    cy.intercept('GET', '**/tasks*', {
      statusCode: 200,
      body: [
        {
          _id: 'task-1',
          title: 'Följ upp kund',
          description: '',
          completed: false,
          priority: 'medium',
          reminderEnabled: false,
          reminderOffsetMinutes: [0],
          parentNoteId: listId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          position: 0,
        },
      ],
    }).as('getTasks');

    cy.intercept('PUT', '**/tasks/task-1', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          ...req.body,
          _id: 'task-1',
          parentNoteId: listId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }).as('updateTask');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'tasks');
        win.localStorage.setItem('lastSelectedTaskListId', listId);
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.contains('Följ upp kund').click();
    cy.get('#due-date-input').clear().type('2026-12-24');
    cy.get('#due-time-input').clear().type('09:30');
    cy.contains('Aktivera påminnelse').click();
    cy.contains('10 minuter').parent().find('input').check({ force: true });
    cy.contains(/Save|Spara/).click({ force: true });
    cy.wait('@updateTask');
  });
});

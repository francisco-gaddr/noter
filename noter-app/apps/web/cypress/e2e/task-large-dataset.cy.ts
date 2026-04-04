describe('Noter - Large task dataset', () => {
  it('progressively renders large task lists without blocking the view', () => {
    const taskListId = 'task-list-1';
    const notes = [
      {
        _id: taskListId,
        title: 'Stor lista',
        content: '',
        type: 'task_list',
        createdAt: new Date('2026-01-01').toISOString(),
        updatedAt: new Date('2026-01-01').toISOString(),
      },
    ];
    const tasks = Array.from({ length: 350 }, (_, index) => ({
      _id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      description: '',
      completed: false,
      priority: 'medium',
      parentNoteId: taskListId,
      createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      position: index,
    }));

    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: notes,
    }).as('getNotes');

    cy.intercept('GET', '**/tasks*', {
      statusCode: 200,
      body: tasks,
    }).as('getTasks');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'tasks');
        win.localStorage.setItem('lastSelectedTaskListId', taskListId);
        win.localStorage.setItem('taskSortBy', 'createdAt');
        win.localStorage.setItem('taskViewMode', 'list');
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.contains('Visar 200 av 350 uppgifter').should('exist');
    cy.contains('Task 100').should('not.exist');
    cy.get('div.h-full.overflow-auto').first().scrollTo('bottom');
    cy.contains('Task 100').should('exist');
  });
});

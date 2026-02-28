describe('UI Stability & Performance', () => {
  beforeEach(() => {
    // Mock user login
    cy.window().then((win) => {
      win.localStorage.setItem('token', 'fake-token');
      win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'TestUser' }));
    });
  });

  it('handles large number of notes by limiting rendering', () => {
    // Generate 1500 mock notes
    const largeNotes = Array.from({ length: 1500 }, (_, i) => ({
      _id: `note-${i}`,
      userId: 'user-1',
      title: `Note ${i}`,
      content: JSON.stringify([{ type: 'paragraph', children: [{ text: '' }] }]),
      parentId: null,
      type: 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: largeNotes,
    }).as('getLargeNotes');

    cy.visit('/app');
    cy.wait('@getLargeNotes');

    // Should not freeze (if it freezes, test will timeout)
    cy.get('div[role="tree"]').should('exist');
    
    // Verify limit message appears (assuming English default or key check)
    // We added "Showing first 200 items" or translation key
    cy.contains(/Showing first 200 items|Visar de första 200/i).should('be.visible');
    
    // Verify not all 1500 are rendered in DOM (approx check)
    cy.get('div[role="treeitem"]').should('have.length.lt', 1000);
  });

  it('renders Task List dates with correct class for dark mode', () => {
    const task = {
      _id: 'task-1',
      title: 'Dark Mode Task',
      dueDate: new Date().toISOString(),
      completed: false,
      priority: 'medium',
    };

    cy.intercept('GET', '**/tasks*', {
      statusCode: 200,
      body: [task],
    }).as('getTasks');

    cy.visit('/app?tab=tasks'); // Assuming query param or state works, or click tab
    
    // Force click tasks tab if needed
    cy.contains('Tasks').click({ force: true });
    
    cy.wait('@getTasks');
    
    // Switch to list view if not default
    cy.get('button[title*="List"]').click({ force: true });

    // Check for the dark mode class we added: dark:text-gray-300
    cy.contains('Dark Mode Task')
      .parent()
      .find('span.text-xs')
      .should('have.class', 'dark:text-gray-300');
  });
});

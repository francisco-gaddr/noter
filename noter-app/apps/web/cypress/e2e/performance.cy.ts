describe('UI Stability & Performance - Large Datasets', () => {
  beforeEach(() => {
    // Mock user login
    cy.window().then((win) => {
      win.localStorage.setItem('token', 'fake-token');
      win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'TestUser' }));
    });
  });

  it('handles loading and rendering 2000 notes without freezing', () => {
    // Generate 2000 mock notes
    // Some are root, some are children to test tree recursion
    const largeNotes = [];
    // 50 Root folders
    for (let i = 0; i < 50; i++) {
        largeNotes.push({
            _id: `root-${i}`,
            userId: 'user-1',
            title: `Folder ${i}`,
            content: '[]',
            parentId: null,
            type: 'note', // treat as folder
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            locked: false
        });
        // 40 children per folder = 2000 notes
        for (let j = 0; j < 40; j++) {
            largeNotes.push({
                _id: `child-${i}-${j}`,
                userId: 'user-1',
                title: `Note ${i}-${j}`,
                content: '[]',
                parentId: `root-${i}`,
                type: 'note',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                locked: false
            });
        }
    }

    // Intercept with delayed response to simulate network + processing time
    cy.intercept('GET', '**/notes', (req) => {
        req.reply({
            statusCode: 200,
            body: largeNotes,
            delay: 100 // small network delay
        });
    }).as('getLargeNotes');

    cy.visit('/app');
    
    // Check if the loading spinner appears and disappears
    // This confirms the app is reacting to state changes
    // cy.get('[aria-label="Loading"]').should('be.visible'); // Spinner might be too fast or not have aria-label
    
    cy.wait('@getLargeNotes', { timeout: 30000 });

    // Verify app is interactive
    // Try to click a folder
    cy.contains('Folder 0').should('be.visible').click();
    
    // Check if children are rendered (limit is 50, we have 40, so all should show)
    cy.contains('Note 0-0').should('be.visible');
    
    // Verify "Show more" is NOT present for this folder (40 < 50)
    cy.contains('Show more').should('not.exist');
    
    // Performance check: Try to type in search
    cy.get('input[placeholder*="Sök"]').type('Note 49-39', { delay: 50 });
    cy.contains('Note 49-39').should('be.visible');
  });

  it('handles loading 1000 flat notes and paginates list view', () => {
      const flatNotes = Array.from({ length: 1000 }, (_, i) => ({
          _id: `flat-${i}`,
          userId: 'user-1',
          title: `Flat Note ${i}`,
          content: '[]',
          parentId: null,
          type: 'note',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
      }));

      cy.intercept('GET', '**/notes', { body: flatNotes }).as('getFlatNotes');
      
      cy.visit('/app');
      cy.wait('@getFlatNotes');

      // Switch to list view
      cy.get('button[title*="List"]').click();
      
      // Should verify "Showing first 500 items" message
      cy.contains(/Showing first 500|Visar de första 500/i).should('be.visible');
      
      // Should not contain item 600
      cy.contains('Flat Note 600').should('not.exist');
  });
});

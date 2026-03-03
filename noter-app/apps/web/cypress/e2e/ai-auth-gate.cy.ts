describe('AI auth gate', () => {
  it('hides AI before login', () => {
    cy.visit('/');
    cy.get('[aria-label="Open AI Assistant"]').should('not.exist');
  });

  it('shows AI after login', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
      },
    });
    cy.get('[aria-label="Open AI Assistant"]').should('exist');
  });
});

describe('Noter - Smoke', () => {
  it('laddar startsidan och visar autentisering', () => {
    cy.visit('/');
    cy.contains('Logga in').should('be.visible');
    cy.contains('Registrera').should('be.visible');
  });
});


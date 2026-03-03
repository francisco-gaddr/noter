import CryptoJS from 'crypto-js';

const encrypt = (value: string) => CryptoJS.AES.encrypt(value, 'noter-default-key').toString();

describe('Notes Lock/Unlock', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [
        {
          _id: 'note-1',
          userId: 'user-1',
          title: encrypt('Test Note'),
          content: encrypt('<p>Secret content</p>'),
          parentId: null,
          locked: encrypt('false'),
          type: encrypt('note'),
          order: encrypt('0'),
          createdAt: encrypt(new Date().toISOString()),
          updatedAt: encrypt(new Date().toISOString()),
        },
      ],
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

  it('locks and unlocks without reload', () => {
    cy.wait('@getNotes');

    cy.contains('Test Note').click();

    cy.intercept('PUT', '**/notes/note-1', (req) => {
      expect(req.body.password).to.eq('secret');
      req.reply({
        statusCode: 200,
        body: {
          _id: 'note-1',
          userId: 'user-1',
          title: encrypt('Test Note'),
          content: encrypt('<p>Secret content</p>'),
          parentId: null,
          locked: encrypt('true'),
          type: encrypt('note'),
          order: encrypt('0'),
          createdAt: encrypt(new Date().toISOString()),
          updatedAt: encrypt(new Date().toISOString()),
        },
      });
    }).as('lockNote');

    cy.get('[data-testid="note-lock-toggle"]').click();
    cy.get('[data-testid="password-input"]').type('secret');
    cy.get('[data-testid="password-submit"]').click();
    cy.wait('@lockNote');

    cy.get('[data-testid="note-unlock-button"]').should('be.visible');

    cy.intercept('POST', '**/notes/note-1/verify-lock', {
      statusCode: 200,
      body: {
        success: true,
        content: encrypt('<p>Secret content</p>'),
        title: encrypt('Test Note'),
      },
    }).as('verifyLock');

    cy.get('[data-testid="note-unlock-button"]').click();
    cy.get('[data-testid="password-input"]').type('secret');
    cy.get('[data-testid="password-submit"]').click();
    cy.wait('@verifyLock');

    cy.get('[data-testid="note-title-input"]').should('have.value', 'Test Note');
  });
});

import CryptoJS from 'crypto-js';

const encrypt = (value: string) => CryptoJS.AES.encrypt(value, 'noter-default-key').toString();

describe('Noter - Note editor save', () => {
  it('updates note title and content through the real editor flow', () => {
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [
        {
          _id: 'note-1',
          userId: 'user-1',
          title: encrypt('Första anteckningen'),
          content: encrypt('<p>Starttext</p>'),
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

    cy.intercept('PUT', '**/notes/note-1', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          _id: 'note-1',
          userId: 'user-1',
          title: encrypt('Uppdaterad anteckning'),
          content: encrypt('<p>Ny editortext</p>'),
          parentId: null,
          locked: encrypt('false'),
          type: encrypt('note'),
          order: encrypt('0'),
          createdAt: encrypt(new Date().toISOString()),
          updatedAt: encrypt(new Date().toISOString()),
        },
      });
    }).as('updateNote');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
        win.localStorage.setItem('activeTab', 'notes');
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.contains('Första anteckningen').click();
    cy.get('[data-testid="note-title-input"]').clear().type('Uppdaterad anteckning');
    cy.get('[data-slate-editor="true"]').click().type('{selectall}Ny editortext');
    cy.wait(2200);
    cy.wait('@updateNote');
    cy.get('[data-testid="note-title-input"]').should('have.value', 'Uppdaterad anteckning');
  });
});

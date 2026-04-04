describe('Noter - AI tool use', () => {
  it('renders tool call, tool result and summary entries from a real chat flow', () => {
    cy.intercept('GET', '**/notes', {
      statusCode: 200,
      body: [],
    }).as('getNotes');

    cy.intercept('GET', '**/tasks', {
      statusCode: 200,
      body: [
        {
          _id: 'task-1',
          title: 'Verifiera verktygsresultat',
          description: '',
          completed: false,
          priority: 'medium',
          reminderEnabled: false,
          reminderOffsetMinutes: [0],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          _id: 'task-2',
          title: 'Säkerställ AI-översikt',
          description: '',
          completed: false,
          priority: 'high',
          reminderEnabled: false,
          reminderOffsetMinutes: [0],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }).as('getTasks');

    cy.intercept('POST', 'https://generativelanguage.googleapis.com/**', {
      statusCode: 200,
      body: {
        candidates: [
          {
            content: {
              parts: [{ text: 'Tool call: list_tasks {}' }],
            },
          },
        ],
      },
    }).as('geminiChat');

    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', 'test-token');
        win.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
      },
    });

    cy.wait('@getNotes');
    cy.wait('@getTasks');
    cy.get('button[aria-label="Open AI Assistant"]', { timeout: 20000 }).click();
    cy.get('button[aria-label="Öppna AI-inställningar"]', { timeout: 20000 }).click();
    cy.contains('Använd API-baserad AI (OpenRouter/Gemini) istället för lokala modeller').click();
    cy.get('[data-testid="ai-provider-select"]').select('gemini');
    cy.get('[data-testid="gemini-api-key"]').type('test-key');
    cy.get('[data-testid="gemini-model"]').clear().type('gemini-2.5-flash');
    cy.get('button[aria-label="Öppna AI-inställningar"]', { timeout: 20000 }).click();
    cy.get('[data-testid="ai-chat-input"]', { timeout: 20000 }).type('Lista mina uppgifter');
    cy.get('[data-testid="ai-chat-send"]').click();
    cy.wait('@geminiChat');
    cy.contains('Tool call: list_tasks').should('be.visible');
    cy.contains('Tool result: list_tasks').should('be.visible');
    cy.contains('Hittade 2 uppgifter').should('be.visible');
    cy.contains('Tool calls klara:').should('be.visible');
  });
});

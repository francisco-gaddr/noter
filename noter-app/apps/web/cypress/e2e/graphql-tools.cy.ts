describe('graphql tools', () => {
  const graphqlUrl = () => `${Cypress.config('baseUrl').replace(/\/app$/, '')}/api/graphql`;

  it('creates and lists notes, projects, tasklists, and tasks', () => {
    const headers = { Authorization: 'Bearer demo-token' };

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: {
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: 'Project C', type: 'project' } }
      }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.createNote._id).to.exist;
    });

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: {
        query: 'mutation($input:NoteInput!){createNote(input:$input){_id title type}}',
        variables: { input: { title: 'Tasklist C', type: 'task_list' } }
      }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.createNote._id).to.exist;
    });

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: {
        query: 'query($type:String){notes(type:$type){_id title type}}',
        variables: { type: 'project' }
      }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.notes.length).to.be.greaterThan(0);
    });

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: {
        query: 'query($type:String){notes(type:$type){_id title type}}',
        variables: { type: 'task_list' }
      }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.notes.length).to.be.greaterThan(0);
    });

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: {
        query: 'mutation($input:TaskInput!){createTask(input:$input){_id title completed priority}}',
        variables: { input: { title: 'Task C', completed: false, priority: 'high' } }
      }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.createTask._id).to.exist;
    });

    cy.request({
      method: 'POST',
      url: graphqlUrl(),
      headers,
      body: { query: '{tasks{_id title completed priority}}' }
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data.tasks.length).to.be.greaterThan(0);
    });
  });
});

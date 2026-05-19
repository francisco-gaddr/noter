import { generate } from '../../src/scripts/generateOpenApi';

describe('OpenAPI 3.1 generator', () => {
  let doc: any;

  beforeAll(() => {
    doc = generate();
  });

  it('emits an OpenAPI 3.1 document with info + servers', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBeDefined();
    expect(doc.info.version).toBeDefined();
    expect(Array.isArray(doc.servers)).toBe(true);
  });

  it('declares bearerAuth security scheme as JWT', () => {
    expect(doc.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('mounts /api/notes GET and POST', () => {
    expect(doc.paths['/api/notes']).toBeDefined();
    expect(doc.paths['/api/notes'].get).toBeDefined();
    expect(doc.paths['/api/notes'].post).toBeDefined();
  });

  it('POST /api/notes uses 201 as success status', () => {
    expect(doc.paths['/api/notes'].post.responses['201']).toBeDefined();
  });

  it('DELETE /api/notes/{id} uses 204 as success status', () => {
    const del = doc.paths['/api/notes/{id}'].delete;
    expect(del).toBeDefined();
    expect(del.responses['204']).toBeDefined();
  });

  it('path parameters are extracted from {id} placeholders', () => {
    const get = doc.paths['/api/notes/{id}'].get;
    const idParam = (get.parameters || []).find((p: any) => p.name === 'id' && p.in === 'path');
    expect(idParam).toBeDefined();
    expect(idParam.required).toBe(true);
  });

  it('request body is referenced for POST mutations', () => {
    const post = doc.paths['/api/notes'].post;
    expect(post.requestBody).toBeDefined();
    expect(post.requestBody.content['application/json'].schema.$ref).toContain('NoteInput');
  });

  it('component schemas include Note and Task', () => {
    expect(doc.components.schemas.Note).toBeDefined();
    expect(doc.components.schemas.Note.type).toBe('object');
    expect(doc.components.schemas.Task).toBeDefined();
  });

  it('every operation requires bearerAuth by default', () => {
    for (const [pathKey, methods] of Object.entries<any>(doc.paths)) {
      for (const [methodKey, op] of Object.entries<any>(methods)) {
        expect(op.security).toEqual([{ bearerAuth: [] }]);
        // sanity: every op has at least one response
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      }
    }
  });
});

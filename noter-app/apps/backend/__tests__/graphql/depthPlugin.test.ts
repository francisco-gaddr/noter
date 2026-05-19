import { parse } from 'graphql';
import { _computeOperationDepth } from '../../src/graphql/depthPlugin';

describe('GraphQL depth plugin', () => {
  it('depth=1 for flat query', () => {
    const doc = parse('{ a b c }');
    expect(_computeOperationDepth(doc)).toBe(1);
  });

  it('depth=2 for nested fields', () => {
    const doc = parse('{ a { b } }');
    expect(_computeOperationDepth(doc)).toBe(2);
  });

  it('depth=3 for double-nested', () => {
    const doc = parse('{ a { b { c } } }');
    expect(_computeOperationDepth(doc)).toBe(3);
  });

  it('chooses the deepest branch', () => {
    const doc = parse('{ a { b } c { d { e { f } } } }');
    expect(_computeOperationDepth(doc)).toBe(4);
  });

  it('handles inline fragments', () => {
    const doc = parse('{ a { ... on T { b { c } } } }');
    expect(_computeOperationDepth(doc)).toBe(3);
  });

  it('returns 0 for empty doc (no operation defs)', () => {
    const doc = parse('fragment F on T { a }');
    expect(_computeOperationDepth(doc)).toBe(0);
  });

  it('handles multiple operations and reports the deepest', () => {
    const doc = parse('query A { a { b } }  query B { c { d { e } } }');
    expect(_computeOperationDepth(doc)).toBe(3);
  });

  it('depth 0 for leaf-only query', () => {
    // A leaf field selection set (the inner `b` has no sub-selection) → depth 2
    const doc = parse('{ a { b } }');
    expect(_computeOperationDepth(doc)).toBe(2);
  });
});

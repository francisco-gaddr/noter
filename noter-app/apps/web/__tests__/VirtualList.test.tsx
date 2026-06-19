import React from 'react'
import { render, screen } from '@testing-library/react'
import { VirtualList } from '../components/VirtualList'
import { shouldWindowTaskList, VIRTUALIZE_THRESHOLD } from '../components/TaskList'

// The SAFETY-CRITICAL logic we own: windowing must never engage while drag-and-drop (custom sort)
// needs every row mounted, and must not engage for short lists. The virtualizer itself is a
// battle-tested library validated by typecheck + the next build — not re-tested here in jsdom (which
// has no layout engine).
describe('shouldWindowTaskList (windowing must never break drag-and-drop)', () => {
  it('NEVER windows in custom-sort mode, however large the list', () => {
    expect(shouldWindowTaskList('custom', 10_000)).toBe(false)
  })
  it('windows a large list only when not custom-sorted', () => {
    expect(shouldWindowTaskList('dueDate', VIRTUALIZE_THRESHOLD + 1)).toBe(true)
    expect(shouldWindowTaskList('priority', 5_000)).toBe(true)
  })
  it('keeps the plain render path at/below the threshold', () => {
    expect(shouldWindowTaskList('dueDate', VIRTUALIZE_THRESHOLD)).toBe(false)
    expect(shouldWindowTaskList('createdAt', 3)).toBe(false)
  })
})

describe('VirtualList (mount smoke test)', () => {
  it('mounts without crashing for empty and non-empty lists', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }))
    expect(() =>
      render(<VirtualList items={items} getKey={(it) => it.id} renderItem={(it) => <div>{it.id}</div>} />),
    ).not.toThrow()
    expect(() =>
      render(<VirtualList items={[]} getKey={(_, i) => i} renderItem={() => <div data-testid="row" />} />),
    ).not.toThrow()
    expect(screen.queryAllByTestId('row')).toHaveLength(0) // empty list mounts no rows
  })
})

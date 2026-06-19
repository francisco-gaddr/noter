'use client'

import React, { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * Generic windowed list: mounts only the rows in (or near) the viewport, so a list of thousands of
 * rich items stays at a few dozen DOM nodes. Heights are MEASURED at runtime (measureElement), so
 * variable-height rows work without pre-declaring sizes. Headless + reusable — any large flat list
 * (tasks, chat messages, search results) can drop in.
 *
 * Deliberately NOT used for drag-and-drop lists / trees: a dragged row that scrolls out of view gets
 * unmounted, breaking the DnD ref math. Callers must fall back to plain rendering in those modes (and
 * for short lists, where windowing is pure overhead — see the threshold at the call site).
 */
export interface VirtualListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  getKey: (item: T, index: number) => string | number
  /** Initial per-row estimate (px) before measurement; closer = less first-paint shift. */
  estimateSize?: number
  /** Rows rendered beyond the viewport each side (smoother scroll + a bit more find-in-page reach). */
  overscan?: number
  /** Vertical gap between rows (px) — replaces a CSS `space-y` that absolute positioning can't honour. */
  gap?: number
  className?: string
  ariaLabel?: string
}

export function VirtualList<T>({
  items,
  renderItem,
  getKey,
  estimateSize = 64,
  overscan = 8,
  gap = 8,
  className,
  ariaLabel,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan,
  })

  return (
    <div ref={parentRef} className={className} aria-label={ariaLabel}>
      <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={getKey(items[vi.index], vi.index)}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, paddingBottom: gap }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

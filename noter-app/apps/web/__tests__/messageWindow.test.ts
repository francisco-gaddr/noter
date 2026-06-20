import { computeMessageWindow, MESSAGE_WINDOW } from '../lib/messageWindow'

describe('computeMessageWindow (chat history windowing)', () => {
  it('shows everything when the chat is within the window', () => {
    expect(computeMessageWindow(10, MESSAGE_WINDOW)).toEqual({ startIndex: 0, hiddenCount: 0 })
    expect(computeMessageWindow(MESSAGE_WINDOW, MESSAGE_WINDOW)).toEqual({ startIndex: 0, hiddenCount: 0 })
  })

  it('keeps the NEWEST messages visible and hides the older ones', () => {
    // 200 messages, window 60 → the last 60 are shown, the first 140 hidden.
    expect(computeMessageWindow(200, 60)).toEqual({ startIndex: 140, hiddenCount: 140 })
  })

  it('reveals more as visibleCount grows (load-earlier), never going negative', () => {
    expect(computeMessageWindow(200, 120)).toEqual({ startIndex: 80, hiddenCount: 80 })
    expect(computeMessageWindow(200, 1000)).toEqual({ startIndex: 0, hiddenCount: 0 }) // "show all"
  })

  it('handles empty/edge inputs safely', () => {
    expect(computeMessageWindow(0, 60)).toEqual({ startIndex: 0, hiddenCount: 0 })
    expect(computeMessageWindow(5, 0)).toEqual({ startIndex: 5, hiddenCount: 5 })
  })
})

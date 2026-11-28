import type { KeyboardEvent } from 'react';

/** Props for a table row or card that opens something: clickable, focusable, Enter/Space to open. */
export function rowLink(open: () => void) {
  return {
    onClick: open,
    tabIndex: 0,
    role: 'button' as const,
    style: { cursor: 'pointer' },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
  };
}

import React from 'react'

// Line icons drawn in `currentColor`, so they take the colour of whatever they
// sit in and stay right in both the felt panels and the brass buttons.

// Other printings of this card: one card sliding out from behind another.
export function PrintingsIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="1.5" y="3.5" width="8" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.5 3V2.5A1.5 1.5 0 0 1 7 1h5.5A1.5 1.5 0 0 1 14 2.5v9a1.5 1.5 0 0 1-1.5 1.5H12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

// This card is the deck's cover: a bookmark, the mark you leave on the one page
// you want to find again. Filled, because it is a state rather than an action.
export function CoverIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 1.75h8a1 1 0 0 1 1 1v11.4a.6.6 0 0 1-.95.49L8 11.9l-4.05 2.74a.6.6 0 0 1-.95-.49V2.75a1 1 0 0 1 1-1Z" fill="currentColor" />
    </svg>
  )
}

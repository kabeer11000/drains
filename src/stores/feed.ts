import { atom } from 'nanostores'
import type { CommentDoc } from '@/services/comments'

// The open drain's comments, published by Feed so an entry's own menu can
// list them — the comments column is desktop-only.
export const $comments = atom<CommentDoc[]>([])

// Set by an entry's menu ("Summarize this day"); Feed works out which day
// that entry belongs to and runs the same summarize as the sidebar.
export const $summarizeDayOf = atom<string | null>(null)

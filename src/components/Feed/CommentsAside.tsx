import { useCallback, useEffect, useRef, useState, memo } from 'react'
import type { Editor } from '@tiptap/react'
import { CommentCard } from './CommentCard'
import type { CommentDoc } from '@/services/comments'

const GAP = 8
// ponytail: assumed height for a card whose real height hasn't been
// measured yet (first render pass) — a brief, self-correcting approximation,
// not a permanent cap; real heights take over once CommentCard reports them.
const FALLBACK_HEIGHT = 80

// Memoized: Feed re-renders on every save (the Saving… pill); this column
// only needs to when its own props change.
export const CommentsAside = memo(function CommentsAside({
  editor,
  comments,
  onDelete,
}: {
  editor: Editor | null
  comments: CommentDoc[]
  onDelete: (comment: CommentDoc) => void
}) {
  const asideRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Map<string, number>>(new Map())
  const [heights, setHeights] = useState<Map<string, number>>(new Map())

  const reportHeight = useCallback((commentId: string, height: number) => {
    setHeights((prev) => (prev.get(commentId) === height ? prev : new Map(prev).set(commentId, height)))
  }, [])

  useEffect(() => {
    if (!editor) return

    const recompute = () => {
      const asideEl = asideRef.current
      if (!asideEl) return
      const asideTop = asideEl.getBoundingClientRect().top
      const editorDom = editor.view.dom

      const anchored = comments
        .map((comment) => {
          const markEl = editorDom.querySelector(`mark[data-comment-id="${comment.commentId}"]`)
          if (!markEl) return null
          return { comment, naturalTop: markEl.getBoundingClientRect().top - asideTop }
        })
        .filter((r): r is { comment: CommentDoc; naturalTop: number } => r !== null)
        .sort((a, b) => a.naturalTop - b.naturalTop)

      const next = new Map<string, number>()
      let cursor = 0
      for (const { comment, naturalTop } of anchored) {
        const top = Math.max(naturalTop, cursor)
        next.set(comment.commentId, top)
        cursor = top + (heights.get(comment.commentId) ?? FALLBACK_HEIGHT) + GAP
      }
      setPositions((prev) =>
        prev.size === next.size && [...next].every(([id, top]) => prev.get(id) === top) ? prev : next
      )
    }

    // Once per frame: a burst of transactions (sync, paging) would otherwise
    // set state synchronously inside each one and trip React's update limit.
    let frame = 0
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), recompute()))
    }
    recompute()
    editor.on('update', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(editor.view.dom)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('update', schedule)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [editor, comments, heights])

  return (
    <div ref={asideRef} className="relative hidden w-64 shrink-0 lg:block">
      {comments.map((comment) => {
        const top = positions.get(comment.commentId)
        if (top === undefined) return null
        return (
          <CommentCard
            key={comment._id}
            comment={comment}
            top={top}
            onDelete={onDelete}
            onMeasure={reportHeight}
          />
        )
      })}
    </div>
  )
})

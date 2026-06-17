/**
 * Comment Popover — thread view for an existing comment.
 *
 * Shows the original comment, any replies (user + AI), a reply input, a
 * resolve control, and a remove button. Mirrors the visual language of
 * AISuggestionPopover.
 */

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Trash2, X, Sparkles, CheckCheck, Send, Bot, User } from 'lucide-react'
import { useChat } from '../hooks/useChat'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { aiUnavailableMessage } from '../lib/llm'
import { useCommentStore } from '../extensions/comments/store'
import type { CommentData, CommentReply } from '../extensions/comments/types'
import { generateId } from '../lib/persistence'
import { cn } from '../lib/utils'

const NAV_BAR_HEIGHT = 48
const VIEWPORT_PADDING = 16

interface CommentPopoverProps {
  editor: Editor
}

interface PopoverState {
  isOpen: boolean
  commentId: string | null
  commentText: string
  position: { x: number; y: number }
}

export function CommentPopover({ editor }: CommentPopoverProps) {
  const [popover, setPopover] = useState<PopoverState>({
    isOpen: false,
    commentId: null,
    commentText: '',
    position: { x: 0, y: 0 },
  })
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null)
  const [replyText, setReplyText] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const { processComment } = useChat()
  const ai = useAIConfigured()

  // Get persisted comment data (replies + resolved state)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const documentId = useCommentStore((s) => s.documentId)
  const saveComments = useCommentStore((s) => s.saveComments)

  const currentComment: CommentData | undefined = popover.commentId
    ? pendingComments.find((c) => c.id === popover.commentId)
    : undefined

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const mark = target.closest('.comment-mark') as HTMLElement | null
      if (mark) {
        event.preventDefault()
        event.stopPropagation()

        const id = mark.getAttribute('data-comment-id')
        if (!id) {
          // Malformed mark — the Comment extension's renderHTML drops the
          // attribute when attrs.id is falsy. Warn loudly so the source of
          // the bad mark is debuggable, but don't silently swallow the click.
          console.warn('[CommentPopover] comment-mark clicked with no data-comment-id', mark)
          return
        }
        const text = mark.getAttribute('data-comment') || ''
        const rect = mark.getBoundingClientRect()
        setPopover({
          isOpen: true,
          commentId: id,
          commentText: text,
          position: { x: rect.left + rect.width / 2, y: rect.bottom + 8 },
        })
        setReplyText('')
        return
      }

      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover.isOpen) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popover.isOpen])

  useEffect(() => {
    setAdjustedPosition(null)
  }, [popover.position.x, popover.position.y])

  useLayoutEffect(() => {
    if (!popover.isOpen || !popoverRef.current || adjustedPosition) return
    const rect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const minY = NAV_BAR_HEIGHT + VIEWPORT_PADDING
    const newPosition = { ...popover.position }
    if (newPosition.x + rect.width / 2 > viewportWidth - VIEWPORT_PADDING) {
      newPosition.x = viewportWidth - rect.width / 2 - VIEWPORT_PADDING
    }
    if (newPosition.x - rect.width / 2 < VIEWPORT_PADDING) {
      newPosition.x = rect.width / 2 + VIEWPORT_PADDING
    }
    if (newPosition.y + rect.height > viewportHeight - VIEWPORT_PADDING) {
      const aboveY = popover.position.y - rect.height - 40
      newPosition.y = aboveY >= minY ? aboveY : popover.position.y
    }
    if (newPosition.y < minY) {
      newPosition.y = minY
    }
    if (newPosition.x !== popover.position.x || newPosition.y !== popover.position.y) {
      setAdjustedPosition(newPosition)
    } else {
      setAdjustedPosition(popover.position)
    }
  }, [popover.isOpen, popover.position, adjustedPosition])

  const handleRemove = useCallback(() => {
    if (!popover.commentId) return
    const id = popover.commentId
    // Remove the editor mark and drop the persisted record entirely.
    editor.commands.unsetComment(id)
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.filter((c) => c.id !== id)
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [editor, popover.commentId, documentId, saveComments])

  const handleResolve = useCallback(() => {
    if (!popover.commentId) return
    const id = popover.commentId
    // Mark resolved:true in the store (thread persists as history),
    // then remove the editor mark so the highlight disappears.
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.map((c) => c.id === id ? { ...c, resolved: true } : c)
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    editor.commands.unsetComment(id)
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [editor, popover.commentId, documentId, saveComments])

  const handleProcess = useCallback(() => {
    if (popover.commentId) {
      const id = popover.commentId
      setPopover((prev) => ({ ...prev, isOpen: false }))
      processComment(id)
    }
  }, [popover.commentId, processComment])

  const handleClose = useCallback(() => {
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [])

  // Add a user reply to the thread
  const handleAddReply = useCallback(() => {
    const text = replyText.trim()
    if (!text || !popover.commentId) return
    const id = popover.commentId
    const reply: CommentReply = {
      id: generateId(),
      author: 'user',
      text,
      createdAt: Date.now(),
    }
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.map((c) =>
      c.id === id ? { ...c, replies: [...(c.replies ?? []), reply] } : c
    )
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    setReplyText('')
    replyInputRef.current?.focus()
  }, [replyText, popover.commentId, documentId, saveComments])

  const handleReplyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleAddReply()
      }
    },
    [handleAddReply]
  )

  if (!popover.isOpen) return null

  const displayPosition = adjustedPosition || popover.position
  const replies = currentComment?.replies ?? []
  const isResolved = currentComment?.resolved === true

  return createPortal(
    <div
      ref={popoverRef}
      className="comment-popover"
      style={{
        position: 'fixed',
        left: displayPosition.x,
        top: displayPosition.y,
        transform: 'translateX(-50%)',
        visibility: adjustedPosition ? 'visible' : 'hidden',
      }}
    >
      {/* Original comment */}
      <div className="comment-label">Comment:</div>
      <div className="comment-text">{popover.commentText}</div>

      {/* Thread replies */}
      {replies.length > 0 && (
        <div className="comment-replies">
          {replies.map((reply) => (
            <ReplyRow key={reply.id} reply={reply} />
          ))}
        </div>
      )}

      {/* Reply input (hidden for resolved threads) */}
      {!isResolved && (
        <div className="comment-reply-input">
          <textarea
            ref={replyInputRef}
            className="reply-textarea"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            placeholder="Reply… (Enter to send)"
            rows={2}
          />
          <button
            className="reply-send-btn"
            onClick={handleAddReply}
            disabled={!replyText.trim()}
            aria-label="Send reply"
          >
            <Send size={14} />
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="actions">
        <button
          className="process-btn"
          onClick={handleProcess}
          disabled={!ai.available || isResolved}
          title={isResolved ? 'Thread is resolved' : undefined}
        >
          <Sparkles size={16} />
          Process
        </button>
        {!isResolved && (
          <button className="resolve-btn" onClick={handleResolve}>
            <CheckCheck size={16} />
            Resolve
          </button>
        )}
        <button className="remove-btn" onClick={handleRemove}>
          <Trash2 size={16} />
          Remove
        </button>
        <button className="close-btn" onClick={handleClose}>
          <X size={16} />
          Close
        </button>
      </div>
      {!ai.available && ai.reason && (
        <div className="ai-hint">{aiUnavailableMessage(ai.reason)}</div>
      )}
    </div>,
    document.body
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ReplyRow({ reply }: { reply: CommentReply }) {
  const isAI = reply.author === 'ai'
  return (
    <div className={cn('comment-reply', isAI ? 'reply-ai' : 'reply-user')}>
      <span className="reply-author-icon" aria-label={isAI ? 'AI' : 'You'}>
        {isAI ? <Bot size={12} /> : <User size={12} />}
      </span>
      <span className="reply-text">{reply.text}</span>
    </div>
  )
}

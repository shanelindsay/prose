/**
 * AI Edits History Panel
 *
 * A live view of the AI authorship annotations and comment threads on the
 * current document, grouped by date. Annotations derive from the annotation
 * store; comment activity (replies + resolutions) derives from the comment store.
 *
 * Surface: rendered inside the chat sidebar when the user selects the Activity
 * tab in the ChatPanel header. The superseded + resolved filters live in that
 * tab header; this panel receives the resulting flags as props.
 */

import { useCallback, useMemo } from 'react'
import { Wand2, Crosshair, X, Eye, EyeOff, Filter, MessageSquare, CheckCheck, Bot, User } from 'lucide-react'
import { useAnnotationStore } from '../../extensions/ai-annotations/store'
import { useCommentStore } from '../../extensions/comments/store'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { formatAge } from '../../types/annotations'
import type { AIAnnotation, AnnotationType } from '../../types/annotations'
import type { CommentData, CommentReply } from '../../extensions/comments/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface AIEditsHistoryPanelProps {
  /** Hide superseded (detached) AI edit entries. Owned by ChatPanel's tab header. */
  hideSuperseded: boolean
  /** Hide resolved comment threads. Owned by ChatPanel's tab header. */
  hideResolved: boolean
  /** Clear all filters (wired to the filtered-empty "Show all" affordance). */
  onShowAll: () => void
}

// Unified activity item for the mixed feed
type ActivityItem =
  | { kind: 'annotation'; annotation: AIAnnotation; createdAt: number }
  | { kind: 'comment'; comment: CommentData; createdAt: number }

interface ActivityDateGroup {
  label: string
  items: ActivityItem[]
}

export function AIEditsHistoryPanel({ hideSuperseded, hideResolved, onShowAll }: AIEditsHistoryPanelProps) {
  const annotations = useAnnotationStore((s) => s.annotations)
  const removeAnnotation = useAnnotationStore((s) => s.removeAnnotation)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const documentId = useCommentStore((s) => s.documentId)
  const saveComments = useCommentStore((s) => s.saveComments)
  const editor = useEditorInstanceStore((s) => s.editor)

  // Filter annotations by superseded flag.
  const visibleAnnotations = useMemo(
    () => (hideSuperseded ? annotations.filter((a) => !a.detached) : annotations),
    [annotations, hideSuperseded]
  )

  // Filter comments: show those with replies or that are resolved.
  // Active (unresolved) comments with no replies live in the popover only.
  const visibleComments = useMemo(() => {
    return pendingComments.filter((c) => {
      const hasActivity = (c.replies?.length ?? 0) > 0 || c.resolved
      if (!hasActivity) return false
      if (hideResolved && c.resolved) return false
      return true
    })
  }, [pendingComments, hideResolved])

  // Build a unified sorted feed, newest-first
  const items: ActivityItem[] = useMemo(() => {
    const annotationItems: ActivityItem[] = visibleAnnotations.map((a) => ({
      kind: 'annotation',
      annotation: a,
      createdAt: a.createdAt,
    }))
    const commentItems: ActivityItem[] = visibleComments.map((c) => ({
      kind: 'comment',
      comment: c,
      // Key timestamp is the most recent activity (last reply, or creation)
      createdAt:
        c.replies && c.replies.length > 0
          ? c.replies[c.replies.length - 1].createdAt
          : c.createdAt,
    }))
    return [...annotationItems, ...commentItems].sort((a, b) => b.createdAt - a.createdAt)
  }, [visibleAnnotations, visibleComments])

  const hasAnyActivity =
    annotations.length > 0 ||
    pendingComments.some((c) => (c.replies?.length ?? 0) > 0 || c.resolved)
  const nothingVisible = items.length === 0

  const groups = useMemo(() => groupActivityByDate(items), [items])

  const handleJump = useCallback(
    (annotation: AIAnnotation) => {
      if (!editor) return
      // Detached entries are history-only (#674)
      if (annotation.detached) return
      editor.commands.setTextSelection({ from: annotation.from, to: annotation.to })
      editor.commands.focus()
      const { selection } = editor.state
      const domAtPos = editor.view.domAtPos(selection.from)
      const el = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [editor]
  )

  const handleRemoveAnnotation = useCallback(
    (id: string) => {
      removeAnnotation(id)
    },
    [removeAnnotation]
  )

  const handleRemoveComment = useCallback(
    (id: string) => {
      const { pendingComments: current } = useCommentStore.getState()
      const updated = current.filter((c) => c.id !== id)
      useCommentStore.setState({ pendingComments: updated })
      if (documentId) saveComments(documentId, updated)
      // Remove the editor mark if it's still live
      editor?.commands.unsetComment(id)
    },
    [editor, documentId, saveComments]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!hasAnyActivity ? (
          <EmptyState />
        ) : nothingVisible ? (
          <FilteredEmptyState onShowAll={onShowAll} />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <ActivityDateGroup
                key={group.label}
                label={group.label}
                items={group.items}
                onJumpAnnotation={handleJump}
                onRemoveAnnotation={handleRemoveAnnotation}
                onRemoveComment={handleRemoveComment}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: annotation visibility toggle */}
      <AnnotationVisibilityFooter />
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <Wand2 className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">No activity yet</p>
      <p className="text-[10px] text-muted-foreground/60 max-w-[180px] leading-relaxed">
        AI edits and comment thread activity will appear here.
      </p>
    </div>
  )
}

/** Shown when every entry is hidden by the active filters. */
function FilteredEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <Filter className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">All activity is filtered</p>
      <button
        onClick={onShowAll}
        className="text-[10px] text-muted-foreground/80 underline-offset-2 hover:underline"
      >
        Show all
      </button>
    </div>
  )
}

interface ActivityDateGroupProps {
  label: string
  items: ActivityItem[]
  onJumpAnnotation: (annotation: AIAnnotation) => void
  onRemoveAnnotation: (id: string) => void
  onRemoveComment: (id: string) => void
}

function ActivityDateGroup({
  label,
  items,
  onJumpAnnotation,
  onRemoveAnnotation,
  onRemoveComment,
}: ActivityDateGroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 sticky top-0 bg-background z-10 border-b border-border/40">
        {label}
      </div>
      <div className="divide-y divide-border/30">
        {items.map((item) =>
          item.kind === 'annotation' ? (
            <HistoryEntryRow
              key={item.annotation.id}
              annotation={item.annotation}
              onJump={onJumpAnnotation}
              onRemove={onRemoveAnnotation}
            />
          ) : (
            <CommentActivityRow
              key={item.comment.id}
              comment={item.comment}
              onRemove={onRemoveComment}
            />
          )
        )}
      </div>
    </div>
  )
}

// ─── Annotation row ────────────────────────────────────────────────────────────

interface HistoryEntryRowProps {
  annotation: AIAnnotation
  onJump: (annotation: AIAnnotation) => void
  onRemove: (id: string) => void
}

function HistoryEntryRow({ annotation, onJump, onRemove }: HistoryEntryRowProps) {
  const snippet = annotation.content.slice(0, 200).replace(/\n/g, ' ')
  const isLong = annotation.content.length > 200
  const detached = annotation.detached === true

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onJump(annotation)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onJump(annotation)
        }
      }}
      title={detached ? 'This edit was later replaced — history record only' : 'Jump to in document'}
      className={cn(
        'group px-4 py-3 hover:bg-muted/40 transition-colors focus:outline-none focus:bg-muted/40',
        detached ? 'opacity-60 cursor-default' : 'cursor-pointer'
      )}
    >
      {/* Meta row: type badge · model · age · jump/remove */}
      <div className="flex items-center gap-2 mb-2">
        <TypeBadge type={annotation.type} />
        {detached && (
          <span
            data-testid="annotation-detached-badge"
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-muted text-muted-foreground"
          >
            superseded
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {formatModelName(annotation.provenance.model)}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">
          {formatAge(annotation.createdAt)}
        </span>
        {!detached && (
          <Crosshair
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-primary/60 group-hover:text-primary transition-colors"
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(annotation.id)
              }}
              className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-destructive transition-all"
              aria-label="Remove AI marking"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove AI marking (keeps the text)</TooltipContent>
        </Tooltip>
      </div>

      {/* Title: the edited content */}
      <p className="text-[15px] leading-snug text-foreground break-words line-clamp-2">
        {snippet}
        {isLong && <span className="text-muted-foreground/50">…</span>}
      </p>

      {/* Explanation */}
      {annotation.explanation && (
        <p className="mt-1.5 text-xs italic text-muted-foreground leading-snug line-clamp-2">
          {annotation.explanation}
        </p>
      )}
    </div>
  )
}

function TypeBadge({ type }: { type: AnnotationType }) {
  const palette =
    type === 'insertion'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : type === 'deletion'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  const symbol = type === 'insertion' ? '+' : type === 'deletion' ? '−' : '~'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        palette
      )}
    >
      {symbol} {type}
    </span>
  )
}

// ─── Comment activity row ──────────────────────────────────────────────────────

interface CommentActivityRowProps {
  comment: CommentData
  onRemove: (id: string) => void
}

function CommentActivityRow({ comment, onRemove }: CommentActivityRowProps) {
  const replies = comment.replies ?? []
  const isResolved = comment.resolved === true

  return (
    <div className="group px-4 py-3 hover:bg-muted/40 transition-colors">
      {/* Meta row: badge · age · remove */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            isResolved
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
          )}
        >
          {isResolved ? <CheckCheck className="h-2.5 w-2.5" /> : <MessageSquare className="h-2.5 w-2.5" />}
          {isResolved ? 'resolved' : 'thread'}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">
          {formatAge(comment.createdAt)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(comment.id)
              }}
              className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-destructive transition-all"
              aria-label="Remove comment thread"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove comment thread</TooltipContent>
        </Tooltip>
      </div>

      {/* Original comment text */}
      <p className="text-[13px] leading-snug text-foreground/80 line-clamp-2 mb-1.5 italic">
        "{comment.comment}"
      </p>

      {/* Replies (up to 3, truncated) */}
      {replies.length > 0 && (
        <div className="flex flex-col gap-1">
          {replies.slice(0, 3).map((reply) => (
            <ReplyChip key={reply.id} reply={reply} />
          ))}
          {replies.length > 3 && (
            <span className="text-[10px] text-muted-foreground/60">
              +{replies.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function ReplyChip({ reply }: { reply: CommentReply }) {
  const isAI = reply.author === 'ai'
  return (
    <div className="flex items-start gap-1.5">
      <span
        className="mt-0.5 shrink-0 text-muted-foreground/60"
        aria-label={isAI ? 'AI' : 'You'}
      >
        {isAI ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
      </span>
      <span className="text-[11px] text-muted-foreground line-clamp-2">{reply.text}</span>
    </div>
  )
}

/**
 * Footer: toggle AI annotation visibility in the editor. Shares a single source of
 * truth with the toolbar's "Hide AI annotations" button (editorStore.annotationsVisible)
 * and mirrors its Eye/EyeOff icon + active-filled state, so the two controls stay in sync.
 */
function AnnotationVisibilityFooter() {
  const annotationsVisible = useEditorStore((s) => s.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((s) => s.toggleAnnotationsVisible)

  return (
    <div className="border-t border-border px-3 py-2 flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">
        Annotations in editor
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleAnnotationsVisible}
            aria-pressed={annotationsVisible}
            aria-label={annotationsVisible ? 'Hide AI annotations' : 'Show AI annotations'}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors',
              annotationsVisible
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {annotationsVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{annotationsVisible ? 'Hide' : 'Show'} AI annotations</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Group activity items by calendar day (newest-first input → newest-first groups). */
function groupActivityByDate(items: ActivityItem[]): ActivityDateGroup[] {
  const groups = new Map<string, ActivityDateGroup>()
  for (const item of items) {
    const label = formatGroupLabel(item.createdAt)
    if (!groups.has(label)) groups.set(label, { label, items: [] })
    groups.get(label)!.items.push(item)
  }
  return Array.from(groups.values())
}

function formatGroupLabel(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)

  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((nowMidnight.getTime() - dateMidnight.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

/**
 * Compact display name for a model string.
 * e.g. "claude-sonnet-4-6" → "Sonnet 4.6", "claude-haiku-4-5-20251001" → "Haiku 4.5",
 * "external" → "External", "Imported" → "Imported".
 */
function formatModelName(model: string): string {
  if (!model || model === 'external') return 'External'
  const tokens = model
    .replace(/^claude[-/]?/, '')
    .replace(/[-\s]?\d{6,}$/, '') // drop a trailing date stamp (e.g. -20251001)
    .split('-')
    .filter(Boolean)
  if (tokens.length === 0) return model
  const name = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1)
  const version = tokens.slice(1).join('.')
  return version ? `${name} ${version}` : name
}

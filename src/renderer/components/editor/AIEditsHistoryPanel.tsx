/**
 * AI Edits History Panel (Activity)
 *
 * A live view of the AI authorship annotations and comment threads on the
 * current document. Annotations derive from the annotation store; comment
 * activity (open / pending / resolved threads + replies) derives from the
 * comment store. Redesigned per the Claude Design "Comment Threads" handoff:
 * status-badged cards, expand/collapse, avatar reply previews, resolved threads
 * shown greyed (click to brighten for review), and a multi-category filter that
 * toggles any item type (open/pending/resolved threads, current/superseded
 * edits) on or off.
 *
 * Surface: rendered inside the chat sidebar when the user selects the Activity
 * tab in the ChatPanel header. The filter lives in that header; this panel
 * receives the resulting ActivityFilter as a prop.
 */

import { useCallback, useMemo, useState } from 'react'
import { Wand2, Crosshair, X, MessageSquare, CheckCheck, Clock, ArrowUpRight, User, Eye, EyeOff } from 'lucide-react'
import { useAnnotationStore } from '../../extensions/ai-annotations/store'
import { useCommentStore } from '../../extensions/comments/store'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { formatAge } from '../../types/annotations'
import type { AIAnnotation, AnnotationType } from '../../types/annotations'
import type { CommentData, CommentReply } from '../../extensions/comments/types'
import { PROSE_ICONS, IconThumb } from '../../lib/prose-icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { renderMarkdown } from '../chat/ChatMessage'
import { cn } from '../../lib/utils'

/** Which activity categories are visible. Every category defaults to shown. */
export interface ActivityFilter {
  openThreads: boolean
  pendingThreads: boolean
  resolvedThreads: boolean
  edits: boolean
  superseded: boolean
}

export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = {
  openThreads: true,
  pendingThreads: true,
  resolvedThreads: true,
  edits: true,
  superseded: true,
}

/** Event the Activity panel fires to open a thread's popover on its mark. */
export const OPEN_COMMENT_EVENT = 'prose:open-comment'

// Unified activity item for the mixed feed
type ActivityItem =
  | { kind: 'annotation'; annotation: AIAnnotation; createdAt: number }
  | { kind: 'comment'; comment: CommentData; createdAt: number }

interface ActivityDateGroup {
  label: string
  items: ActivityItem[]
}

/** Classify a comment into one of the three thread categories. */
function commentCategory(c: CommentData): 'open' | 'pending' | 'resolved' {
  if (c.resolved) return 'resolved'
  return (c.replies?.length ?? 0) > 0 ? 'open' : 'pending'
}

/** Whether an item passes the active filter. Exported so the tab badge count
 *  in ChatPanel can use the same predicate. */
export function activityItemVisible(
  item: { kind: 'annotation'; annotation: AIAnnotation } | { kind: 'comment'; comment: CommentData },
  f: ActivityFilter
): boolean {
  if (item.kind === 'annotation') {
    return item.annotation.detached ? f.superseded : f.edits
  }
  const cat = commentCategory(item.comment)
  return cat === 'open' ? f.openThreads : cat === 'pending' ? f.pendingThreads : f.resolvedThreads
}

interface AIEditsHistoryPanelProps {
  /** Active category filter. Owned by ChatPanel's tab header. */
  filter: ActivityFilter
  /** Reset the filter to show everything (wired to the filtered-empty CTA). */
  onShowAll: () => void
}

export function AIEditsHistoryPanel({ filter, onShowAll }: AIEditsHistoryPanelProps) {
  const annotations = useAnnotationStore((s) => s.annotations)
  const removeAnnotation = useAnnotationStore((s) => s.removeAnnotation)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const documentId = useCommentStore((s) => s.documentId)
  const saveComments = useCommentStore((s) => s.saveComments)
  const editor = useEditorInstanceStore((s) => s.editor)

  // Build the unified, filtered feed (newest-first).
  const items: ActivityItem[] = useMemo(() => {
    const annotationItems: ActivityItem[] = annotations
      .filter((a) => activityItemVisible({ kind: 'annotation', annotation: a }, filter))
      .map((a) => ({ kind: 'annotation', annotation: a, createdAt: a.createdAt }))
    const commentItems: ActivityItem[] = pendingComments
      .filter((c) => activityItemVisible({ kind: 'comment', comment: c }, filter))
      .map((c) => ({
        kind: 'comment',
        comment: c,
        createdAt:
          c.replies && c.replies.length > 0
            ? c.replies[c.replies.length - 1].createdAt
            : c.createdAt,
      }))
    return [...annotationItems, ...commentItems].sort((a, b) => b.createdAt - a.createdAt)
  }, [annotations, pendingComments, filter])

  const hasAnyActivity = annotations.length > 0 || pendingComments.length > 0
  const nothingVisible = items.length === 0
  const groups = useMemo(() => groupActivityByDate(items), [items])

  const handleJump = useCallback(
    (annotation: AIAnnotation) => {
      if (!editor) return
      if (annotation.detached) return // detached entries are history-only (#674)
      editor.commands.setTextSelection({ from: annotation.from, to: annotation.to })
      editor.commands.focus()
      const { selection } = editor.state
      const domAtPos = editor.view.domAtPos(selection.from)
      const el = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [editor]
  )

  const handleRemoveAnnotation = useCallback((id: string) => removeAnnotation(id), [removeAnnotation])

  const handleRemoveComment = useCallback(
    (id: string) => {
      const { pendingComments: current } = useCommentStore.getState()
      const updated = current.filter((c) => c.id !== id)
      useCommentStore.setState({ pendingComments: updated })
      if (documentId) saveComments(documentId, updated)
      editor?.commands.unsetComment(id)
    },
    [editor, documentId, saveComments]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAnyActivity ? (
          <EmptyState />
        ) : nothingVisible ? (
          <FilteredEmptyState onShowAll={onShowAll} />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <ActivityDateGroupView
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
      <AnnotationVisibilityFooter />
    </div>
  )
}

// ─── Empty states ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Wand2 className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">No activity yet</p>
      <p className="max-w-[180px] text-[10px] leading-relaxed text-muted-foreground/60">
        AI edits and comment thread activity will appear here.
      </p>
    </div>
  )
}

function FilteredEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">Everything is filtered out</p>
      <button
        onClick={onShowAll}
        className="text-[10px] text-muted-foreground/80 underline-offset-2 hover:underline"
      >
        Show all
      </button>
    </div>
  )
}

// ─── Group ──────────────────────────────────────────────────────────────────

interface ActivityDateGroupProps {
  label: string
  items: ActivityItem[]
  onJumpAnnotation: (annotation: AIAnnotation) => void
  onRemoveAnnotation: (id: string) => void
  onRemoveComment: (id: string) => void
}

function ActivityDateGroupView({
  label,
  items,
  onJumpAnnotation,
  onRemoveAnnotation,
  onRemoveComment,
}: ActivityDateGroupProps) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
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

// ─── Annotation row (kept; aligned styling) ─────────────────────────────────

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
        'group px-4 py-3 transition-colors focus:bg-muted/40 focus:outline-none',
        detached ? 'cursor-default opacity-60 hover:opacity-100' : 'cursor-pointer hover:bg-muted/40'
      )}
    >
      <div className="mb-2 flex items-center gap-2">
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
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">{formatAge(annotation.createdAt)}</span>
        {!detached && (
          <Crosshair aria-hidden className="h-4 w-4 shrink-0 text-primary/60 transition-colors group-hover:text-primary" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(annotation.id)
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
              aria-label="Remove AI marking"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove AI marking (keeps the text)</TooltipContent>
        </Tooltip>
      </div>
      <p className="line-clamp-2 break-words text-[15px] leading-snug text-foreground">
        {snippet}
        {isLong && <span className="text-muted-foreground/50">…</span>}
      </p>
      {annotation.explanation && (
        <p className="mt-1.5 line-clamp-2 text-xs italic leading-snug text-muted-foreground">{annotation.explanation}</p>
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

// ─── Comment thread card ────────────────────────────────────────────────────

interface CommentActivityRowProps {
  comment: CommentData
  onRemove: (id: string) => void
}

function CommentActivityRow({ comment, onRemove }: CommentActivityRowProps) {
  const [expanded, setExpanded] = useState(false)
  const replies = comment.replies ?? []
  const category = commentCategory(comment)
  const isResolved = category === 'resolved'
  const last = replies.length > 0 ? replies[replies.length - 1] : null
  const hasMark = !isResolved // resolved threads remove their mark from the doc

  const openInDocument = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(OPEN_COMMENT_EVENT, { detail: { id: comment.id } }))
  }

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        'group cursor-pointer px-4 py-3 transition-all hover:bg-muted/40',
        // Resolved threads read quiet until clicked open (then full brightness).
        isResolved && !expanded && 'opacity-60 hover:opacity-100'
      )}
    >
      {/* Badge + time + remove */}
      <div className="mb-2 flex items-center gap-2">
        <ThreadBadge category={category} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">{formatAge(comment.createdAt)}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(comment.id)
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
              aria-label="Remove comment thread"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove comment thread</TooltipContent>
        </Tooltip>
      </div>

      {/* Quote */}
      {comment.markedText?.trim() && (
        <p className="mb-2 line-clamp-2 text-[13.5px] italic leading-snug text-foreground/80">
          “{comment.markedText.trim()}”
        </p>
      )}

      {!expanded ? (
        // Collapsed: comment (1 line) + last reply / awaiting (2 lines)
        <div className="flex flex-col gap-1.5">
          <PreviewRow kind="user" text={comment.comment} clamp={1} />
          {last ? (
            <PreviewRow kind={last.author === 'ai' ? 'ai' : 'user'} text={last.text} clamp={2} markdown={last.author === 'ai'} />
          ) : !isResolved ? (
            <PreviewRow kind="pending" text="Awaiting AI reply…" clamp={1} />
          ) : null}
        </div>
      ) : (
        // Expanded: full thread + open-in-document
        <div className="flex flex-col gap-2.5">
          <FullRow kind="user" name="you" time={formatAge(comment.createdAt)} text={comment.comment} />
          {replies.map((r) => (
            <FullRow
              key={r.id}
              kind={r.author === 'ai' ? 'ai' : 'user'}
              name={r.author === 'ai' ? 'Prose' : 'you'}
              time={formatAge(r.createdAt)}
              text={r.text}
              markdown={r.author === 'ai'}
            />
          ))}
          {hasMark && (
            <button
              onClick={openInDocument}
              className="inline-flex items-center gap-1 self-start text-[11.5px] font-medium text-violet-600 hover:underline dark:text-violet-400"
            >
              Open in document
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ThreadBadge({ category }: { category: 'open' | 'pending' | 'resolved' }) {
  if (category === 'resolved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        <CheckCheck className="h-3 w-3" />
        Resolved
      </span>
    )
  }
  if (category === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-pink-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-pink-600 dark:text-pink-400">
        <Clock className="h-3 w-3" />
        Pending
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">
      <MessageSquare className="h-3 w-3" />
      Thread
    </span>
  )
}

// ─── Avatars + rows ─────────────────────────────────────────────────────────

function MiniAvatar({ kind }: { kind: 'ai' | 'user' | 'pending' }) {
  const iconId = useSettingsStore((s) => s.settings.appearance.icon)
  if (kind === 'ai') {
    const selected = PROSE_ICONS.find((i) => i.id === iconId) ?? PROSE_ICONS[0]
    return (
      <span className="mt-px shrink-0">
        <IconThumb Component={selected.Component} size={18} />
      </span>
    )
  }
  if (kind === 'pending') {
    return (
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-pink-500/15 text-pink-600 dark:text-pink-400">
        <Clock className="h-2.5 w-2.5" />
      </span>
    )
  }
  return (
    <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground">
      <User className="h-2.5 w-2.5" />
    </span>
  )
}

function PreviewRow({
  kind,
  text,
  clamp,
  markdown,
}: {
  kind: 'ai' | 'user' | 'pending'
  text: string
  clamp: 1 | 2
  markdown?: boolean
}) {
  const editor = useEditorInstanceStore((s) => s.editor)
  return (
    <div className="flex items-start gap-2">
      <MiniAvatar kind={kind} />
      <div
        className={cn(
          'min-w-0 text-[12.5px] leading-snug',
          kind === 'pending' ? 'text-muted-foreground/80 italic' : 'text-foreground/75',
          clamp === 1 ? 'line-clamp-1' : 'line-clamp-2'
        )}
      >
        {markdown ? <span className="[&_*]:inline">{renderMarkdown(text, editor)}</span> : text}
      </div>
    </div>
  )
}

function FullRow({
  kind,
  name,
  time,
  text,
  markdown,
}: {
  kind: 'ai' | 'user'
  name: string
  time: string
  text: string
  markdown?: boolean
}) {
  const editor = useEditorInstanceStore((s) => s.editor)
  return (
    <div className="flex items-start gap-2">
      <MiniAvatar kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] text-muted-foreground">
          {name} · {time}
        </div>
        {markdown ? (
          <div className="prose-chat break-words text-[12.5px] leading-relaxed text-foreground/85">
            {renderMarkdown(text, editor)}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/85">{text}</div>
        )}
      </div>
    </div>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function AnnotationVisibilityFooter() {
  const annotationsVisible = useEditorStore((s) => s.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((s) => s.toggleAnnotationsVisible)
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <span className="text-[10px] text-muted-foreground">Annotations in editor</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleAnnotationsVisible}
            aria-pressed={annotationsVisible}
            aria-label={annotationsVisible ? 'Hide AI annotations' : 'Show AI annotations'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              annotationsVisible ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
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

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

function formatModelName(model: string): string {
  if (!model || model === 'external') return 'External'
  const tokens = model
    .replace(/^claude[-/]?/, '')
    .replace(/[-\s]?\d{6,}$/, '')
    .split('-')
    .filter(Boolean)
  if (tokens.length === 0) return model
  const name = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1)
  const version = tokens.slice(1).join('.')
  return version ? `${name} ${version}` : name
}

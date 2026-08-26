import type { MarkType, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { useEditorStore } from '../../stores/editorStore'
import { isHumanSuggesting } from '../../stores/humanSuggestionModeStore'
import type { AISuggestionData } from './types'
import {
  HUMAN_SUGGESTION_TRANSACTION,
  findHumanSuggestion,
  hasSuggestionInRange,
  humanInsertionCoveringRange,
  humanMarkAttrs,
  queueSuggestionCancellation,
  queueSuggestionRecord,
  suggestionData,
  type HumanSuggestionTarget,
} from './humanSuggestionShared'

export const humanSuggestionPluginKey = new PluginKey('humanSuggestions')
const GROUP_WINDOW_MS = 1500

interface ActiveGroup {
  id: string
  type: 'insertion' | 'deletion'
  documentId: string
  lastChangedAt: number
}

interface TextChange {
  from: number
  to: number
  originalText: string
  suggestedText: string
  direction: 'backward' | 'forward'
  changedInsertion?: HumanSuggestionTarget
}

let activeGroup: ActiveGroup | null = null

function isTrackableTransaction(transaction: Transaction): boolean {
  if (!transaction.docChanged || transaction.getMeta(HUMAN_SUGGESTION_TRANSACTION)) return false
  const uiEvent = transaction.getMeta('uiEvent')
  return uiEvent === 'input'
    || uiEvent === 'paste'
    || uiEvent === 'cut'
    || transaction.getMeta('composition') !== undefined
}

function simpleTextChange(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): TextChange | null {
  let candidateIndex = -1
  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    if (isTrackableTransaction(transactions[index])) {
      candidateIndex = index
      break
    }
  }
  if (candidateIndex < 0) return null

  const candidate = transactions[candidateIndex]
  if (candidate.steps.length !== 1 || !(candidate.steps[0] instanceof ReplaceStep)) return null
  const step = candidate.steps[0]
  const beforeDoc = candidate.docs[0]
  if (!beforeDoc) return null

  const $from = beforeDoc.resolve(step.from)
  const $to = beforeDoc.resolve(step.to)
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return null

  const suggestedText = step.slice.content.textBetween(0, step.slice.content.size, '\n')
  if (suggestedText.includes('\n') || step.slice.content.size !== suggestedText.length) return null
  const originalText = beforeDoc.textBetween(step.from, step.to, '\n')
  if (originalText.includes('\n') || originalText === suggestedText) return null

  let from = candidate.mapping.map(step.from, -1)
  let to = candidate.mapping.map(step.to, 1)
  for (let index = candidateIndex + 1; index < transactions.length; index += 1) {
    from = transactions[index].mapping.map(from, -1)
    to = transactions[index].mapping.map(to, 1)
  }
  if (from < 0 || to < from || to > newState.doc.content.size) return null
  if (newState.doc.textBetween(from, to, '\n') !== suggestedText) return null

  return {
    from,
    to,
    originalText,
    suggestedText,
    direction: oldState.selection.from > candidate.selection.from ? 'backward' : 'forward',
    changedInsertion: originalText.length > 0
      ? humanInsertionCoveringRange(beforeDoc, step.from, step.to) ?? undefined
      : undefined,
  }
}

function currentGroup(
  doc: PMNode,
  documentId: string,
  type: 'insertion' | 'deletion',
  now: number,
): HumanSuggestionTarget | null {
  if (
    !activeGroup
    || activeGroup.documentId !== documentId
    || activeGroup.type !== type
    || now - activeGroup.lastChangedAt > GROUP_WINDOW_MS
  ) return null
  return findHumanSuggestion(doc, activeGroup.id)
}

function updateOwnInsertion(
  change: TextChange,
  newState: EditorState,
  documentId: string,
  markType: MarkType,
  now: number,
): Transaction | null {
  const previous = change.changedInsertion
  if (!previous) return null

  const tr = newState.tr
  let target = findHumanSuggestion(newState.doc, previous.id)
  if (!target && change.suggestedText.length > 0 && change.from < change.to) {
    target = { ...previous, from: change.from, to: change.to }
  }
  if (!target || target.from >= target.to) {
    activeGroup = null
    queueSuggestionCancellation(suggestionData(previous.attrs, previous.from, previous.to))
    return null
  }

  const suggestedText = newState.doc.textBetween(target.from, target.to, '')
  if (!suggestedText) {
    activeGroup = null
    queueSuggestionCancellation(suggestionData(previous.attrs, previous.from, previous.to))
    return null
  }

  const attrs = humanMarkAttrs({
    id: previous.id,
    type: 'insertion',
    originalText: '',
    suggestedText,
    createdAt: typeof previous.attrs.createdAt === 'number' ? previous.attrs.createdAt : now,
    documentId,
  })
  tr.removeMark(target.from, target.to, markType)
  tr.addMark(target.from, target.to, markType.create(attrs))
  tr.setStoredMarks([])
  tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)

  const data = suggestionData(attrs, target.from, target.to)
  activeGroup = { id: previous.id, type: 'insertion', documentId, lastChangedAt: now }
  queueSuggestionRecord(data, false)
  return tr
}

function captureInsertion(
  change: TextChange,
  newState: EditorState,
  documentId: string,
  markType: MarkType,
  now: number,
): Transaction | null {
  const tr = newState.tr
  const existing = currentGroup(newState.doc, documentId, 'insertion', now)
  const touches = existing && change.from <= existing.to && change.to >= existing.from
  let data: AISuggestionData
  let isNew = true

  if (existing && touches) {
    const from = Math.min(existing.from, change.from)
    const to = Math.max(existing.to, change.to)
    const attrs = humanMarkAttrs({
      id: existing.id,
      type: 'insertion',
      originalText: '',
      suggestedText: newState.doc.textBetween(from, to, ''),
      createdAt: typeof existing.attrs.createdAt === 'number' ? existing.attrs.createdAt : now,
      documentId,
    })
    tr.removeMark(existing.from, existing.to, markType)
    tr.addMark(from, to, markType.create(attrs))
    data = suggestionData(attrs, from, to)
    isNew = false
  } else {
    if (hasSuggestionInRange(newState.doc, change.from, change.to)) return null
    const attrs = humanMarkAttrs({
      id: crypto.randomUUID(),
      type: 'insertion',
      originalText: '',
      suggestedText: change.suggestedText,
      createdAt: now,
      documentId,
    })
    tr.addMark(change.from, change.to, markType.create(attrs))
    data = suggestionData(attrs, change.from, change.to)
  }

  activeGroup = { id: data.id, type: 'insertion', documentId, lastChangedAt: now }
  tr.setStoredMarks([])
  tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  queueSuggestionRecord(data, isNew)
  return tr
}

function captureDeletion(
  change: TextChange,
  newState: EditorState,
  documentId: string,
  markType: MarkType,
  now: number,
): Transaction | null {
  const tr = newState.tr
  const beforeInsert = currentGroup(newState.doc, documentId, 'deletion', now)
  tr.insertText(change.originalText, change.from)
  const insertedFrom = change.from
  const insertedTo = change.from + change.originalText.length
  const existing = beforeInsert
    ? {
        ...beforeInsert,
        from: tr.mapping.map(beforeInsert.from, 1),
        to: tr.mapping.map(beforeInsert.to, 1),
      }
    : null
  const touches = existing && insertedFrom <= existing.to && insertedTo >= existing.from
  let data: AISuggestionData
  let isNew = true

  if (existing && touches) {
    const from = Math.min(existing.from, insertedFrom)
    const to = Math.max(existing.to, insertedTo)
    const attrs = humanMarkAttrs({
      id: existing.id,
      type: 'deletion',
      originalText: tr.doc.textBetween(from, to, ''),
      suggestedText: '',
      createdAt: typeof existing.attrs.createdAt === 'number' ? existing.attrs.createdAt : now,
      documentId,
    })
    tr.removeMark(existing.from, existing.to, markType)
    tr.addMark(from, to, markType.create(attrs))
    data = suggestionData(attrs, from, to)
    isNew = false
  } else {
    if (hasSuggestionInRange(tr.doc, insertedFrom, insertedTo)) return null
    const attrs = humanMarkAttrs({
      id: crypto.randomUUID(),
      type: 'deletion',
      originalText: change.originalText,
      suggestedText: '',
      createdAt: now,
      documentId,
    })
    tr.addMark(insertedFrom, insertedTo, markType.create(attrs))
    data = suggestionData(attrs, insertedFrom, insertedTo)
  }

  activeGroup = { id: data.id, type: 'deletion', documentId, lastChangedAt: now }
  tr.setSelection(TextSelection.create(tr.doc, change.direction === 'backward' ? data.from : data.to))
  tr.setStoredMarks([])
  tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  queueSuggestionRecord(data, isNew)
  return tr
}

function captureReplacement(
  change: TextChange,
  newState: EditorState,
  documentId: string,
  markType: MarkType,
  now: number,
): Transaction {
  activeGroup = null
  const tr = newState.tr
  tr.replaceWith(change.from, change.to, newState.schema.text(change.originalText))
  const to = change.from + change.originalText.length
  const attrs = humanMarkAttrs({
    id: crypto.randomUUID(),
    type: 'edit',
    originalText: change.originalText,
    suggestedText: change.suggestedText,
    createdAt: now,
    documentId,
  })
  tr.addMark(change.from, to, markType.create(attrs))
  tr.setSelection(TextSelection.create(tr.doc, to))
  tr.setStoredMarks([])
  tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  queueSuggestionRecord(suggestionData(attrs, change.from, to), true)
  return tr
}

function captureHumanChange(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const editorState = useEditorStore.getState()
  if (
    !isHumanSuggesting()
    || editorState.sourceMode
    || editorState.isRemarkableReadOnly
    || editorState.isPreviewTab
  ) {
    activeGroup = null
    return null
  }

  const change = simpleTextChange(transactions, oldState, newState)
  if (!change) return null
  const documentId = editorState.document.documentId
  const markType = newState.schema.marks.aiSuggestion
  if (!documentId || !markType) return null

  const now = Date.now()
  if (change.changedInsertion) return updateOwnInsertion(change, newState, documentId, markType, now)
  if (change.originalText.length === 0) return captureInsertion(change, newState, documentId, markType, now)
  if (change.suggestedText.length === 0) return captureDeletion(change, newState, documentId, markType, now)
  if (hasSuggestionInRange(newState.doc, change.from, change.to)) return null
  return captureReplacement(change, newState, documentId, markType, now)
}

export function createHumanSuggestionPlugin(): Plugin {
  return new Plugin({
    key: humanSuggestionPluginKey,
    appendTransaction: captureHumanChange,
  })
}

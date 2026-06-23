import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  createElement,
  type RefObject,
  type ReactNode
} from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useChatStore } from '../stores/chatStore'
import { useFileListStore } from '../stores/fileListStore'
import { getActiveReviewMode, type ReviewMode } from '../stores/reviewStore'

// --- Constants ---

const FILE_LIST_MIN_PX = 280
const FILE_LIST_MAX_PX = 500
export const CHAT_MIN_PX = 280
const CHAT_MAX_PX = 610
const EDITOR_MIN_PX = 360
const BOTH_PANELS_MIN_WIDTH = 1000
const FILE_LIST_DEFAULT_PCT = 20
export const QUICK_REVIEW_DEFAULT_PX = 370

// --- Types ---

interface PanelSizes {
  fileListMin: number
  fileListMax: number
  editorMin: number
  chatMin: number
  chatMax: number
}

interface PanelLayoutValue {
  isChatOpen: boolean
  isFileListOpen: boolean
  toggleChat: () => void
  toggleFileList: () => void
  setChatOpen: (open: boolean) => void
  setFileListOpen: (open: boolean) => void
  panelSizes: PanelSizes
  canOpenBothPanels: boolean
}

// --- Context ---

const PanelLayoutContext = createContext<PanelLayoutValue | null>(null)

export function usePanelLayoutContext(): PanelLayoutValue {
  const ctx = useContext(PanelLayoutContext)
  if (!ctx) {
    throw new Error('usePanelLayoutContext must be used within PanelLayoutProvider')
  }
  return ctx
}

// --- Helper ---

function calcPanelSizes(windowWidth: number): PanelSizes {
  return {
    fileListMin: (FILE_LIST_MIN_PX / windowWidth) * 100,
    fileListMax: (FILE_LIST_MAX_PX / windowWidth) * 100,
    editorMin: (EDITOR_MIN_PX / windowWidth) * 100,
    chatMin: (CHAT_MIN_PX / windowWidth) * 100,
    chatMax: (CHAT_MAX_PX / windowWidth) * 100
  }
}

// Default chat width on open: split the space left after the file explorer evenly
// with the editor (so the editor isn't squeezed when the explorer is also open),
// clamped to the chat panel's min/max. With the explorer closed this returns 50.
export function chatOpenDefaultPct(opts: { fileListPct: number; chatMin: number; chatMax: number }): number {
  const pct = (100 - opts.fileListPct) / 2
  return Math.min(Math.max(pct, opts.chatMin), opts.chatMax)
}

// Default width for Comment Review on open. Wider than Quick Review's fixed
// strip: half of the space after the file explorer when the explorer is open, a
// third of it when closed. (Closed → fileListPct is 0, so this is a third of the
// window.) Clamped to the chat panel's min/max.
export function commentReviewPct(opts: {
  fileListPct: number
  isFileListOpen: boolean
  chatMin: number
  chatMax: number
}): number {
  const pct = (100 - opts.fileListPct) / (opts.isFileListOpen ? 2 : 3)
  return Math.min(Math.max(pct, opts.chatMin), opts.chatMax)
}

// The chat panel's target width % when it opens, accounting for the active
// review mode. Single owner so the open-from-closed resize (usePanelLayout) and
// the enter/switch-review resize (App) agree — otherwise the generic chat
// default would override the review-specific sizing as the panel opens.
export function reviewChatWidthPct(opts: {
  reviewMode: ReviewMode | null
  fileListPct: number
  isFileListOpen: boolean
  windowWidth: number
  chatMin: number
  chatMax: number
}): number {
  if (opts.reviewMode === 'side-by-side') return 60
  if (opts.reviewMode === 'comments') {
    return commentReviewPct({
      fileListPct: opts.fileListPct,
      isFileListOpen: opts.isFileListOpen,
      chatMin: opts.chatMin,
      chatMax: opts.chatMax
    })
  }
  if (opts.reviewMode === 'quick') {
    return (QUICK_REVIEW_DEFAULT_PX / opts.windowWidth) * 100
  }
  return chatOpenDefaultPct({ fileListPct: opts.fileListPct, chatMin: opts.chatMin, chatMax: opts.chatMax })
}

// --- Hook ---

interface UsePanelLayoutOpts {
  fileListPanelRef: RefObject<ImperativePanelHandle | null>
  chatPanelRef: RefObject<ImperativePanelHandle | null>
}

export function usePanelLayout({ fileListPanelRef, chatPanelRef }: UsePanelLayoutOpts): PanelLayoutValue {
  // Store state
  const isChatOpen = useChatStore((s) => s.isPanelOpen)
  const isFileListOpen = useFileListStore((s) => s.isPanelOpen)
  const storeChatSetOpen = useChatStore((s) => s.setPanelOpen)
  const storeFileListSetOpen = useFileListStore((s) => s.setPanelOpen)

  const [panelSizes, setPanelSizes] = useState(() => calcPanelSizes(window.innerWidth))
  const [canOpenBothPanels, setCanOpenBothPanels] = useState(
    () => window.innerWidth >= BOTH_PANELS_MIN_WIDTH
  )

  // --- Public API (store-only; imperative resize handled by useLayoutEffect) ---

  const setChatOpen = useCallback(
    (open: boolean) => {
      if (open && window.innerWidth < BOTH_PANELS_MIN_WIDTH && isFileListOpen) {
        storeFileListSetOpen(false)
      }
      storeChatSetOpen(open)
    },
    [isFileListOpen, storeChatSetOpen, storeFileListSetOpen]
  )

  const setFileListOpen = useCallback(
    (open: boolean) => {
      if (open && window.innerWidth < BOTH_PANELS_MIN_WIDTH && isChatOpen) {
        storeChatSetOpen(false)
      }
      storeFileListSetOpen(open)
    },
    [isChatOpen, storeChatSetOpen, storeFileListSetOpen]
  )

  const toggleChat = useCallback(() => {
    setChatOpen(!isChatOpen)
  }, [isChatOpen, setChatOpen])

  const toggleFileList = useCallback(() => {
    setFileListOpen(!isFileListOpen)
  }, [isFileListOpen, setFileListOpen])

  // --- Reactive sync: store → imperative resize ---
  // Fires after React re-renders (so minSize is already updated), before browser paint.
  // Handles both direct callers (toggleChat) and external callers.

  const prevChatOpen = useRef(isChatOpen)
  const prevFileListOpen = useRef(isFileListOpen)

  useLayoutEffect(() => {
    if (isChatOpen !== prevChatOpen.current) {
      if (isChatOpen) {
        const fileListPct = isFileListOpen ? (fileListPanelRef.current?.getSize() ?? 0) : 0
        // Review-aware: when the panel opens while a review mode is active, size
        // it for that review (Comment Review = 50%/33%, Quick = ~370px, etc.)
        // instead of the generic chat default that would otherwise override it.
        chatPanelRef.current?.resize(
          reviewChatWidthPct({
            reviewMode: getActiveReviewMode(),
            fileListPct,
            isFileListOpen,
            windowWidth: window.innerWidth,
            chatMin: panelSizes.chatMin,
            chatMax: panelSizes.chatMax
          })
        )
      } else {
        chatPanelRef.current?.resize(0)
      }
    }

    if (isFileListOpen !== prevFileListOpen.current) {
      if (isFileListOpen) {
        fileListPanelRef.current?.resize(FILE_LIST_DEFAULT_PCT)
      } else {
        fileListPanelRef.current?.resize(0)
      }
    }

    prevChatOpen.current = isChatOpen
    prevFileListOpen.current = isFileListOpen
  }, [isChatOpen, isFileListOpen, chatPanelRef, fileListPanelRef, panelSizes])

  // --- Mount: force panels to match store state ---
  // react-resizable-panels restores persisted sizes from localStorage
  // (autoSaveId), which may give closed panels non-zero width.
  useEffect(() => {
    if (!isChatOpen) {
      chatPanelRef.current?.resize(0)
    }
    if (!isFileListOpen) {
      fileListPanelRef.current?.resize(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount only

  // --- Window resize listener ---

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const handleResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        const width = window.innerWidth
        setPanelSizes(calcPanelSizes(width))
        setCanOpenBothPanels(width >= BOTH_PANELS_MIN_WIDTH)

        // If both panels open and window shrunk below threshold, close file list
        const chatOpen = useChatStore.getState().isPanelOpen
        const fileListOpen = useFileListStore.getState().isPanelOpen
        if (chatOpen && fileListOpen && width < BOTH_PANELS_MIN_WIDTH) {
          useFileListStore.getState().setPanelOpen(false)
        }
      }, 150)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return {
    isChatOpen,
    isFileListOpen,
    toggleChat,
    toggleFileList,
    setChatOpen,
    setFileListOpen,
    panelSizes,
    canOpenBothPanels
  }
}

// --- Provider ---

export function PanelLayoutProvider({
  value,
  children
}: {
  value: PanelLayoutValue
  children: ReactNode
}) {
  return createElement(PanelLayoutContext.Provider, { value }, children)
}

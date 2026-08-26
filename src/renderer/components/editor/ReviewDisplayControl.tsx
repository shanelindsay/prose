import { Eye } from 'lucide-react'
import { useEditorStore, type ReviewDisplayMode } from '../../stores/editorStore'
import {
  useHumanSuggestionModeStore,
  type HumanEditingMode,
} from '../../stores/humanSuggestionModeStore'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

const EDITING_MODE_OPTIONS: Array<{
  value: HumanEditingMode
  label: string
  description: string
}> = [
  {
    value: 'editing',
    label: 'Editing',
    description: 'Apply your changes directly',
  },
  {
    value: 'suggesting',
    label: 'Suggesting',
    description: 'Track your text changes for review',
  },
]

const REVIEW_DISPLAY_OPTIONS: Array<{ value: ReviewDisplayMode; label: string; description: string }> = [
  {
    value: 'all',
    label: 'All changes',
    description: 'Show insertions and deletions inline',
  },
  {
    value: 'insertions',
    label: 'Insertions highlighted',
    description: 'Show proposed wording and hide deletions',
  },
  {
    value: 'simple',
    label: 'Simple markup',
    description: 'Show proposed wording with subtle indicators',
  },
  {
    value: 'original',
    label: 'Original',
    description: 'Show the document before pending changes',
  },
  {
    value: 'final',
    label: 'Final',
    description: 'Show the document after pending changes',
  },
]

export function reviewDisplayModeLabel(mode: ReviewDisplayMode): string {
  return REVIEW_DISPLAY_OPTIONS.find((option) => option.value === mode)?.label ?? 'All changes'
}

function editingModeLabel(mode: HumanEditingMode): string {
  return EDITING_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Editing'
}

export function ReviewDisplayControl() {
  const displayMode = useEditorStore((state) => state.reviewDisplayMode)
  const setDisplayMode = useEditorStore((state) => state.setReviewDisplayMode)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isPreviewTab = useEditorStore((state) => state.isPreviewTab)
  const editingMode = useHumanSuggestionModeStore((state) => state.mode)
  const setEditingMode = useHumanSuggestionModeStore((state) => state.setMode)
  const activeDisplayLabel = reviewDisplayModeLabel(displayMode)
  const activeEditingLabel = editingModeLabel(editingMode)
  const suggestingUnavailable = sourceMode || isRemarkableReadOnly || isPreviewTab
  const accessibleLabel = `${activeEditingLabel} mode. Review display: ${activeDisplayLabel}`

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="review-display-control"
              aria-label={accessibleLabel}
              title={accessibleLabel}
              className={editingMode === 'suggesting'
                ? 'bg-accent text-accent-foreground ring-1 ring-primary/40'
                : 'bg-accent text-accent-foreground'}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{accessibleLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>How you edit</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={editingMode}
          onValueChange={(value) => {
            if (value === 'editing' || value === 'suggesting') {
              setEditingMode(value)
            }
          }}
        >
          {EDITING_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.value === 'suggesting' && suggestingUnavailable}
              data-testid={`human-editing-mode-${option.value}`}
              className="items-start"
            >
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {option.value === 'suggesting' && suggestingUnavailable
                    ? 'Available in the editable WYSIWYG view'
                    : option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Review display</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={displayMode}
          onValueChange={(value) => {
            if (REVIEW_DISPLAY_OPTIONS.some((option) => option.value === value)) {
              setDisplayMode(value as ReviewDisplayMode)
            }
          }}
        >
          {REVIEW_DISPLAY_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              data-testid={`review-display-mode-${option.value}`}
              className="items-start"
            >
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-[11px] font-normal text-muted-foreground">{option.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

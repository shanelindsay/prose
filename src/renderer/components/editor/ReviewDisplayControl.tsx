import { Eye } from 'lucide-react'
import { useEditorStore, type ReviewDisplayMode } from '../../stores/editorStore'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

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

export function ReviewDisplayControl() {
  const mode = useEditorStore((state) => state.reviewDisplayMode)
  const setMode = useEditorStore((state) => state.setReviewDisplayMode)
  const activeLabel = reviewDisplayModeLabel(mode)
  const accessibleLabel = `Review display: ${activeLabel}`

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
              className="bg-accent text-accent-foreground"
            >
              <Eye className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{accessibleLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Review display</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (REVIEW_DISPLAY_OPTIONS.some((option) => option.value === value)) {
              setMode(value as ReviewDisplayMode)
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


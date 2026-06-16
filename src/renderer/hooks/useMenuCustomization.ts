import { useCallback, useMemo } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export interface MenuItemDescriptor {
  /** Stable string ID — used as the key in the customization registry. */
  id: string
  label: string
}

/**
 * Returns the ordered, filtered set of visible item IDs for a given menu,
 * plus helpers to persist changes.
 *
 * Rules:
 *  - Items unknown to the saved config append **visible** at the tail, so
 *    upgrades that add new menu items never hide them for existing users.
 *  - `hidden` items are excluded from `visibleIds`; they are presented
 *    separately in the "Hidden" section of the customization UI.
 */
export function useMenuCustomization(menuId: string, allItems: MenuItemDescriptor[]) {
  const menuCustomization = useSettingsStore((s) => s.settings.menuCustomization)
  const setMenuCustomization = useSettingsStore((s) => s.setMenuCustomization)

  const saved = menuCustomization?.[menuId]

  // Merge saved config with the canonical item list.
  // Items absent from the saved order append at the end.
  const { visibleIds, hiddenIds, orderedAllIds } = useMemo(() => {
    const allIds = allItems.map((i) => i.id)

    if (!saved) {
      return { visibleIds: allIds, hiddenIds: [] as string[], orderedAllIds: allIds }
    }

    const { order, hidden } = saved
    // Start with saved order, filtered to only known ids
    const knownOrdered = order.filter((id) => allIds.includes(id))
    // Append ids that are new (not in saved order) so upgrades stay visible
    const newIds = allIds.filter((id) => !order.includes(id))
    const full = [...knownOrdered, ...newIds]

    return {
      visibleIds: full.filter((id) => !hidden.includes(id)),
      hiddenIds: hidden.filter((id) => allIds.includes(id)),
      orderedAllIds: full,
    }
  }, [allItems, saved])

  const save = useCallback(
    (order: string[], hidden: string[]) => {
      setMenuCustomization(menuId, { order, hidden })
    },
    [menuId, setMenuCustomization]
  )

  /** Toggle a single item's hidden state. */
  const toggleHidden = useCallback(
    (id: string) => {
      const currentHidden = hiddenIds.includes(id)
        ? hiddenIds.filter((h) => h !== id)
        : [...hiddenIds, id]
      save(orderedAllIds, currentHidden)
    },
    [hiddenIds, orderedAllIds, save]
  )

  /** Move an item one position earlier in the order. */
  const moveUp = useCallback(
    (id: string) => {
      const idx = orderedAllIds.indexOf(id)
      if (idx <= 0) return
      const next = [...orderedAllIds]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      save(next, hiddenIds)
    },
    [orderedAllIds, hiddenIds, save]
  )

  /** Move an item one position later in the order. */
  const moveDown = useCallback(
    (id: string) => {
      const idx = orderedAllIds.indexOf(id)
      if (idx < 0 || idx >= orderedAllIds.length - 1) return
      const next = [...orderedAllIds]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      save(next, hiddenIds)
    },
    [orderedAllIds, hiddenIds, save]
  )

  return { visibleIds, hiddenIds, orderedAllIds, toggleHidden, moveUp, moveDown, save }
}

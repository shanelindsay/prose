import { isMissingPathFileError } from '../../shared/fileOperationResult'
import { useNotificationStore } from '../stores/notificationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getApi } from './browserApi'

type MissingPathContext = 'open' | 'save' | 'autosave' | 'restore'

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function missingPathMessage(path: string, context: MissingPathContext): string {
  const name = fileName(path)
  if (context === 'save') {
    return `The folder for "${name}" no longer exists. Choose a new location to save it.`
  }
  if (context === 'autosave') {
    return `Autosave stopped because the folder for "${name}" no longer exists. Use Save As to keep your edits.`
  }
  if (context === 'restore') {
    return `"${name}" no longer exists. Restored its last saved tab content as an unsaved document.`
  }
  return `"${name}" no longer exists. It was removed from Recents.`
}

export { isMissingPathFileError }

export function notifyMissingPath(path: string, context: MissingPathContext): void {
  useNotificationStore.getState().notify({
    id: `missing-path:${context}:${path}`,
    message: missingPathMessage(path, context),
    durationMs: context === 'autosave' || context === 'restore' ? 0 : undefined
  })
}

export function pruneRecentFile(path: string): void {
  useSettingsStore.getState().removeRecentFile(path)
}

export function handleMissingPath(path: string, context: MissingPathContext): void {
  pruneRecentFile(path)
  notifyMissingPath(path, context)
}

export async function pruneMissingRecentFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  if (!window.api?.fileExists) return

  const api = getApi()
  const stalePaths: string[] = []

  await Promise.all(
    paths.map(async (path) => {
      try {
        const exists = await api.fileExists(path)
        if (!exists) stalePaths.push(path)
      } catch {
        stalePaths.push(path)
      }
    })
  )

  if (stalePaths.length > 0) {
    useSettingsStore.getState().pruneRecentFiles(stalePaths)
  }
}

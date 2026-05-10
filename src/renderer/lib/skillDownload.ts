/**
 * Centralized handler for the "Download Claude Skill" action invoked from
 * surfaces without their own UI for inline error feedback — the App
 * keyboard handler and the Toolbar dropdown menu. Both have ephemeral
 * surfaces (handler returns immediately, dropdown closes on click) so
 * inline error state isn't viable; alert() is the simplest user-facing
 * fallback.
 *
 * The Settings → Integrations panel uses inline state instead because
 * it's a stable UI surface — see ProseSkillIntegration.tsx. The two
 * patterns are intentionally different per the constraints of each
 * surface, but call sites here go through one helper so the failure
 * message and copy are consistent.
 */
export async function downloadSkillWithAlert(): Promise<void> {
  if (!window.api?.downloadSkill) return
  try {
    const result = await window.api.downloadSkill()
    if (!result?.success) {
      alert(`Failed to download Claude Skill: ${result?.error ?? 'Unknown error'}`)
    }
  } catch (err) {
    alert(`Failed to download Claude Skill: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

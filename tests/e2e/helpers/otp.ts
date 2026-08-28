import type { Page } from '@playwright/test'

/**
 * Saisit un code à usage unique dans un `InputOtp`.
 *
 * Chaque case est remplie individuellement plutôt qu'en frappant la séquence
 * au clavier : `InputOtp` déplace le focus lui-même à chaque touche, et une
 * frappe rapide peut arriver avant que le focus ait suivi. Le symptôme est un
 * test rouge par intermittence, plus fréquent quand la machine est chargée.
 */
export async function remplirCode(page: Page, testId: string, code: string): Promise<void> {
  const cases = page.locator(`[data-testid="${testId}"] input`)
  for (const [i, chiffre] of [...code].entries()) {
    await cases.nth(i).fill(chiffre)
  }
}

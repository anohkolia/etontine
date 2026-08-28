import { useDb } from '../db/index.ts'
import { marquerRetards } from '../services/echeances.ts'

/**
 * Marque en retard les cotisations dont le délai de grâce est dépassé.
 *
 * La logique vit dans `services/echeances.ts` : une tâche Nitro ne s'appelle
 * pas facilement depuis un test unitaire, et cette règle-là mérite d'être
 * couverte.
 */
export default defineTask({
  meta: {
    name: 'mark-late',
    description: 'Marque en retard les cotisations dont le délai de grâce est dépassé',
  },
  async run() {
    return { result: { marquees: marquerRetards(useDb()) } }
  },
})

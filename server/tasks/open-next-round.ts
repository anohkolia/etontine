import { useDb } from '../db/index.ts'
import { ouvrirTourSuivant } from '../services/echeances.ts'

/** Ouvre à la cotisation le tour suivant lorsque sa date est arrivée. */
export default defineTask({
  meta: {
    name: 'open-next-round',
    description: 'Ouvre le tour suivant lorsque sa date est arrivée',
  },
  async run() {
    return { result: { ouverts: ouvrirTourSuivant(useDb()) } }
  },
})

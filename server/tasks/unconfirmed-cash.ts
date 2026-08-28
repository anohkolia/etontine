import { useDb } from '../db/index.ts'
import { signalerEspecesNonConfirmees } from '../services/escalade.ts'

/** Signale les versements en espèces non reconnus après 72 heures. */
export default defineTask({
  meta: {
    name: 'unconfirmed-cash',
    description: 'Signale les versements en espèces qu’aucun membre n’a reconnus',
  },
  async run() {
    return { result: { signalees: signalerEspecesNonConfirmees(useDb()) } }
  },
})

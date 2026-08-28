import { useDb } from '../db/index.ts'
import { envoyerRappels } from '../services/rappels.ts'

/** Rappels de cotisation à J-2 et le jour de l'échéance. */
export default defineTask({
  meta: {
    name: 'due-reminders',
    description: 'Envoie les rappels de cotisation, hors plages de silence',
  },
  async run() {
    return { result: { envoyes: envoyerRappels(useDb()).length } }
  },
})

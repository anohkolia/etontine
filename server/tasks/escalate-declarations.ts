import { useDb } from '../db/index.ts'
import { escaladerDeclarations } from '../services/escalade.ts'

/** Escalade les déclarations sans décision depuis plus de 48 heures. */
export default defineTask({
  meta: {
    name: 'escalate-declarations',
    description: 'Signale au registre les déclarations laissées sans décision',
  },
  async run() {
    return { result: { escaladees: escaladerDeclarations(useDb()) } }
  },
})

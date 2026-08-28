import { setHeader } from 'h3'
import { useDb } from '../../../db/index.ts'
import { exporterDonnees } from '../../../services/compte.ts'
import { requireUser } from '../../../utils/auth.ts'

/** Export des données personnelles — loi n° 2013-450. */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  setHeader(event, 'content-disposition', 'attachment; filename="mes-donnees-tontine.json"')
  return exporterDonnees(useDb(), user.id)
})

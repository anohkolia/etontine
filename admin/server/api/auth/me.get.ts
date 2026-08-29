import { requireAdmin } from '../../utils/garde.ts'

/** L'administrateur courant. Sert à savoir si la session tient encore. */
export default defineEventHandler((event) => {
  return { admin: requireAdmin(event) }
})

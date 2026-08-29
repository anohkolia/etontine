import { destroySession } from '../../../../server/utils/session.ts'

export default defineEventHandler(async (event) => {
  await destroySession(event)
  return { ok: true }
})

import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { collectionChannels } from '../../../../db/schema.ts'
import { requireUser } from '../../../../utils/auth.ts'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  return await useDb()
    .select({
      id: collectionChannels.id,
      provider: collectionChannels.provider,
      msisdn: collectionChannels.msisdn,
      holderName: collectionChannels.holderName,
      paymentLinkUrl: collectionChannels.paymentLinkUrl,
    })
    .from(collectionChannels)
    .where(eq(collectionChannels.userId, user.id))
})

import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { collectionChannels } from '../../../../db/schema.ts'
import { requireUser } from '../../../../utils/auth.ts'

export default defineEventHandler((event) => {
  const user = requireUser(event)

  return useDb()
    .select({
      id: collectionChannels.id,
      provider: collectionChannels.provider,
      msisdn: collectionChannels.msisdn,
      holderName: collectionChannels.holderName,
      paymentLinkUrl: collectionChannels.paymentLinkUrl,
      verifiedAt: collectionChannels.verifiedAt,
    })
    .from(collectionChannels)
    .where(eq(collectionChannels.userId, user.id))
    .all()
})

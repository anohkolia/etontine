import { getRouterParam, setHeader } from 'h3'
import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import { useDb } from '../../../../../../db/index.ts'
import { invites } from '../../../../../../db/schema.ts'
import { requireMembership } from '../../../../../../utils/auth.ts'
import { apiError } from '../../../../../../utils/errors.ts'

/**
 * QR code d'un lien d'invitation, en SVG.
 *
 * Généré **côté serveur** : l'encodeur ne part jamais dans le lot client, où il
 * coûterait plusieurs kilo-octets pour un usage occasionnel. Le SVG se met à
 * l'échelle sans perte, ce qui compte pour un code destiné à être montré sur un
 * écran ou imprimé lors d'une réunion de tontine.
 *
 * Le niveau de correction `M` est un compromis assumé : il tolère environ 15 %
 * d'occultation — assez pour un écran de téléphone tenu à bout de bras ou une
 * photocopie moyenne — sans densifier la trame au point de la rendre illisible
 * en petit format.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  const token = getRouterParam(event, 'token')
  if (!tontineId || !token) throw apiError('NOT_FOUND', 'Invitation introuvable.')

  // Le lien d'invitation est public, mais rien n'oblige à faciliter sa
  // moisson : il faut être membre pour obtenir le QR.
  await requireMembership(event, tontineId)

  const [invitation] = useDb()
    .select()
    .from(invites)
    .where(eq(invites.token, token))
    .limit(1)
    .all()

  if (!invitation || invitation.tontineId !== tontineId) {
    throw apiError('NOT_FOUND', 'Invitation introuvable.')
  }

  const base = process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const svg = await QRCode.toString(`${base}/join/${token}`, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })

  setHeader(event, 'content-type', 'image/svg+xml')
  // Un QR d'invitation ne change pas : on le laisse en cache côté navigateur.
  setHeader(event, 'cache-control', 'private, max-age=3600')

  return svg
})

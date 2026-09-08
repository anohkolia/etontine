import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { tontines } from '../../../../db/schema.ts'
import { canauxDeTontine } from '../../../../services/canaux.ts'
import {
  blocagesPublication, membresActifs, potAttendu, totalParts, tourCourant,
} from '../../../../services/tontines.ts'
import { etatDuTour, toursDe } from '../../../../services/tours.ts'
import { etatVersement } from '../../../../services/versements.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Détail d'une tontine : réglages, progression, tour courant. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)

  const db = useDb()
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  // L'écran de détail peint sa jauge et son bloc « ce que je dois » à partir
  // de cette seule réponse : sans ces trois valeurs, il lui faudrait un second
  // appel pour des chiffres que le serveur a déjà sous la main.
  const tour = tourCourant(db, tontineId)
  const etat = tour ? etatDuTour(db, tour.id, membership.id) : null

  // Le bénéficiaire d'un tour peut avoir une contre-validation à donner, et
  // l'onglet « Verser » ne lui est pas montré — il n'est pas du bureau. Sans
  // ce drapeau, il n'aurait aucun chemin vers l'écran où on l'attend.
  const versement = tour ? etatVersement(db, tour.id, membership.userId ?? undefined) : null

  return {
    ...tontine,
    myRole: membership.role,
    totalShares: totalParts(db, tontineId),
    activeMembers: membresActifs(db, tontineId),
    // Tous les montants sont calculés côté serveur (règle 2). Le client affiche.
    expectedPot: potAttendu(db, tontineId),
    channels: canauxDeTontine(db, tontineId),
    currentRound: tour,
    potCollected: etat?.potCollected ?? 0,
    myRemaining: etat?.myRemaining ?? 0,
    myContributionStatus: etat?.myContributionStatus ?? null,
    awaitingMyCounterValidation: versement?.canCounterValidate ?? false,
    // Le calendrier complet voyage avec le reste. « Je passe quand ? » est la
    // première question qu'on se pose en ouvrant une tontine, et elle n'avait
    // pas de réponse : `GET /tontines/:id/rounds` existait sans appelant, et
    // l'écran ne montrait que le tour courant. Le mettre dans un second appel
    // aurait coûté un aller-retour de plus sur un forfait à la donnée, pour
    // une douzaine de lignes que le serveur a déjà sous la main.
    rounds: toursDe(db, tontineId),
    publicationBlockers: tontine.status === 'draft' ? blocagesPublication(db, tontineId) : [],
  }
})

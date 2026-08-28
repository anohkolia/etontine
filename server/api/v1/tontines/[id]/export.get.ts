import { getQuery, getRouterParam, setHeader } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { rounds } from '../../../../db/schema.ts'
import { procesVerbalPdf, registreXlsx } from '../../../../services/exports.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Export du registre. **Génération côté serveur** (règle 17).
 *
 * `format=pdf` produit le procès-verbal d'un tour, prêt à imprimer et signer.
 * `format=xlsx` produit le registre complet, avec des montants numériques.
 *
 * Accessible à **tout membre actif** : un registre que seul le bureau peut
 * exporter ne remplace pas le carnet posé sur la table.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId)

  const q = getQuery(event)
  const format = q.format === 'xlsx' ? 'xlsx' : 'pdf'
  const db = useDb()

  if (format === 'xlsx') {
    const classeur = await registreXlsx(db, tontineId)
    setHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    setHeader(event, 'content-disposition', 'attachment; filename="registre-tontine.xlsx"')
    return classeur
  }

  // Le procès-verbal porte sur un tour : à défaut d'indication, le dernier
  // tour clos, qui est celui qu'on archive.
  let roundId = typeof q.roundId === 'string' ? q.roundId : null

  if (!roundId) {
    const [dernier] = db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.tontineId, tontineId), eq(rounds.status, 'closed')))
      .orderBy(desc(rounds.index))
      .limit(1)
      .all()

    const [courant] = db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.tontineId, tontineId))
      .orderBy(desc(rounds.index))
      .limit(1)
      .all()

    roundId = dernier?.id ?? courant?.id ?? null
  }

  if (!roundId) throw apiError('NOT_FOUND', 'Aucun tour à exporter.')

  const pdf = await procesVerbalPdf(db, roundId)
  setHeader(event, 'content-type', 'application/pdf')
  setHeader(event, 'content-disposition', 'attachment; filename="proces-verbal.pdf"')
  return pdf
})

export type IssueConfirmation = 'validee' | 'identite_requise' | 'refusee'

/**
 * « Confirmer » une tontine en brouillon — le même geste depuis le wizard, la
 * page de la tontine et l'accueil.
 *
 * Le serveur tranche : `POST /tontines/:id/publish` exige l'identité vérifiée
 * **avant** tout autre contrôle. L'écran ne fait que suivre sa réponse, sans
 * se fier au palier gardé en session — il a pu changer depuis, une
 * approbation tombe au back-office sans prévenir l'onglet ouvert.
 *
 * - identité vérifiée : la tontine est validée d'office, et l'on file vers ses
 *   membres, l'étape suivante ;
 * - identité non vérifiée : direction l'écran de vérification, qui dit
 *   pourquoi, et qui ramène sur la tontine une fois l'identité vérifiée. La
 *   demande, elle, est retenue par le serveur : la tontine sera validée
 *   d'office à l'approbation, sans second « Confirmer » ;
 * - tout autre refus — un réglage manquant, le quota du palier : le message,
 *   sur place, rangé avec la tontine qu'il concerne.
 */
export function useConfirmationTontine() {
  const { t } = useI18n()

  /** La tontine en cours de confirmation, pour n'animer que son bouton. */
  const enCours = ref<string | null>(null)
  const erreur = ref<{ tontineId: string, message: string } | null>(null)

  async function confirmer(tontineId: string): Promise<IssueConfirmation> {
    erreur.value = null
    enCours.value = tontineId
    try {
      await $fetch(`/api/v1/tontines/${tontineId}/publish`, { method: 'POST' })
      await navigateTo(`/app/tontine/${tontineId}/membres`)
      return 'validee'
    }
    catch (e) {
      const refus = (e as { data?: { error?: { code?: string, message?: string } } })?.data?.error
      if (refus?.code === 'KYC_REQUIRED') {
        await navigateTo(adresseVerificationIdentite(MOTIF_VALIDER_TONTINE, `/app/tontine/${tontineId}`))
        return 'identite_requise'
      }
      erreur.value = { tontineId, message: refus?.message ?? t('commun.serveur_injoignable') }
      return 'refusee'
    }
    finally {
      enCours.value = null
    }
  }

  return { confirmer, enCours, erreur }
}

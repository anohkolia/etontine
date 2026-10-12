/**
 * Les alertes du back-office : ce qui attend un administrateur, en nombres.
 *
 * Partagé par la mise en page, qui pose le badge sur l'onglet, et par l'écran
 * des organisateurs, qui le fait baisser dès qu'une arrivée est prise en
 * compte — sans attendre la navigation suivante.
 */
export function useAlertesAdmin() {
  const organisateurs = useState<number>('admin-alertes-organisateurs', () => 0)

  async function rafraichir() {
    try {
      const reponse = await $fetch<{ organisateurs: number }>('/api/alertes')
      organisateurs.value = reponse.organisateurs
    }
    catch {
      // Le badge est un confort : une session expirée ou une coupure ne
      // doivent pas casser l'en-tête. La page concernée, elle, dira l'erreur.
    }
  }

  return { organisateurs, rafraichir }
}

/**
 * Capte l'invitation à installer dès le démarrage.
 *
 * Chrome, Edge et Samsung Internet n'envoient `beforeinstallprompt` qu'une fois
 * par chargement, souvent avant qu'un écran ne s'y intéresse : écouter depuis
 * un composant reviendrait à la manquer. On la met de côté ici, et c'est la
 * fenêtre d'installation qui s'en servira.
 *
 * Sans `preventDefault`, le navigateur afficherait son propre bandeau, au
 * moment qu'il choisit — par-dessus une déclaration de paiement. Son menu et
 * son icône d'installation, eux, restent disponibles.
 */
export default defineNuxtPlugin(() => {
  window.addEventListener('beforeinstallprompt', (evenement) => {
    evenement.preventDefault()
    retenirInvitation(evenement as InvitationInstallation)
  })

  window.addEventListener('appinstalled', () => signalerInstallation())
})

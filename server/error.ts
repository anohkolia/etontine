import type { NitroErrorHandler } from 'nitropack'

/**
 * Gestionnaire d'erreurs unique de l'API.
 *
 * Nitro rend par défaut `{ statusCode, statusMessage, stack… }`, qui n'est pas
 * le format du contrat (docs/api-contract.md) et qui fuit la pile d'appels.
 * Ici, toute erreur d'API sort sous la forme `{ error: { code, message } }`,
 * et rien d'autre.
 *
 * Une erreur non prévue devient un `500` générique : le détail part dans les
 * journaux du serveur, jamais dans la réponse. Un message d'erreur brut peut
 * contenir un identifiant, un numéro de téléphone ou un montant.
 */
const handler: NitroErrorHandler = (error, event) => {
  const estApi = event.path?.startsWith('/api/')
  if (!estApi) return // les pages gardent la page d'erreur de Nuxt

  const statut = error.statusCode ?? 500
  const data = error.data as { error?: unknown } | undefined

  if (data?.error) {
    event.node.res.statusCode = statut
    event.node.res.setHeader('content-type', 'application/json')
    event.node.res.end(JSON.stringify(data))
    return
  }

  if (statut >= 500) {
    console.error('[api] erreur non gérée', error)
  }

  event.node.res.statusCode = statut
  event.node.res.setHeader('content-type', 'application/json')
  event.node.res.end(JSON.stringify({
    error: {
      code: statut >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR',
      message: statut >= 500
        ? 'Une erreur est survenue. Réessaie dans un instant.'
        : (error.statusMessage ?? 'Requête invalide.'),
    },
  }))
}

export default handler

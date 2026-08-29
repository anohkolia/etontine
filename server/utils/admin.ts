import { phoneCI } from '../../shared/schemas/index.ts'

/**
 * Qui est administrateur.
 *
 * Le statut est dérivé d'une **liste blanche de numéros en variable
 * d'environnement**, jamais d'une colonne en base. La propriété qui compte :
 * une compromission de la base de données ne donne pas les droits
 * d'administration. Quelqu'un qui obtiendrait un accès en écriture à la table
 * `users` pourrait se déclarer président de n'importe quelle tontine — il ne
 * pourrait pas approuver une pièce d'identité pour autant.
 *
 * Le revers est assumé : ajouter un administrateur demande un redéploiement.
 * Sur une équipe qui se compte sur les doigts d'une main, c'est un prix
 * dérisoire pour cette garantie.
 *
 * `NUXT_ADMIN_PHONES` contient des numéros séparés par des virgules, dans
 * n'importe quelle notation locale : ils sont normalisés en E.164 comme
 * partout ailleurs (règle 20).
 */
export function numerosAdministrateurs(): string[] {
  const brut = process.env.NUXT_ADMIN_PHONES ?? ''

  return brut
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .flatMap((n) => {
      const parsed = phoneCI.safeParse(n)
      if (!parsed.success) {
        // Un numéro mal saisi dans la configuration ne doit pas passer
        // silencieusement pour un administrateur valide, ni faire tomber le
        // serveur : on le signale et on l'ignore.
        console.error(`[admin] numéro ignoré dans NUXT_ADMIN_PHONES : « ${n} »`)
        return []
      }
      return [parsed.data]
    })
}

export function estAdministrateur(phone: string): boolean {
  const autorises = numerosAdministrateurs()
  // Aucun administrateur configuré : personne ne l'est. Le back-office est
  // alors inaccessible, ce qui vaut mieux qu'un accès ouvert par défaut.
  return autorises.length > 0 && autorises.includes(phone)
}

/**
 * La clé publique VAPID, pour que le navigateur puisse s'abonner.
 *
 * Publique par construction — c'est elle que le navigateur envoie au service
 * de push. La servir par une route plutôt que par une variable
 * `NUXT_PUBLIC_*` évite de dédoubler la même valeur dans la configuration : le
 * serveur lit déjà `NUXT_VAPID_PUBLIC_KEY` pour signer ses envois.
 *
 * `null` quand les clés ne sont pas configurées. Le client n'insiste pas : le
 * push est un confort, les notifications restent en base et consultables dans
 * l'application.
 */
export default defineEventHandler(() => ({
  key: process.env.NUXT_VAPID_PUBLIC_KEY ?? null,
}))

/**
 * Les mots des tables partagées — statuts, canaux, rôles — passés par i18n.
 *
 * `shared/constants/` reste la source unique du triplet mot / icône / couleur :
 * le serveur s'en sert pour les exports, et un test vérifie le contraste de
 * chaque paire. Mais le **mot affiché** vient du fichier de langue quand il y
 * est, pour qu'ajouter une langue ne demande pas de toucher aux constantes.
 * Absent du fichier, le mot de la table reste ce qu'on affiche : jamais une
 * clé brute à l'écran.
 */
export function useLibelle() {
  const { t, te } = useI18n()

  function libelle(cle: string, defaut: string): string {
    return te(cle) ? t(cle) : defaut
  }

  return {
    statut: (kind: string, status: string, defaut: string) => libelle(`statut.${kind}.${status}`, defaut),
    canal: (canal: string, defaut: string) => libelle(`canal.${canal}`, defaut),
    role: (role: string, defaut: string) => libelle(`role.${role}.label`, defaut),
    roleDescription: (role: string, defaut: string) => libelle(`role.${role}.description`, defaut),
  }
}

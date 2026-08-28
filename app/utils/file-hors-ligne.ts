/**
 * File d'attente des mutations faites sans réseau.
 *
 * Stockée dans **IndexedDB** et non dans `localStorage` : la file peut contenir
 * une preuve de paiement encodée, ce qui dépasse vite les cinq mégaoctets de
 * `localStorage`, et son API synchrone bloquerait le fil principal à chaque
 * écriture.
 *
 * Ce n'est pas un contournement de la règle 12. La file ne fait pas autorité :
 * elle contient des **intentions non encore transmises**, pas un état
 * financier. Rien n'y est lu pour afficher un solde ou un dû — ces valeurs
 * viennent toujours du serveur. La file ne sert qu'à ne pas perdre une saisie.
 *
 * Chaque intention porte sa propre `Idempotency-Key`, **fabriquée au moment de
 * la saisie** et non à l'envoi. C'est ce qui rend le rejeu inoffensif : que la
 * file parte une fois ou dix, le serveur ne créera qu'une seule déclaration
 * (règle 4). Sans cela, une file qui se vide deux fois — deux onglets ouverts,
 * un retour de réseau pendant une reprise — déclarerait deux paiements.
 */
const BASE = 'tontine-hors-ligne'
const MAGASIN = 'mutations'
const VERSION = 1

export interface MutationEnAttente {
  id: string
  /** Adresse de l'API, chemin complet. */
  url: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body: unknown
  /** Fabriquée à la saisie : c'est elle qui rend le rejeu sans effet. */
  idempotencyKey: string
  /** Ce qu'on montre au membre en attendant l'envoi. */
  libelle: string
  createdAt: number
  /** Nombre d'échecs d'envoi, pour ne pas boucler indéfiniment. */
  tentatives: number
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, VERSION)

    requete.onupgradeneeded = () => {
      const base = requete.result
      if (!base.objectStoreNames.contains(MAGASIN)) {
        base.createObjectStore(MAGASIN, { keyPath: 'id' })
      }
    }
    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => rejeter(requete.error)
  })
}

function transaction<T>(
  mode: IDBTransactionMode,
  operation: (magasin: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return ouvrir().then(base => new Promise<T>((resoudre, rejeter) => {
    const tx = base.transaction(MAGASIN, mode)
    const requete = operation(tx.objectStore(MAGASIN))

    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => rejeter(requete.error)
    tx.oncomplete = () => base.close()
  }))
}

export function enfiler(mutation: MutationEnAttente): Promise<unknown> {
  return transaction('readwrite', magasin => magasin.put(mutation))
}

export function lireFile(): Promise<MutationEnAttente[]> {
  return transaction<MutationEnAttente[]>('readonly', magasin => magasin.getAll())
    .then(liste => liste.sort((a, b) => a.createdAt - b.createdAt))
}

export function retirer(id: string): Promise<unknown> {
  return transaction('readwrite', magasin => magasin.delete(id))
}

export function majMutation(mutation: MutationEnAttente): Promise<unknown> {
  return transaction('readwrite', magasin => magasin.put(mutation))
}

export function viderFile(): Promise<unknown> {
  return transaction('readwrite', magasin => magasin.clear())
}

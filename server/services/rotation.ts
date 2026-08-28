import { createHash, randomBytes } from 'node:crypto'

/**
 * Générateur pseudo-aléatoire **déterministe**, alimenté par une graine.
 *
 * Le tirage au sort de l'ordre de passage est le moment le plus suspect d'une
 * tontine : celui qui passe en premier est avantagé, et le président est
 * toujours soupçonné d'avoir arrangé le résultat. La parade n'est pas de tirer
 * « au hasard », c'est de tirer de façon **reproductible** : la graine est
 * inscrite au registre avec le résultat, et n'importe quel membre peut
 * recalculer le tirage et vérifier qu'il tombe sur le même ordre.
 *
 * Un `Math.random()` ne le permettrait pas — le résultat serait invérifiable,
 * donc contestable.
 */
function prngDepuisGraine(graine: string): () => number {
  let etat = createHash('sha256').update(graine).digest()
  let position = 0

  return () => {
    if (position + 4 > etat.length) {
      etat = createHash('sha256').update(etat).digest()
      position = 0
    }
    const valeur = etat.readUInt32BE(position)
    position += 4
    return valeur / 0x1_0000_0000
  }
}

/** Une graine de tirage, imprévisible mais consignable. */
export function genererGraine(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Mélange de Fisher-Yates alimenté par la graine.
 *
 * Choisi pour une raison précise : c'est le seul mélange courant dont chaque
 * permutation a exactement la même probabilité. Un tri par clé aléatoire, plus
 * simple à écrire, biaise le résultat — inacceptable quand l'ordre décide de
 * qui touche le pot en premier.
 */
export function melangerAvecGraine<T>(elements: readonly T[], graine: string): T[] {
  const resultat = [...elements]
  const suivant = prngDepuisGraine(graine)

  for (let i = resultat.length - 1; i > 0; i--) {
    const j = Math.floor(suivant() * (i + 1))
    ;[resultat[i], resultat[j]] = [resultat[j]!, resultat[i]!]
  }

  return resultat
}

/**
 * Rejoue un tirage à partir de sa graine — c'est la preuve anti-soupçon.
 *
 * Un membre qui doute reprend la graine inscrite au registre, la rejoue, et
 * retrouve l'ordre annoncé. Sinon, le registre ment.
 */
export function verifierTirage<T>(
  elementsDeDepart: readonly T[],
  graine: string,
  ordreAnnonce: readonly T[],
): boolean {
  const rejoue = melangerAvecGraine(elementsDeDepart, graine)
  return rejoue.length === ordreAnnonce.length
    && rejoue.every((v, i) => v === ordreAnnonce[i])
}

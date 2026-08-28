/** Poids maximal d'une preuve après compression (règle 18). */
export const TAILLE_CIBLE_OCTETS = 100 * 1024

/** Côté le plus long après réduction. Au-delà, on ne gagne rien de lisible. */
const COTE_MAX = 1_280

/**
 * Compresse une capture de paiement **avant** de l'envoyer.
 *
 * Règle 18 de CLAUDE.md : moins de 100 Ko. Ce n'est pas une préoccupation de
 * serveur, c'est une question d'argent pour le membre — une photo brute de
 * téléphone pèse 3 à 5 Mo, et sur un forfait ivoirien à la donnée, l'envoyer
 * telle quelle coûte plus cher que la cotisation ne rapporte de confort.
 *
 * La compression se fait dans un `canvas`, sans aucune bibliothèque : on réduit
 * d'abord la définition, puis on baisse la qualité JPEG par paliers jusqu'à
 * passer sous la cible. Réduire la définition d'abord est ce qui fait
 * l'essentiel du gain ; jouer seulement sur la qualité donne une image floue et
 * toujours trop lourde.
 */
export function useCompressionImage() {
  async function compresser(fichier: File): Promise<File> {
    const image = await chargerImage(fichier)

    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height))
    const largeur = Math.round(image.width * echelle)
    const hauteur = Math.round(image.height * echelle)

    const canvas = document.createElement('canvas')
    canvas.width = largeur
    canvas.height = hauteur

    const contexte = canvas.getContext('2d')
    if (!contexte) throw new Error('Impossible de préparer l’image sur cet appareil.')

    // Fond blanc : un PNG transparent converti en JPEG donnerait du noir.
    contexte.fillStyle = '#ffffff'
    contexte.fillRect(0, 0, largeur, hauteur)
    contexte.drawImage(image, 0, 0, largeur, hauteur)

    // Paliers décroissants plutôt qu'une dichotomie : trois ou quatre essais
    // suffisent en pratique, et chaque essai coûte un encodage complet.
    for (const qualite of [0.8, 0.65, 0.5, 0.4, 0.3]) {
      const blob = await versBlob(canvas, qualite)
      if (blob.size <= TAILLE_CIBLE_OCTETS) {
        return new File([blob], renommer(fichier.name), { type: 'image/jpeg' })
      }
    }

    // Toujours trop lourd : on réduit encore la définition avant d'abandonner.
    canvas.width = Math.round(largeur / 2)
    canvas.height = Math.round(hauteur / 2)
    contexte.fillStyle = '#ffffff'
    contexte.fillRect(0, 0, canvas.width, canvas.height)
    contexte.drawImage(image, 0, 0, canvas.width, canvas.height)

    const dernier = await versBlob(canvas, 0.5)
    return new File([dernier], renommer(fichier.name), { type: 'image/jpeg' })
  }

  return { compresser, TAILLE_CIBLE_OCTETS }
}

function renommer(nom: string): string {
  return `${nom.replace(/\.[^.]+$/, '')}.jpg`
}

function chargerImage(fichier: File): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resoudre(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      rejeter(new Error('Ce fichier n’est pas une image lisible.'))
    }
    image.src = url
  })
}

function versBlob(canvas: HTMLCanvasElement, qualite: number): Promise<Blob> {
  return new Promise((resoudre, rejeter) => {
    canvas.toBlob(
      blob => (blob ? resoudre(blob) : rejeter(new Error('Compression impossible.'))),
      'image/jpeg',
      qualite,
    )
  })
}

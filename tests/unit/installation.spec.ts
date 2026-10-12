import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { REPORT_INSTALLATION_MS, modeInstallation, proposerDOffice } from '../../app/utils/installation.ts'
import type { Appareil } from '../../app/utils/installation.ts'

/**
 * Installer eTontine « sur n'importe quel terminal » : chaque plateforme a son
 * geste, et l'écran doit montrer le bon. Les agents utilisateurs sont ceux que
 * ces navigateurs envoient réellement.
 */

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.70.77;]',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  chromeIphoneAncien: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0.5359.112 Mobile/15E148 Safari/604.1',
  firefoxIphone163: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/110.0 Mobile/15E148 Safari/605.1.15',
  firefoxIphone164: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/112.0 Mobile/15E148 Safari/605.1.15',
  facebookIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/631215213;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBLC/fr_FR]',
  vueIntegreeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariMacAncien: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
}

function appareil(userAgent: string, autre: Partial<Appareil> = {}): Appareil {
  return { userAgent, pointsDeContact: 0, autonome: false, invitationDisponible: false, ...autre }
}

describe('la marche à suivre, appareil par appareil', () => {
  it.each([
    ['Chrome sur Android, sans invitation', UA.chromeAndroid, 'android', false],
    ['Samsung Internet, sans invitation', UA.samsung, 'android', false],
    ['Firefox sur Android — il n’invite jamais', UA.firefoxAndroid, 'android', true],
    ['la WebView d’une application Android', UA.webviewAndroid, 'navigateur-integre', true],
    ['le navigateur de Facebook sur Android', UA.facebookAndroid, 'navigateur-integre', true],
    ['Safari sur iPhone', UA.safariIphone, 'ios', true],
    ['Chrome sur iPhone, iOS 17', UA.chromeIphone, 'ios', true],
    ['Chrome sur iPhone, iOS 15', UA.chromeIphoneAncien, 'ios-safari', true],
    ['Firefox sur iPhone, iOS 16.3', UA.firefoxIphone163, 'ios-safari', true],
    ['Firefox sur iPhone, iOS 16.4', UA.firefoxIphone164, 'ios', true],
    ['le navigateur de Facebook sur iPhone', UA.facebookIphone, 'navigateur-integre', true],
    ['une vue intégrée d’iOS, sans le jeton Safari', UA.vueIntegreeIphone, 'navigateur-integre', true],
    ['Safari 17 sur Mac', UA.safariMac, 'safari-mac', true],
    ['Safari 16 sur Mac — pas de Dock', UA.safariMacAncien, 'non-pris-en-charge', false],
    ['Chrome sur Mac, sans invitation', UA.chromeMac, 'ordinateur', false],
    ['Edge sur Windows, sans invitation', UA.edgeWindows, 'ordinateur', false],
    ['Firefox sur Windows', UA.firefoxWindows, 'non-pris-en-charge', false],
    ['Firefox sur Linux', UA.firefoxLinux, 'non-pris-en-charge', false],
  ])('%s', (_, userAgent, mode, dOffice) => {
    expect(modeInstallation(appareil(userAgent))).toEqual({ mode, dOffice })
  })

  it('suit l’invitation du navigateur dès qu’il la fait — téléphone ou ordinateur', () => {
    for (const userAgent of [UA.chromeAndroid, UA.samsung, UA.edgeWindows, UA.chromeMac]) {
      expect(modeInstallation(appareil(userAgent, { invitationDisponible: true })))
        .toEqual({ mode: 'invite', dOffice: true })
    }
  })

  it('reconnaît un iPad, qui se présente comme un Mac mais tactile', () => {
    expect(modeInstallation(appareil(UA.safariMac, { pointsDeContact: 5 })).mode).toBe('ios')
  })

  it('ne propose rien à l’application déjà installée, même si le navigateur invite', () => {
    for (const userAgent of [UA.chromeAndroid, UA.vueIntegreeIphone, UA.edgeWindows]) {
      expect(modeInstallation(appareil(userAgent, { autonome: true, invitationDisponible: true })))
        .toEqual({ mode: 'installee', dOffice: false })
    }
  })
})

describe('la proposition d’office', () => {
  const MAINTENANT = Date.UTC(2026, 9, 12)
  const JOUR = 24 * 60 * 60 * 1000
  const ios = modeInstallation(appareil(UA.safariIphone))

  it('se fait une fois, à qui ne l’a jamais écartée', () => {
    expect(proposerDOffice(ios, { reporteeLe: null, maintenant: MAINTENANT, dejaProposee: false })).toBe(true)
    // Une seule fois par visite.
    expect(proposerDOffice(ios, { reporteeLe: null, maintenant: MAINTENANT, dejaProposee: true })).toBe(false)
  })

  it('attend trente jours après une proposition écartée', () => {
    expect(REPORT_INSTALLATION_MS).toBe(30 * JOUR)
    expect(proposerDOffice(ios, { reporteeLe: MAINTENANT - 29 * JOUR, maintenant: MAINTENANT, dejaProposee: false })).toBe(false)
    expect(proposerDOffice(ios, { reporteeLe: MAINTENANT - 30 * JOUR, maintenant: MAINTENANT, dejaProposee: false })).toBe(true)
  })

  it('ne se fait pas là où le chemin n’est pas sûr — le profil la garde à portée', () => {
    for (const userAgent of [UA.chromeAndroid, UA.edgeWindows, UA.firefoxWindows]) {
      expect(proposerDOffice(modeInstallation(appareil(userAgent)), {
        reporteeLe: null, maintenant: MAINTENANT, dejaProposee: false,
      })).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Les icônes
 * ------------------------------------------------------------------ */

const PUBLIC = join(import.meta.dirname, '..', '..', 'public')

interface Image {
  largeur: number
  hauteur: number
  /** Type de couleur PNG : 2 = RVB sans couche alpha, donc opaque. */
  typeCouleur: number
  pixel: (x: number, y: number) => [number, number, number]
}

/** Un lecteur de PNG RVB 8 bits, filtres compris : assez pour vérifier ce qu'on livre. */
function lirePng(donnees: Buffer): Image {
  expect(donnees.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
  let position = 8
  let entete: Buffer | null = null
  const blocs: Buffer[] = []
  while (position < donnees.length) {
    const longueur = donnees.readUInt32BE(position)
    const type = donnees.toString('ascii', position + 4, position + 8)
    const contenu = donnees.subarray(position + 8, position + 8 + longueur)
    if (type === 'IHDR') entete = contenu
    if (type === 'IDAT') blocs.push(contenu)
    position += 12 + longueur
  }
  const largeur = entete!.readUInt32BE(0)
  const hauteur = entete!.readUInt32BE(4)
  const typeCouleur = entete![9]!

  const brut = inflateSync(Buffer.concat(blocs))
  const pas = largeur * 3
  const lignes: Buffer[] = []
  let precedente = Buffer.alloc(pas)
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (pas + 1)]!
    const ligne = Buffer.from(brut.subarray(y * (pas + 1) + 1, (y + 1) * (pas + 1)))
    for (let i = 0; i < pas; i++) {
      const a = i >= 3 ? ligne[i - 3]! : 0
      const b = precedente[i]!
      const c = i >= 3 ? precedente[i - 3]! : 0
      const p = a + b - c
      const predit = [0, a, b, (a + b) >> 1,
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][filtre]!
      ligne[i] = (ligne[i]! + predit) & 0xFF
    }
    lignes.push(ligne)
    precedente = ligne
  }
  return {
    largeur,
    hauteur,
    typeCouleur,
    pixel: (x, y) => [lignes[y]![x * 3]!, lignes[y]![x * 3 + 1]!, lignes[y]![x * 3 + 2]!],
  }
}

describe('les icônes de chaque plateforme', () => {
  it.each([
    ['icones/icone-192.png', 192],
    ['icones/icone-512.png', 512],
    ['icones/icone-512-maskable.png', 512],
    // Safari sur Mac : une icône pleine de 1024 px pour le Dock.
    ['icones/icone-1024-maskable.png', 1024],
    // iPhone et iPad : ils ignorent le manifeste et prennent celle-ci.
    ['apple-touch-icon.png', 180],
  ])('%s fait %i px, et elle est opaque', (chemin, cote) => {
    const image = lirePng(readFileSync(join(PUBLIC, chemin)))
    expect([image.largeur, image.hauteur]).toEqual([cote, cote])
    // Sans couche alpha : iOS noircit la transparence, et un lanceur n'a rien
    // à laisser voir au travers.
    expect(image.typeCouleur).toBe(2)
  })

  it.each([
    ['icones/icone-512-maskable.png'],
    ['icones/icone-1024-maskable.png'],
  ])('%s tient dans le cercle de sécurité : aucune forme de lanceur ne la rogne', (chemin) => {
    const image = lirePng(readFileSync(join(PUBLIC, chemin)))
    const centre = image.largeur / 2
    const rayonSur = image.largeur * 0.4
    let blancs = 0
    for (let y = 0; y < image.hauteur; y++) {
      for (let x = 0; x < image.largeur; x++) {
        if (image.pixel(x, y)[0] !== 0xFF) continue
        blancs++
        expect(Math.hypot(x + 0.5 - centre, y + 0.5 - centre)).toBeLessThanOrEqual(rayonSur)
      }
    }
    expect(blancs).toBeGreaterThan(0)
  })

  it('le favicon embarque trois tailles', () => {
    const ico = readFileSync(join(PUBLIC, 'favicon.ico'))
    expect(ico.readUInt16LE(2)).toBe(1)
    const tailles = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
      const decalage = ico.readUInt32LE(6 + 16 * i + 12)
      return lirePng(ico.subarray(decalage, decalage + ico.readUInt32LE(6 + 16 * i + 8))).largeur
    })
    expect(tailles).toEqual([16, 32, 48])
  })

  it('toute icône citée par la configuration existe, à la taille annoncée', () => {
    // La configuration et les fichiers vivent séparément : un nom changé d'un
    // côté seulement donnerait une icône manquante à l'installation, sans
    // qu'aucun build n'échoue.
    const configuration = readFileSync(join(import.meta.dirname, '..', '..', 'nuxt.config.ts'), 'utf8')

    const manifeste = [...configuration.matchAll(/src: '(\/icones\/[^']+\.png)', sizes: '(\d+)x(\d+)'/g)]
    expect(manifeste.length).toBeGreaterThanOrEqual(4)
    for (const [, chemin, largeur] of manifeste) {
      expect(lirePng(readFileSync(join(PUBLIC, chemin!))).largeur, chemin).toBe(Number(largeur))
    }

    const liens = [...configuration.matchAll(/href: '(\/[^']+\.(?:png|ico|svg))'/g)].map(m => m[1]!)
    expect(liens).toEqual(expect.arrayContaining(['/apple-touch-icon.png', '/favicon.ico', '/icones/icone.svg']))
    for (const chemin of liens) expect(existsSync(join(PUBLIC, chemin)), chemin).toBe(true)
  })
})

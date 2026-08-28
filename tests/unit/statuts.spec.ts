import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALL_STATUS_TABLES,
  STATUS_ICONS,
  statusPresentation,
} from '#shared/constants/statuts'
import {
  contributionStatus,
  membershipStatus,
  payoutStatus,
  roundStatus,
  tontineStatus,
} from '#shared/schemas'

const enums = {
  contribution: contributionStatus,
  round: roundStatus,
  payout: payoutStatus,
  membership: membershipStatus,
  tontine: tontineStatus,
} as const

describe('tables de statuts — exhaustivité', () => {
  it.each(Object.keys(enums) as Array<keyof typeof enums>)(
    'couvre tous les statuts de « %s », sans en inventer',
    (kind) => {
      // Un statut ajouté au schéma Zod sans présentation laisserait un badge
      // vide à l'écran ; une présentation orpheline signale un statut supprimé.
      expect(Object.keys(ALL_STATUS_TABLES[kind]).sort()).toEqual([...enums[kind].options].sort())
    },
  )
})

describe('règle 10 — jamais d’information portée par la couleur seule', () => {
  const tous = Object.entries(ALL_STATUS_TABLES).flatMap(([kind, table]) =>
    Object.entries(table).map(([status, p]) => ({ kind, status, ...p })),
  )

  it.each(tous)('$kind/$status porte un mot, une icône et une couleur', (p) => {
    expect(p.label.trim().length, 'mot manquant').toBeGreaterThan(0)
    expect(p.icon, 'icône manquante').toMatch(/^lucide:[a-z-]+$/)
    expect(p.surface, 'fond manquant').toMatch(/^bg-/)
    expect(p.ink, 'encre manquante').toMatch(/^text-/)
  })

  it('n’emploie aucun verbe interdit par la règle 8', () => {
    // « encaisser », « créditer », « débiter », « reverser », « transférer »,
    // « solde », « portefeuille » n'ont pas leur place dans l'interface.
    const interdits = /encaiss|crédit|débit|revers|transfér|solde|portefeuille/i

    for (const p of tous) {
      expect(p.label, `« ${p.label} » emploie un terme interdit`).not.toMatch(interdits)
    }
  })

  it('distingue « Déclaré » de « Confirmé » par la couleur comme par le mot', () => {
    // T15 : un paiement déclaré n'est pas confirmé. Le vert le ferait passer
    // pour acquis auprès du membre comme du trésorier.
    const declare = statusPresentation('contribution', 'declared')
    const confirme = statusPresentation('contribution', 'confirmed')

    expect(declare.label).not.toBe(confirme.label)
    expect(declare.surface).not.toBe(confirme.surface)
    expect(declare.icon).not.toBe(confirme.icon)
    expect(declare.surface).toBe('bg-declared-surface')
  })

  it('rejette un statut inconnu au lieu de rendre un badge vide', () => {
    // @ts-expect-error — statut volontairement invalide pour la démonstration
    expect(() => statusPresentation('contribution', 'encaisse')).toThrow(RangeError)
  })
})

describe('icônes embarquées', () => {
  const nuxtConfig = readFileSync(
    fileURLToPath(new URL('../../nuxt.config.ts', import.meta.url)),
    'utf8',
  )

  it('déclare dans nuxt.config.ts toutes les icônes des tables de statuts', () => {
    // @nuxt/icon tourne en `provider: 'none'` : une icône absente du paquet
    // client ne se télécharge pas, elle ne s'affiche pas. Le relevé automatique
    // ne voit que les noms écrits en clair dans les gabarits, jamais ceux qui
    // viennent d'une table — d'où la liste explicite, et d'où ce test.
    for (const icon of STATUS_ICONS) {
      expect(nuxtConfig, `${icon} absente de clientBundle.icons`).toContain(`'${icon}'`)
    }
  })

  it('n’embarque pas d’icône de statut en double', () => {
    expect(STATUS_ICONS.length).toBe(new Set(STATUS_ICONS).size)
  })
})

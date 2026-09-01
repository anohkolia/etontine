import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Toute adresse citée dans une notification doit mener quelque part.
 *
 * Le défaut qui a motivé ce contrôle : `services/canaux.ts` renvoyait les
 * membres vers `/app/tontine/:id/reglages` à chaque changement de numéro de
 * collecte, et cette page n'existait pas. Un lien mort **dans une notification
 * poussée** — c'est-à-dire au pire moment, celui où le membre s'inquiète de
 * savoir sur quel numéro envoyer son argent.
 *
 * Rien ne le signalait : les notifications ne sont pas rendues par le routeur,
 * personne ne compile leurs chaînes, et aucun test de bout en bout ne les
 * suivait. Le contrôle porte donc sur l'invariant lui-même.
 */
const SERVICES = fileURLToPath(new URL('../../server/services', import.meta.url))
const PAGES = fileURLToPath(new URL('../../app/pages', import.meta.url))

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((f) => {
    const chemin = join(dossier, f)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin]
  })
}

/**
 * Les routes que Nuxt sait rendre, en motif comparable.
 *
 * `app/pages/app/tontine/[id]/reglages.vue` devient `/app/tontine/:/reglages`.
 * Le nom du paramètre est effacé des deux côtés : ce qui compte est la forme
 * du chemin, pas la façon dont le segment est nommé.
 */
const routes = new Set(
  fichiers(PAGES)
    .filter(f => f.endsWith('.vue'))
    .map(chemin => chemin
      .slice(PAGES.length)
      .replace(/\.vue$/, '')
      .replace(/\/index$/, '')
      .replace(/\[[^\]]+\]/g, ':'))
    .map(route => route || '/'),
)

/** Les adresses posées dans les notifications, sous la même forme. */
const citees = fichiers(SERVICES)
  .filter(f => f.endsWith('.ts'))
  .flatMap((chemin) => {
    const source = readFileSync(chemin, 'utf8')
    return [...source.matchAll(/url:\s*`([^`]+)`/g)].map(m => ({
      fichier: chemin.slice(SERVICES.length + 1),
      brute: m[1]!,
      motif: m[1]!
        // `${tontineId}` et `${a.tontine.id}` désignent le même segment.
        .replace(/\$\{[^}]+\}/g, ':')
        // Le lien d'un reçu est absolu et signé : `${base}/recu/${id}?exp=…`.
        // Ni l'origine ni la signature ne participent au routage.
        .replace(/\?.*$/, '')
        .replace(/^:/, ''),
    }))
  })

describe('les adresses citées dans les notifications', () => {
  it('en trouve dans les services', () => {
    // Si la forme change (autre nom de champ, autre gabarit), ce test doit
    // tomber ici plutôt que passer en ne vérifiant plus rien.
    expect(citees.length).toBeGreaterThanOrEqual(10)
  })

  it.each(citees)('$fichier → $brute mène à une page existante', ({ motif }) => {
    expect(routes.has(motif), `aucune page ne répond à ${motif}`).toBe(true)
  })
})

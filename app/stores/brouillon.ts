import { defineStore } from 'pinia'

/**
 * Position dans le wizard de création.
 *
 * **Uniquement de l'état d'interface** : l'étape courante et l'identifiant du
 * brouillon en cours. Les réglages financiers, eux, vivent côté serveur dès la
 * première étape — la règle 12 interdit de faire du stockage navigateur une
 * source de vérité sur de l'argent.
 *
 * Ce qui est persisté ici sert exactement à une chose : rouvrir l'application
 * sur l'étape où l'on s'était arrêté, au lieu de repartir du début.
 *
 * Les étapes vont de 1 à 5 : l'étape 0, le choix d'accès, a disparu avec
 * l'accès « ouvert », sans décaler les autres.
 */
export const useBrouillonStore = defineStore('brouillon-tontine', () => {
  const tontineId = ref<string | null>(null)
  const etape = ref(1)
  /** Nombre de membres envisagé — sert au simulateur, pas au calcul réel. */
  const membresPrevus = ref(12)

  function demarrer(id: string) {
    tontineId.value = id
    etape.value = 1
  }

  function reprendre(id: string, etapeAtteinte: number) {
    tontineId.value = id
    etape.value = etapeAtteinte
  }

  function terminer() {
    tontineId.value = null
    etape.value = 1
    membresPrevus.value = 12
  }

  return { tontineId, etape, membresPrevus, demarrer, reprendre, terminer }
}, {
  persist: true,
})

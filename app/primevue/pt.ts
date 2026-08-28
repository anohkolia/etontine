import type { PrimeVuePTOptions } from 'primevue/config'

/**
 * Préréglage pass-through global — le seul endroit où l'on habille PrimeVue.
 *
 * En mode unstyled, PrimeVue ne rend que la structure et le comportement : ni
 * classe, ni CSS. Chaque section reçoit ici ses utilitaires Tailwind. Un écran
 * n'a donc jamais à réécrire l'apparence d'un Dialog ou d'un Button ; corriger
 * un composant se fait à un seul endroit, pour toute l'application.
 *
 * Ce fichier tient la *structure* : surfaces, bordures, rayons, espacements,
 * anneau de focus, cibles tactiles. La palette de couleurs métier (statuts,
 * sévérités, contrôle de contraste AA) est le ticket T03 — ne pas l'anticiper
 * ici, sous peine de la définir deux fois.
 *
 * Les noms de sections viennent des types de PrimeVue 4.5 (`ButtonPassThroughOptions`
 * et consorts) : ils ne s'inventent pas, une section mal nommée est ignorée en
 * silence.
 */

/** Anneau de focus commun. Jamais `outline-none` sans remplaçant visible. */
const focusRing
  = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

/**
 * Base d'un contrôle de saisie : hauteur tactile, bordure, rayon.
 *
 * `border-line-strong` et non `border-line` : la bordure d'un champ délimite la
 * zone de saisie, c'est un élément d'interface porteur de sens et il doit
 * atteindre 3:1 (WCAG 1.4.11). Le trait décoratif, lui, n'a pas cette exigence.
 */
const control
  = `min-h-touch w-full rounded-control border border-line-strong bg-surface px-3 text-base `
    + `text-ink placeholder:text-ink-subtle disabled:cursor-not-allowed `
    + `disabled:bg-surface-muted disabled:text-ink-subtle ${focusRing}`

export default {
  button: {
    // Règle 13 : cible tactile d'au moins 44 × 44 px, sans exception.
    root: {
      class: `min-h-touch inline-flex items-center justify-center gap-2 rounded-control `
        + `px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed `
        + `disabled:opacity-60 ${focusRing}`,
    },
    label: { class: 'whitespace-nowrap' },
    icon: { class: 'shrink-0' },
  },

  inputtext: {
    root: { class: control },
  },

  inputotp: {
    root: { class: 'flex items-center gap-2' },
    // Une case de code à usage unique : carrée, centrée, chiffres lisibles.
    pcInputText: {
      root: {
        class: `size-touch rounded-control border border-line-strong bg-surface text-center `
          + `text-xl font-semibold tabular-nums text-ink ${focusRing}`,
        // `autocomplete` posé sur <InputOtp> atterrirait sur le conteneur, pas
        // sur les champs : sans cet attribut ici, ni Android ni iOS ne
        // proposent le code reçu par SMS, et le membre doit quitter
        // l'application pour le recopier — en perdant sa saisie au passage.
        // InputOtp ne sert qu'à cela dans cette application : le poser pour
        // toutes ses instances est le bon défaut.
        autocomplete: 'one-time-code',
      },
    },
  },

  card: {
    root: { class: 'rounded-card border border-line bg-surface' },
    header: { class: 'px-4 pt-4' },
    body: { class: 'flex flex-col gap-3 p-4' },
    caption: { class: 'flex flex-col gap-1' },
    title: { class: 'text-lg font-semibold text-ink' },
    subtitle: { class: 'text-sm text-ink-muted' },
    content: { class: 'text-base text-ink-muted' },
    footer: { class: 'flex flex-wrap items-center gap-2 pt-2' },
  },

  dialog: {
    mask: { class: 'fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center' },
    // Mobile-first : feuille ancrée en bas sur téléphone, boîte centrée au-delà.
    root: {
      class: `flex max-h-[90dvh] w-full flex-col rounded-t-card border border-line bg-surface `
        + `shadow-xl sm:max-w-md sm:rounded-card`,
    },
    header: { class: 'flex items-start justify-between gap-4 border-b border-line p-4' },
    title: { class: 'text-lg font-semibold text-ink' },
    headerActions: { class: 'flex items-center gap-1' },
    pcCloseButton: {
      root: { class: `size-touch inline-flex items-center justify-center rounded-control ${focusRing}` },
    },
    content: { class: 'flex-1 overflow-y-auto p-4 text-base text-ink-muted' },
    // Règle 13 : l'action primaire se pose en bas de l'écran.
    footer: { class: 'flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end' },
  },

  tag: {
    // Structure seule. La couleur *et* l'icône *et* le mot sont posés par
    // <StatusBadge> en T03 — règle 10 : jamais la couleur seule.
    root: {
      class: 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
    },
    icon: { class: 'shrink-0' },
    label: { class: 'leading-none' },
  },

  progressbar: {
    root: { class: 'h-2 w-full overflow-hidden rounded-full bg-surface-muted' },
    value: { class: 'h-full rounded-full bg-brand transition-[width] duration-300' },
    label: { class: 'sr-only' },
  },

  stepper: {
    root: { class: 'flex flex-col gap-4' },
    separator: { class: 'h-px flex-1 bg-line' },
  },
  steplist: {
    root: { class: 'flex flex-wrap items-center gap-2' },
  },
  step: {
    root: { class: 'flex items-center gap-2' },
    header: { class: `flex items-center gap-2 rounded-control ${focusRing}` },
    number: {
      class: `flex size-8 shrink-0 items-center justify-center rounded-full border border-line `
        + `bg-surface text-sm font-semibold tabular-nums text-ink-muted`,
    },
    // Un wizard réduit à des numéros nus est illisible sur un téléphone :
    // le libellé reste visible à 360 px, simplement plus compact.
    title: { class: 'text-xs font-medium text-ink-muted sm:text-sm' },
  },
  steppanels: {
    root: { class: 'pt-2' },
  },
  steppanel: {
    root: { class: 'text-base text-ink-muted' },
  },
} satisfies PrimeVuePTOptions

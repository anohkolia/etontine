<script setup lang="ts">
/**
 * Partage d'un lien d'invitation.
 *
 * WhatsApp d'abord, et de loin : c'est là que les tontines se coordonnent
 * réellement en Côte d'Ivoire. Le message est **pré-rempli** mais l'envoi
 * reste manuel — l'organisateur relit, choisit son destinataire, et garde la
 * main. Rien n'est envoyé à son insu.
 */
const props = defineProps<{
  url: string
  tontineName: string
  /** Phrase d'engagement, pour que le destinataire sache à quoi il répond. */
  engagement?: string
  /** Adresse du QR code, servi en SVG par le serveur. */
  qrUrl?: string
}>()

/**
 * Le QR sert en présentiel : à une réunion de tontine, on montre son écran
 * plutôt que de dicter un lien. Il est replié par défaut — le partage passe
 * massivement par WhatsApp, et l'afficher d'emblée encombrerait l'écran.
 */
const { t } = useI18n()
const qrOuvert = ref(false)

const messageWhatsApp = computed(() => {
  const lignes = [
    t('ui.PartageInvitation.salut_je_t_invite', { nom: props.tontineName }),
    props.engagement ?? '',
    t('ui.PartageInvitation.tu_peux_voir_les', { url: props.url }),
  ].filter(Boolean)

  return lignes.join('\n\n')
})

const lienWhatsApp = computed(() =>
  `https://wa.me/?text=${encodeURIComponent(messageWhatsApp.value)}`,
)

const { copie, copier } = useCopie()
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="rounded-control border border-line bg-surface-muted p-3 font-mono text-sm break-all text-ink-muted">
      {{ url }}
    </p>

    <div class="flex flex-col gap-2 sm:flex-row">
      <a
        :href="lienWhatsApp"
        target="_blank"
        rel="noopener"
        class="min-h-touch inline-flex flex-1 items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
        data-testid="lien-whatsapp"
      >
        <Icon
          name="lucide:message-circle"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('ui.PartageInvitation.envoyer_par_whatsapp') }}
      </a>

      <button
        type="button"
        class="min-h-touch inline-flex flex-1 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
        data-testid="bouton-copier-lien"
        @click="copier(url)"
      >
        <Icon
          :name="copie ? 'lucide:check' : 'lucide:copy'"
          size="1rem"
          aria-hidden="true"
        />
        {{ copie ? $t('commun.lien_copie') : $t('commun.copier_le_lien') }}
      </button>
    </div>

    <div v-if="qrUrl">
      <button
        type="button"
        class="min-h-touch flex items-center gap-2 text-sm text-brand underline underline-offset-4"
        data-testid="bouton-qr"
        @click="qrOuvert = !qrOuvert"
      >
        <Icon
          name="lucide:qr-code"
          size="1rem"
          aria-hidden="true"
        />
        {{ qrOuvert ? $t('ui.PartageInvitation.masquer_le_qr_code') : $t('ui.PartageInvitation.afficher_le_qr_code') }}
      </button>

      <img
        v-if="qrOuvert"
        :src="qrUrl"
        :alt="$t('ui.PartageInvitation.qr_code_du_lien', { nom: tontineName })"
        class="mt-2 w-full max-w-[280px] card-surface p-2"
        data-testid="image-qr"
      >
    </div>

    <p class="text-sm text-ink-subtle">
      {{ $t('ui.PartageInvitation.l_envoi_est_manuel') }}
    </p>
  </div>
</template>

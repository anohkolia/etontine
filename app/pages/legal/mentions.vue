<script setup lang="ts">
/**
 * Mentions légales — qui édite, qui héberge, à qui écrire.
 *
 * Les pages légales manquaient alors que le contrat de routes les prévoyait
 * (`/legal/*`) : une application qui demande un consentement au traitement de
 * données personnelles sans dire à qui l'on consent n'est pas conforme à la
 * loi n° 2013-450. Les valeurs entre crochets viennent de
 * `shared/constants/editeur.ts` et **doivent être complétées** avant la mise en
 * production — elles s'affichent telles quelles pour qu'on ne les oublie pas.
 */
import { EDITEUR } from '#shared/constants/editeur'

definePageMeta({ layout: false })
const { t } = useI18n()

useHead({
  title: t('public.legal.mentions.mentions_legales_etontine'),
  meta: [{ name: 'description', content: t('public.legal.mentions.editeur_hebergeur_et_contact') }],
})
</script>

<template>
  <PageLegale
    :titre="$t('public.legal.mentions.mentions_legales')"
    :sous-titre="$t('public.legal.mentions.qui_edite_etontine_qui')"
  >
    <section>
      <h2>{{ $t('public.legal.mentions.editeur') }}</h2>
      <p data-testid="editeur-nom">
        {{ $t('public.legal.mentions.p0_p1_immatriculee_au', { p0: EDITEUR.nom, p1: EDITEUR.forme, p2: EDITEUR.rccm }) }}
      </p>
      <p>{{ $t('public.legal.mentions.siege_social_p0', { p0: EDITEUR.adresse }) }}</p>
      <p>{{ $t('public.legal.mentions.responsable_de_la_publication', { p0: EDITEUR.responsable }) }}</p>
      <p>
        {{ $t('public.legal.mentions.contact') }} <a
          :href="`mailto:${EDITEUR.email}`"
          class="text-brand underline underline-offset-4"
        >{{ EDITEUR.email }}</a>
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.mentions.hebergement') }}</h2>
      <p>{{ EDITEUR.hebergeur }}.</p>
    </section>

    <section>
      <h2>{{ $t('public.legal.mentions.ce_que_l_application') }}</h2>
      <p>
        {{ $t('public.legal.mentions.etontine_est_un_outil') }}
        <strong>{{ $t('public.legal.mentions.l_application_ne_detient') }}</strong> {{ $t('public.legal.mentions.les_membres_s_envoient') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.mentions.propriete_intellectuelle') }}</h2>
      <p>
        {{ $t('public.legal.mentions.les_textes_l_interface') }}
      </p>
    </section>
  </PageLegale>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : contenu statique, pré-rendu
  · vide       — sans objet : le texte est fixe
  · erreur     — sans objet : aucun appel réseau
  · hors-ligne — le bandeau `OfflineBanner` annonce la coupure ; le texte reste lisible
  · contenu    — les mentions
-->

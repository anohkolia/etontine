<script setup lang="ts">
/**
 * Conditions générales d'utilisation.
 *
 * Écrites pour être lues par un membre, pas par un juriste : ce que
 * l'application fait, ce qu'elle ne fait pas, ce qu'on s'engage à faire en
 * l'utilisant. Elles disent surtout ce que le produit répète partout — aucun
 * fonds ne transite par l'application — parce que c'est le point qu'un membre
 * doit avoir compris avant de rejoindre une tontine.
 */
import { EDITEUR } from '#shared/constants/editeur'

definePageMeta({ layout: false })
const { t } = useI18n()

useHead({
  title: t('public.legal.cgu.conditions_d_utilisation_etontine'),
  meta: [{ name: 'description', content: t('public.legal.cgu.les_regles_d_utilisation') }],
})
</script>

<template>
  <PageLegale
    :titre="$t('public.legal.cgu.conditions_d_utilisation')"
    :sous-titre="$t('public.legal.cgu.ce_que_fait_l')"
  >
    <section>
      <h2>{{ $t('public.legal.cgu.1_ce_qu_est') }}</h2>
      <p>
        {{ $t('public.legal.cgu.etontine_est_un_service', { p0: EDITEUR.nom }) }}
      </p>
      <p>
        <strong>{{ $t('public.legal.cgu.l_application_ne_detient') }}</strong> {{ $t('public.legal.cgu.les_cotisations_sont_envoyees') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.2_le_compte') }}</h2>
      <p>
        {{ $t('public.legal.cgu.un_compte_est_ouvert') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.3_ce_que_tu') }}</h2>
      <ul>
        <li>{{ $t('public.legal.cgu.declarer_des_envois_que') }}</li>
        <li>{{ $t('public.legal.cgu.confirmer_si_tu_es') }}</li>
        <li>{{ $t('public.legal.cgu.ne_pas_utiliser_l') }}</li>
        <li>{{ $t('public.legal.cgu.respecter_les_regles_convenues') }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.4_le_registre') }}</h2>
      <p>
        {{ $t('public.legal.cgu.chaque_ecriture_du_registre') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.5_les_desaccords_entre') }}</h2>
      <p>
        {{ $t('public.legal.cgu.etontine_fournit_le_registre') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.6_abonnement') }}</h2>
      <p>
        {{ $t('public.legal.cgu.l_usage_de_base') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.7_disponibilite_et_responsabilite') }}</h2>
      <p>
        {{ $t('public.legal.cgu.l_editeur_s_efforce') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.8_fin_du_compte') }}</h2>
      <p>
        {{ $t('public.legal.cgu.tu_peux_demander_la') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.cgu.9_droit_applicable') }}</h2>
      <p>
        {{ $t('public.legal.cgu.les_presentes_conditions_sont', { p0: EDITEUR.email }) }}
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
  · contenu    — les conditions
-->

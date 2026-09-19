<script setup lang="ts">
/**
 * Politique de confidentialité — loi n° 2013-450 relative à la protection
 * des données à caractère personnel.
 *
 * C'est le texte vers lequel les deux cases de consentement du profil doivent
 * pointer : consentir au traitement de ses données sans pouvoir lire
 * lesquelles, pour quoi, et combien de temps, n'est pas un consentement.
 * Chaque section répond à une question qu'un membre se pose vraiment.
 */
import { EDITEUR } from '#shared/constants/editeur'

definePageMeta({ layout: false })
const { t } = useI18n()

useHead({
  title: t('public.legal.confidentialite.confidentialite_etontine'),
  meta: [{ name: 'description', content: t('public.legal.confidentialite.quelles_donnees_etontine_garde') }],
})
</script>

<template>
  <PageLegale
    :titre="$t('public.legal.confidentialite.confidentialite')"
    :sous-titre="$t('public.legal.confidentialite.quelles_donnees_on_garde')"
  >
    <section>
      <h2>{{ $t('public.legal.confidentialite.qui_est_responsable') }}</h2>
      <p>
        {{ $t('public.legal.confidentialite.le_responsable_du_traitement', { p0: EDITEUR.nom, p1: EDITEUR.adresse }) }} <a
          :href="`mailto:${EDITEUR.email}`"
          class="text-brand underline underline-offset-4"
        >{{ EDITEUR.email }}</a>{{ $t('public.legal.confidentialite.le_traitement_releve_de') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.ce_que_l_on') }}</h2>
      <ul>
        <li>
          <strong>{{ $t('public.legal.confidentialite.ton_numero_de_telephone') }}</strong> {{ $t('public.legal.confidentialite.c_est_ton_identifiant') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.ton_prenom_et_ton') }}</strong> {{ $t('public.legal.confidentialite.pour_que_les_membres') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.une_piece_d_identite') }}</strong> {{ $t('public.legal.confidentialite.uniquement_si_tu_crees') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.tes_numeros_de_collecte') }}</strong> {{ $t('public.legal.confidentialite.si_tu_organises_une') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.le_registre_de_chaque') }}</strong> {{ $t('public.legal.confidentialite.declarations_confirmations_versements_amendes') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.les_captures_d_ecran') }}</strong> {{ $t('public.legal.confidentialite.si_tu_choisis_d') }}
        </li>
        <li>
          <strong>{{ $t('public.legal.confidentialite.des_donnees_techniques') }}</strong> {{ $t('public.legal.confidentialite.session_appareil_qui_a') }}
        </li>
      </ul>
      <p>
        {{ $t('public.legal.confidentialite.aucune_donnee_n_est') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.qui_voit_quoi') }}</h2>
      <ul>
        <li>{{ $t('public.legal.confidentialite.les_membres_d_une') }}</li>
        <li>{{ $t('public.legal.confidentialite.le_bureau_de_ta') }}</li>
        <li>{{ $t('public.legal.confidentialite.les_autres_membres_ne') }}</li>
        <li>{{ $t('public.legal.confidentialite.l_editeur_voit_le') }}</li>
        <li>{{ $t('public.legal.confidentialite.personne_d_autre_un') }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.les_notifications') }}</h2>
      <p>
        {{ $t('public.legal.confidentialite.une_notification_ne_contient') }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.combien_de_temps') }}</h2>
      <ul>
        <li>{{ $t('public.legal.confidentialite.les_codes_de_connexion') }}</li>
        <li>{{ $t('public.legal.confidentialite.une_session_expire_apres') }}</li>
        <li>{{ $t('public.legal.confidentialite.le_dossier_d_identite') }}</li>
        <li>
          {{ $t('public.legal.confidentialite.le_registre_d_une') }}
        </li>
      </ul>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.tes_droits') }}</h2>
      <p>
        {{ $t('public.legal.confidentialite.tu_peux_a_tout') }} <strong>{{ $t('public.legal.confidentialite.exporter_toutes_tes_donnees') }}</strong> {{ $t('public.legal.confidentialite.dans_un_fichier_lisible') }} <strong>{{ $t('public.legal.confidentialite.demander_la_suppression_de') }}</strong>{{ $t('public.legal.confidentialite.la_suppression_est_refusee') }}
      </p>
      <p>
        {{ $t('public.legal.confidentialite.pour_exercer_ces_droits', { p0: EDITEUR.email }) }}
      </p>
    </section>

    <section>
      <h2>{{ $t('public.legal.confidentialite.securite') }}</h2>
      <p>
        {{ $t('public.legal.confidentialite.la_session_tient_a') }}
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
  · contenu    — la politique
-->

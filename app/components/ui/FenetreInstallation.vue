<script setup lang="ts">
import type { ModeInstallation } from '../../utils/installation'

/**
 * La fenêtre qui propose d'installer eTontine — et dit comment, sur cet
 * appareil-ci.
 *
 * Là où le navigateur sait installer d'un geste, un bouton. Ailleurs, la
 * marche à suivre, étape par étape, avec l'icône du bouton à toucher : sur un
 * iPhone, « installer une application web » ne veut rien dire tant qu'on n'a
 * pas montré le bouton Partager. Et dans le navigateur d'une autre
 * application — WhatsApp, Facebook —, le lien à rouvrir ailleurs, prêt à
 * copier.
 *
 * Feuille ancrée en bas sur téléphone, boîte centrée au-delà : c'est le
 * préréglage du Dialog (`primevue/pt.ts`). La mise en page ne la charge
 * qu'au moment de l'ouvrir : elle ne pèse rien sur le premier affichage.
 */
const { t } = useI18n()
const { installation, fermer, installer } = useInstallation()
const { copier, copie } = useCopie()

const mode = computed<ModeInstallation>(() => installation.value.mode)

/** Sur ordinateur, on parle de fenêtre et de bureau ; ailleurs, d'écran d'accueil. */
const surOrdinateur = computed(() =>
  mode.value === 'ordinateur' || mode.value === 'safari-mac'
  || (mode.value === 'invite' && import.meta.client && !/Android|iPhone|iPad|iPod|Mobile/.test(navigator.userAgent)),
)

const INTRODUCTION: Record<ModeInstallation, string> = {
  'installee': t('ui.FenetreInstallation.etontine_est_deja_installee'),
  'invite': '',
  'ios': t('ui.FenetreInstallation.mets_etontine_sur_ton'),
  'ios-safari': t('ui.FenetreInstallation.sur_cet_iphone_seul'),
  'safari-mac': '',
  'android': t('ui.FenetreInstallation.mets_etontine_sur_ton'),
  'ordinateur': '',
  'navigateur-integre': t('ui.FenetreInstallation.tu_as_ouvert_etontine'),
  'non-pris-en-charge': t('ui.FenetreInstallation.ce_navigateur_ne_sait'),
}

const introduction = computed(() =>
  INTRODUCTION[mode.value]
  || (surOrdinateur.value ? t('ui.FenetreInstallation.installe_etontine_sur_ton') : t('ui.FenetreInstallation.mets_etontine_sur_ton')),
)

interface Etape {
  icone: string
  texte: string
}

/**
 * Les gestes, dans l'ordre où on les fait. Les libellés entre guillemets sont
 * ceux des menus du système, en français : c'est ce qu'on cherche des yeux.
 */
const ETAPES: Partial<Record<ModeInstallation, Etape[]>> = {
  'ios': [
    { icone: 'lucide:share', texte: t('ui.FenetreInstallation.touche_le_bouton_partager') },
    { icone: 'lucide:square-plus', texte: t('ui.FenetreInstallation.choisis_sur_l_ecran') },
    { icone: 'lucide:circle-check', texte: t('ui.FenetreInstallation.touche_ajouter_etontine_rejoint') },
  ],
  'ios-safari': [
    { icone: 'lucide:copy', texte: t('ui.FenetreInstallation.copie_le_lien_ci') },
    { icone: 'lucide:compass', texte: t('ui.FenetreInstallation.ouvre_safari_et_colle') },
    { icone: 'lucide:share', texte: t('ui.FenetreInstallation.la_touche_partager_puis') },
  ],
  'safari-mac': [
    { icone: 'lucide:menu', texte: t('ui.FenetreInstallation.dans_la_barre_des') },
    { icone: 'lucide:square-plus', texte: t('ui.FenetreInstallation.choisis_ajouter_au_dock') },
    { icone: 'lucide:circle-check', texte: t('ui.FenetreInstallation.clique_sur_ajouter_etontine') },
  ],
  'android': [
    { icone: 'lucide:ellipsis-vertical', texte: t('ui.FenetreInstallation.ouvre_le_menu_de') },
    { icone: 'lucide:square-plus', texte: t('ui.FenetreInstallation.touche_installer_l_application') },
    { icone: 'lucide:circle-check', texte: t('ui.FenetreInstallation.confirme_etontine_rejoint_tes') },
  ],
  'ordinateur': [
    { icone: 'lucide:monitor-down', texte: t('ui.FenetreInstallation.clique_sur_l_icone') },
    { icone: 'lucide:square-plus', texte: t('ui.FenetreInstallation.choisis_installer_etontine_dans') },
    { icone: 'lucide:circle-check', texte: t('ui.FenetreInstallation.confirme_etontine_s_ouvre') },
  ],
  'navigateur-integre': [
    { icone: 'lucide:ellipsis-vertical', texte: t('ui.FenetreInstallation.touche_le_menu_de') },
    { icone: 'lucide:external-link', texte: t('ui.FenetreInstallation.choisis_ouvrir_dans_le') },
    { icone: 'lucide:smartphone', texte: t('ui.FenetreInstallation.la_etontine_te_proposera') },
  ],
}

const etapes = computed(() => ETAPES[mode.value] ?? [])

/** Là où l'on ne peut pas installer ici, le lien à rouvrir ailleurs. */
const lienARouvrir = computed(() =>
  mode.value === 'navigateur-integre' || mode.value === 'ios-safari' || mode.value === 'non-pris-en-charge',
)
// L'application, pas la page en cours : c'est elle qu'on installe, et elle
// redemande la connexion dans l'autre navigateur.
const adresse = import.meta.client ? `${window.location.origin}/app` : '/app'

const enCours = ref(false)

async function lancer() {
  enCours.value = true
  try {
    await installer()
  }
  catch {
    // La fenêtre du navigateur n'a pas pu s'ouvrir. L'invitation est lâchée :
    // la marche à suivre par le menu prend le relais, sur place.
  }
  finally {
    enCours.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="true"
    modal
    :draggable="false"
    :header="mode === 'installee' ? t('ui.FenetreInstallation.etontine_est_installee') : t('ui.FenetreInstallation.installer_etontine')"
    :close-button-props="{ 'aria-label': t('ui.FenetreInstallation.fermer'), 'data-testid': 'fermer-installation' }"
    data-testid="fenetre-installation"
    @update:visible="fermer"
  >
    <div
      class="flex flex-col gap-4"
      :data-mode="mode"
      data-testid="consignes-installation"
    >
      <p class="text-base text-ink">
        {{ introduction }}
      </p>

      <!-- Une icône par geste, et le mot avec : c'est le bouton qu'on cherche
           des yeux sur son propre écran (règle 10). -->
      <ol
        v-if="etapes.length > 0"
        class="flex flex-col gap-3"
        data-testid="etapes-installation"
      >
        <li
          v-for="(etape, i) in etapes"
          :key="etape.icone + i"
          class="flex items-start gap-3"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-surface text-brand-strong"
            aria-hidden="true"
          >
            <Icon
              :name="etape.icone"
              size="1.125rem"
            />
          </span>
          <span class="pt-1.5 text-sm text-ink">
            <strong class="font-semibold">{{ i + 1 }}.</strong>
            {{ etape.texte }}
          </span>
        </li>
      </ol>

      <p
        v-if="lienARouvrir"
        class="rounded-control border border-line bg-surface-muted p-3 font-mono text-sm break-all text-ink select-all"
        data-testid="adresse-installation"
      >
        {{ adresse }}
      </p>
    </div>

    <!-- Règle 13 : l'action primaire en bas, à portée de pouce. -->
    <template #footer>
      <template v-if="mode === 'invite'">
        <Button
          :label="t('ui.FenetreInstallation.plus_tard')"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-plus-tard-installation"
          @click="fermer"
        />
        <Button
          :label="enCours ? t('ui.FenetreInstallation.installation_en_cours') : t('ui.FenetreInstallation.installer')"
          :disabled="enCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-installer"
          @click="lancer"
        />
      </template>

      <template v-else-if="lienARouvrir">
        <Button
          :label="t('ui.FenetreInstallation.plus_tard')"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-plus-tard-installation"
          @click="fermer"
        />
        <Button
          :label="copie ? t('ui.FenetreInstallation.lien_copie') : t('ui.FenetreInstallation.copier_le_lien')"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-copier-lien-installation"
          @click="copier(adresse)"
        />
      </template>

      <Button
        v-else
        :label="t('ui.FenetreInstallation.j_ai_compris')"
        class="bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-compris-installation"
        @click="fermer"
      />
    </template>
  </Dialog>
</template>

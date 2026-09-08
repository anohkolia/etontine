<script setup lang="ts">
import { ALL_STATUS_TABLES } from '#shared/constants/statuts'
import type { StatusKind } from '#shared/constants/statuts'

/**
 * Page de vérification du socle : les composants PrimeVue habillés par le
 * préréglage pass-through (T02), et les composants de base du design system
 * (T03) avec leurs états.
 *
 * Aucun composant n'est habillé ici. Si quelque chose est laid sur cette page,
 * c'est le préréglage ou le composant qu'il faut corriger, pas ce fichier.
 *
 * Le vocabulaire suit la règle 8 : on déclare, on confirme, on enregistre.
 * Jamais « encaisser » ni « créditer ».
 */
const clicks = ref(0)
const memberName = ref('')
const otp = ref('')
const dialogVisible = ref(false)
const step = ref('1')

// Valeurs de démonstration. Aucun montant n'est calculé côté client (règle 2).
const sharesConfirmed = 4
const sharesTotal = 6
const progress = Math.round((sharesConfirmed / sharesTotal) * 100)

const kinds = Object.keys(ALL_STATUS_TABLES) as StatusKind[]
const statusesOf = (kind: StatusKind) =>
  Object.keys(ALL_STATUS_TABLES[kind]) as Array<keyof (typeof ALL_STATUS_TABLES)[StatusKind]>

const { formatRelativeDay } = useDate()
const prochainTour = new Date(Date.now() + 3 * 86_400_000)
</script>

<template>
  <div>
    <!-- La vitrine montre la promesse forte, celle des écrans couverts par la
         file de mutations. Elle est déclarée ici plutôt que subie : le défaut
         est volontairement le plus prudent des trois. -->
    <OfflineBanner nature="saisie" />

    <main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-10 px-6 py-12">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold text-ink">
          Socle technique
        </h1>
        <p class="text-ink-muted">
          Nuxt 4 · PrimeVue 4 unstyled · Tailwind 4 — composants PrimeVue et
          design system de base.
        </p>
      </header>

      <!-- ============ Design system (T03) ============ -->

      <section
        class="flex flex-col gap-4"
        data-testid="section-statusbadge"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          StatusBadge — couleur, icône et mot
        </h2>
        <p class="text-sm text-ink-muted">
          Chaque badge porte les trois signaux à la fois. Le mot reste lisible
          sans percevoir la couleur, et les formes d'icônes ne se confondent pas.
        </p>
        <div
          v-for="kind in kinds"
          :key="kind"
          class="flex flex-col gap-1.5"
        >
          <p class="text-xs text-ink-subtle">
            {{ kind }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge
              v-for="status in statusesOf(kind)"
              :key="status"
              :kind="kind"
              :status="status"
            />
          </div>
        </div>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-amount"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          AmountDisplay
        </h2>
        <div class="flex flex-col gap-1">
          <AmountDisplay
            :amount="25000"
            size="xl"
          />
          <AmountDisplay :amount="120000" />
          <AmountDisplay
            :amount="0"
            muted
          />
          <AmountDisplay :amount="null" />
        </div>
        <p class="text-sm text-ink-muted">
          Prochain tour {{ formatRelativeDay(prochainTour) }}.
        </p>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-etats"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          États d’écran
        </h2>

        <LoadingSkeleton
          variant="card"
          :count="2"
        />

        <EmptyState
          title="Aucune tontine pour l’instant"
          description="Crée ta première tontine, ou rejoins celle d’un proche avec son lien d’invitation."
          icon="lucide:inbox"
        >
          <template #action>
            <Button
              label="Créer une tontine"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
            />
          </template>
        </EmptyState>

        <ErrorState detail="TypeError: fetch failed (demo)" />
      </section>

      <!-- ============ Composants PrimeVue (T02) ============ -->

      <section
        class="flex flex-col gap-4"
        data-testid="section-button"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Button
        </h2>
        <div class="flex flex-wrap items-center gap-3">
          <Button
            label="Déclarer un paiement"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            @click="clicks++"
          />
          <Button
            label="Annuler"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          />
          <Button
            label="Indisponible"
            disabled
            class="border border-line-strong bg-surface text-ink"
          />
        </div>
        <p
          class="text-sm text-ink-muted"
          data-testid="click-count"
        >
          Clics enregistrés : {{ clicks }}
        </p>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-inputtext"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          InputText
        </h2>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="demo-name"
        >
          Nom du membre
          <InputText
            id="demo-name"
            v-model="memberName"
            placeholder="Aya Koffi"
          />
        </label>
        <p
          class="text-sm text-ink-muted"
          data-testid="name-echo"
        >
          Saisi : {{ memberName || '—' }}
        </p>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-inputotp"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          InputOtp
        </h2>
        <InputOtp
          v-model="otp"
          :length="6"
          integer-only
        />
        <p
          class="text-sm text-ink-muted"
          data-testid="otp-echo"
        >
          Code saisi : {{ otp || '—' }}
        </p>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-card"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Card et Tag
        </h2>
        <Card>
          <template #title>
            Tontine des tantines
          </template>
          <template #subtitle>
            Tour 3 sur 12 · Abobo
          </template>
          <template #content>
            <div class="flex flex-col gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <StatusBadge
                  kind="contribution"
                  status="declared"
                />
                <StatusBadge
                  kind="contribution"
                  status="confirmed"
                />
                <StatusBadge
                  kind="contribution"
                  status="late"
                />
              </div>
              <p class="flex items-baseline gap-2">
                <span class="text-sm text-ink-muted">Pot du tour</span>
                <AmountDisplay
                  :amount="150000"
                  size="lg"
                />
              </p>
              <!-- Tag PrimeVue, laissé à la démonstration du préréglage. -->
              <Tag
                class="bg-surface-muted text-ink-muted"
                data-testid="tag-primevue"
              >
                <span aria-hidden="true">·</span>
                <span>Tag PrimeVue</span>
              </Tag>
            </div>
          </template>
          <template #footer>
            <Button
              label="Voir le registre"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            />
          </template>
        </Card>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-progressbar"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          ProgressBar
        </h2>
        <ProgressBar
          :value="progress"
          :aria-label="`${sharesConfirmed} parts confirmées sur ${sharesTotal}`"
        />
        <p class="text-sm text-ink-muted">
          {{ sharesConfirmed }} parts confirmées sur {{ sharesTotal }}
        </p>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-stepper"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Stepper
        </h2>
        <Stepper v-model:value="step">
          <StepList>
            <Step value="1">
              Récapitulatif
            </Step>
            <Step value="2">
              Où envoyer
            </Step>
            <Step value="3">
              Déclaration
            </Step>
          </StepList>
          <StepPanels>
            <StepPanel value="1">
              Ce que tu dois pour ce tour.
            </StepPanel>
            <StepPanel value="2">
              Le canal de collecte et le nom du titulaire.
            </StepPanel>
            <StepPanel value="3">
              La déclaration de ton envoi.
            </StepPanel>
          </StepPanels>
        </Stepper>
      </section>

      <section
        class="flex flex-col gap-3"
        data-testid="section-dialog"
      >
        <h2 class="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Dialog
        </h2>
        <Button
          label="Ouvrir la boîte de dialogue"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          @click="dialogVisible = true"
        />
        <Dialog
          v-model:visible="dialogVisible"
          modal
          header="As-tu envoyé ?"
          :draggable="false"
        >
          <p>
            Confirme que l’envoi est parti depuis ton téléphone. Le trésorier
            confirmera ensuite la réception.
          </p>
          <template #footer>
            <Button
              label="Pas encore"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              @click="dialogVisible = false"
            />
            <Button
              label="Oui, j’ai envoyé"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              @click="dialogVisible = false"
            />
          </template>
        </Dialog>
      </section>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) : page de vérification technique, hors périmètre
  fonctionnel. Elle donne à voir les composants d'état — squelette, vide,
  erreur, bandeau hors-ligne — mais n'en dépend pas elle-même.
-->

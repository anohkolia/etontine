import { useForm } from 'vee-validate'
import type { Path } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import type { z } from 'zod'

/**
 * Un formulaire validé par un schéma Zod **partagé avec le serveur**.
 *
 * Jusqu'ici, aucun formulaire ne validait côté client : on envoyait, le
 * serveur répondait `422` avec un message, et l'écran l'affichait en bas —
 * sans dire quel champ, et après un aller-retour réseau qui, en 3G, se sent.
 * Le schéma qui refusait la saisie existait pourtant déjà dans
 * `shared/schemas/` : c'est le même qui valide ici, avant l'envoi. Une règle,
 * deux endroits qui la lisent, jamais deux règles.
 *
 * Vee-Validate tient l'état — valeurs, erreurs, champs touchés — et l'adaptateur
 * Zod traduit le schéma. La validation d'un champ se déclenche à la perte de
 * focus puis à chaque frappe une fois le champ touché : signaler une erreur dès
 * la première lettre d'un nom serait harceler, la signaler seulement à l'envoi
 * serait trop tard.
 *
 * Ce que ce composable ne fait pas : autoriser quoi que ce soit. Le serveur
 * revalide tout (règle 1) ; ici on évite un aller-retour, on ne le remplace pas.
 */
export function useFormulaire<S extends z.ZodTypeAny>(
  schema: S,
  valeursInitiales?: Partial<z.input<S>>,
) {
  const form = useForm<z.input<S>, z.output<S>>({
    validationSchema: toTypedSchema(schema),
    // Les valeurs initiales sont copiées : un objet réactif partagé avec
    // l'écran ferait valider la moindre écriture programmatique.
    initialValues: valeursInitiales ? { ...valeursInitiales } as z.input<S> : undefined,
    validateOnMount: false,
  })

  /**
   * Un champ, à lier par `v-model` : `const [nom, nomAttrs] = champ('firstName')`.
   * Les attributs portent les écouteurs de validation.
   */
  function champ<K extends Path<z.input<S>>>(nom: K) {
    return form.defineField(nom, {
      validateOnBlur: true,
      validateOnChange: true,
      validateOnInput: false,
      validateOnModelUpdate: false,
    })
  }

  /** Le message d'erreur d'un champ, s'il en a un — pour l'afficher sous l'entrée. */
  function erreur(nom: Path<z.input<S>>): string | undefined {
    return form.errors.value[nom] as string | undefined
  }

  /**
   * Valide tout et rend les valeurs **transformées** par le schéma — un numéro
   * normalisé en E.164, un nom sans espaces autour — ou `null` si quelque
   * chose bloque. Les erreurs sont alors posées champ par champ.
   */
  async function valider(): Promise<z.output<S> | null> {
    const resultat = await form.validate()
    if (!resultat.valid) return null
    return schema.parse(form.values) as z.output<S>
  }

  return {
    values: form.values,
    errors: form.errors,
    meta: form.meta,
    champ,
    erreur,
    valider,
    setFieldValue: form.setFieldValue,
    setValues: form.setValues,
    resetForm: form.resetForm,
    handleSubmit: form.handleSubmit,
  }
}

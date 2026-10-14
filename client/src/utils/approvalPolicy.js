// src/utils/approvalPolicy.js
// Seuils d'approbation N1 / N2 / N3 (même règle que backend/src/utils/approvalPolicy.js) :
// montant < n1Max → N1 (Manager) ; < n2Max → N2 (Finance) ; sinon N3 (DG). n1Max = n2Max : pas de niveau N2.
import { t, getLocale } from '../i18n'

export const DEFAULT_POLICY = { n1Max: 25000, n2Max: 100000 }

export function levelFor(amount, policy = DEFAULT_POLICY) {
  const value = Number(amount) || 0
  if (value < Number(policy.n1Max)) return 'N1'
  if (value < Number(policy.n2Max)) return 'N2'
  return 'N3'
}

/** « N2 — Finance » */
export const levelLabel = (level) => (level ? t(`approvalPolicy.levels.${level}`) : '—')

const fmt = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(Number(n) || 0)

/** « N1 en dessous de 10 000 · N2 en dessous de 50 000 · N3 au-delà » */
export function policySummary(policy) {
  if (!policy) return ''
  const noN2 = Number(policy.n1Max) === Number(policy.n2Max)
  return noN2
    ? t('approvalPolicy.summaryNoN2', { n1: fmt(policy.n1Max) })
    : t('approvalPolicy.summary', { n1: fmt(policy.n1Max), n2: fmt(policy.n2Max) })
}

/** Seuils saisis valides ? (les deux, positifs, N2 ≥ N1) */
export function policyError(n1, n2) {
  const a = Number(n1)
  const b = Number(n2)
  if (n1 === '' || n2 === '' || n1 === null || n2 === null || !Number.isFinite(a) || !Number.isFinite(b)) return t('approvalPolicy.errBoth')
  if (a <= 0) return t('approvalPolicy.errPositive')
  if (b < a) return t('approvalPolicy.errOrder')
  return null
}

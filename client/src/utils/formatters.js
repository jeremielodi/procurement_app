// src/utils/formatters.js — formats selon la langue de l'interface
import { t, getLocale } from '../i18n'

export const formatCurrency = (amount, currency = 'USD') => {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: currency,
  }).format(amount)
}

export const formatDate = (date) => {
  if (!date) return t('common.na')
  return new Date(date).toLocaleDateString(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export const formatDateTime = (date) => {
  if (!date) return t('common.na')
  return new Date(date).toLocaleString(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const formatNumber = (number) => {
  return new Intl.NumberFormat(getLocale()).format(number)
}

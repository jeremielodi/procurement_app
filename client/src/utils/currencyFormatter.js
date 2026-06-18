// src/utils/currencyFormatter.js
import { currencyService } from '../services/currencyService';

// Cache des devises pour éviter des appels API répétés
let currencyCache = null;
let currencyCacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Récupérer les devises depuis le cache ou l'API
 */
async function getCurrencies() {
  const now = Date.now();
  
  // Vérifier si le cache est valide
  if (currencyCache && currencyCacheTimestamp && (now - currencyCacheTimestamp) < CACHE_DURATION) {
    return currencyCache;
  }
  
  try {
    const response = await currencyService.getAll();
    currencyCache = response.data || [];
    currencyCacheTimestamp = now;
    return currencyCache;
  } catch (error) {
    console.error('Error loading currencies:', error);
    // Retourner un tableau vide en cas d'erreur
    return [];
  }
}

/**
 * Formater un montant selon la devise
 * @param {number} value - Le montant à formater
 * @param {number|string} currencyId - L'ID de la devise ou son format_key (USD, EUR, etc.)
 * @param {string} locale - La locale pour le formatage (par défaut 'fr-FR')
 * @returns {string} Le montant formaté
 */
export async function formatAmount(value, currencyId, locale = 'fr-FR') {
  // Si la valeur est null, undefined ou non numérique
  if (value === null || value === undefined || isNaN(value)) {
    return '-';
  }
  
  try {
    const currencies = await getCurrencies();
    
    // Trouver la devise
    let currency = null;
    
    if (typeof currencyId === 'string') {
      // Si currencyId est un format_key (USD, EUR, etc.)
      currency = currencies.find(c => c.format_key === currencyId);
    } else {
      // Si currencyId est un ID numérique
      currency = currencies.find(c => c.id === parseInt(currencyId));
    }
    
    // Si la devise n'est pas trouvée, utiliser USD par défaut
    if (!currency) {
      currency = currencies.find(c => c.format_key === 'USD');
    }
    
    // Si toujours pas trouvée, utiliser un formatage simple
    if (!currency) {
      return `${value} ${currencyId || 'USD'}`;
    }
    
    // Formater selon la devise
    const { intel_number_format, symbol, format_key, min_monentary_unit } = currency;
    
    // Utiliser le formatage Intl.NumberFormat
    try {
      const formatted = new Intl.NumberFormat(intel_number_format || locale, {
        style: 'currency',
        currency: format_key,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
      
      return formatted;
    } catch (formatError) {
      // Fallback si le formatage échoue
      return `${symbol} ${Number(value).toFixed(2)}`;
    }
  } catch (error) {
    console.error('Error formatting amount:', error);
    // Fallback simple
    return `${value} ${currencyId || 'USD'}`;
  }
}

/**
 * Formater un montant de manière synchrone (sans cache)
 * @param {number} value - Le montant à formater
 * @param {object} currency - L'objet devise
 * @param {string} locale - La locale pour le formatage
 * @returns {string} Le montant formaté
 */
export function formatAmountSync(value, currency, locale = 'fr-FR') {
  if (value === null || value === undefined || isNaN(value)) {
    return '-';
  }
  
  if (!currency) {
    return `${value} USD`;
  }
  
  try {
    const { intel_number_format, symbol, format_key } = currency;
    
    const formatted = new Intl.NumberFormat(intel_number_format || locale, {
      style: 'currency',
      currency: format_key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
    
    return formatted;
  } catch (error) {
    console.error('Error formatting amount sync:', error);
    return `${currency.symbol || ''} ${Number(value).toFixed(2)}`;
  }
}

/**
 * Formater un montant avec fallback (fonction qui gère les promesses)
 */
export function formatAmountWithFallback(value, currencyId, locale = 'fr-FR') {
  return formatAmount(value, currencyId, locale).catch(() => {
    return `${value} ${currencyId || 'USD'}`;
  });
}

/**
 * Hook React pour formater les montants (version asynchrone avec useQuery)
 */
export function useCurrencyFormatter() {
  const { data: currencies, isLoading } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => currencyService.getAll()
  });

  const format = (value, currencyId, locale = 'fr-FR') => {
    if (value === null || value === undefined || isNaN(value)) {
      return '-';
    }
    
    if (!currencies?.data || isLoading) {
      return `${value} ${currencyId || 'USD'}`;
    }
    
    const currency = currencies.data.find(c => 
      typeof currencyId === 'string' 
        ? c.format_key === currencyId 
        : c.id === parseInt(currencyId)
    );
    
    if (!currency) {
      return `${value} ${currencyId || 'USD'}`;
    }
    
    try {
      return new Intl.NumberFormat(currency.intel_number_format || locale, {
        style: 'currency',
        currency: currency.format_key,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    } catch (error) {
      return `${currency.symbol} ${Number(value).toFixed(2)}`;
    }
  };
  
  return { format, isLoading, currencies: currencies?.data || [] };
}

// Exporter par défaut
export default {
  formatAmount,
  formatAmountSync,
  formatAmountWithFallback,
  useCurrencyFormatter
};
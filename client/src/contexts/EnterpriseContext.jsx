import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { AuthContext } from './AuthContext';

const EnterpriseContext = createContext(null);

const DEFAULT_CURRENCY = {
  id: 1,
  code: 'USD',
  symbol: '$',
  locale: 'en-US',
  name: 'Dollar Américain',
};

// URL publique du logo d'une entreprise (le paramètre v invalide le cache après changement)
export const enterpriseLogoUrl = (e) =>
  e?.logo_path ? `/api/public/enterprises/${e.id}/logo?v=${encodeURIComponent(e.logo_path)}` : null;

export function EnterpriseProvider({ children }) {
  const auth = useContext(AuthContext);
  const isAuthenticated = auth?.isAuthenticated;
  // Fournisseurs (partagés) et super admin plateforme : pas d'entreprise courante
  const profiles = auth?.user?.profiles || [];
  const noEnterprise = profiles.some(p => p.id === 'prof_supplier' || p.id === 'prof_superadmin');

  const [enterprise, setEnterprise] = useState(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  const refresh = useCallback(() => {
    if (!isAuthenticated || noEnterprise) {
      setEnterprise(null);
      return Promise.resolve();
    }
    return api.get('/enterprises/current')
      .then(r => {
        const e = r.data?.data;
        setEnterprise(e || null);
        if (e?.currency_code) {
          setCurrency({
            id: e.currency_id,
            code: e.currency_code,
            symbol: e.currency_symbol || '',
            locale: e.intel_number_format || 'en-US',
            name: e.currency_name || e.currency_code,
          });
        }
      })
      .catch(() => {});
  }, [isAuthenticated, noEnterprise]);

  useEffect(() => { refresh(); }, [refresh]);

  function formatAmount(value, opts = {}) {
    const amount = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
    if (isNaN(amount)) return `0 ${currency.symbol}`;
    return new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: opts.decimals ?? 0,
      maximumFractionDigits: opts.decimals ?? 0,
    }).format(amount);
  }

  return (
    <EnterpriseContext.Provider value={{ enterprise, currency, formatAmount, refreshEnterprise: refresh }}>
      {children}
    </EnterpriseContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(EnterpriseContext);
  if (!ctx) {
    return {
      enterprise: null,
      currency: DEFAULT_CURRENCY,
      refreshEnterprise: () => Promise.resolve(),
      formatAmount: (v) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(v ?? 0),
    };
  }
  return ctx;
}

// Alias plus explicite
export const useEnterprise = useCurrency;

import { createContext, useContext, useState, useEffect } from 'react';
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

export function EnterpriseProvider({ children }) {
  const auth = useContext(AuthContext);
  const isAuthenticated = auth?.isAuthenticated;

  const [enterprise, setEnterprise] = useState(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  useEffect(() => {
    if (!isAuthenticated) return;
    api.get('/enterprises/default')
      .then(r => {
        const e = r.data?.data;
        if (e) {
          setEnterprise(e);
          if (e.currency_code) {
            setCurrency({
              id: e.currency_id,
              code: e.currency_code,
              symbol: e.currency_symbol || '',
              locale: e.intel_number_format || 'en-US',
              name: e.currency_name || e.currency_code,
            });
          }
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

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
    <EnterpriseContext.Provider value={{ enterprise, currency, formatAmount }}>
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

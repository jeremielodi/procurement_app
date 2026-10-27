// src/components/Suppliers/SupplierPortalAccessCard.jsx
// Accès au portail fournisseur : compte existant (inscription ou accès déjà donné) ou création du compte pour un
// fournisseur saisi à la main (POST /suppliers/:id/portal-access → identifiants envoyés par email).
import React, { useState } from 'react'
import { KeyRound, CheckCircle, Send, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { supplierService } from '../../services/supplierService'
import Modal from '../Common/Modal'
import SearchSelect from '../Common/SearchSelect'
import { formatDateTime } from '../../utils/formatters'
import { t, getLang, LANGUAGES } from '../../i18n'

const EMAIL_RE = /^\S+@\S+\.\S+$/

export default function SupplierPortalAccessCard({ supplier, canManage, onChanged }) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState(LANGUAGES.some(l => l.code === getLang()) ? getLang() : LANGUAGES[0].code)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  const account = supplier.portal_account
  const hasEmail = EMAIL_RE.test(supplier.email || '')
  const inactive = supplier.status && supplier.status !== 'ACTIVE'

  const grant = async () => {
    setSending(true)
    setError(null)
    try {
      await supplierService.grantPortalAccess(supplier.id, { language })
      toast.success(t('supplierAccess.granted', { email: supplier.email }))
      setOpen(false)
      onChanged?.()
    } catch (e) {
      const code = e.response?.data?.code
      setError(code ? t(`supplierAccess.err.${code}`) : (e.response?.data?.message || t('supplierAccess.err.GENERIC')))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow" data-testid="supplier-portal-access">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <KeyRound size={20} />
          {t('supplierAccess.title')}
        </h2>
      </div>
      <div className="p-6 space-y-3 text-sm">
        {account ? (
          <>
            <p className="flex items-center gap-2 text-green-700 font-medium" data-testid="portal-access-active">
              <CheckCircle size={18} />
              {account.is_active ? t('supplierAccess.active') : t('supplierAccess.disabled')}
            </p>
            <p className="text-gray-600">{t('supplierAccess.loginEmail')} <b className="text-gray-800">{account.email}</b></p>
            <p className="text-gray-500">
              {account.last_login
                ? t('supplierAccess.lastLogin', { date: formatDateTime(account.last_login) })
                : t('supplierAccess.neverLoggedIn')}
            </p>
            <p className="text-gray-500">{t('supplierAccess.forgotHint')}</p>
          </>
        ) : (
          <>
            <p className="text-gray-600">{t('supplierAccess.none')}</p>
            {canManage && !hasEmail && (
              <p className="flex items-start gap-2 text-amber-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{t('supplierAccess.emailMissing')}</p>
            )}
            {canManage && inactive && (
              <p className="flex items-start gap-2 text-amber-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{t('supplierAccess.inactive')}</p>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => { setError(null); setOpen(true) }}
                disabled={!hasEmail || inactive}
                data-testid="grant-portal-access"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} />
                {t('supplierAccess.grant')}
              </button>
            )}
          </>
        )}
      </div>

      {open && (
        <Modal isOpen={open} onClose={() => !sending && setOpen(false)} title={t('supplierAccess.confirmTitle')}>
          <div className="space-y-4 text-sm">
            <p className="text-gray-700">{t('supplierAccess.confirmText', { email: supplier.email })}</p>
            <div>
              <label className="block font-medium text-gray-700 mb-1" htmlFor="portal-access-language">{t('supplierAccess.language')}</label>
              <SearchSelect id="portal-access-language" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </SearchSelect>
            </div>
            {error && <p className="text-red-600" data-testid="portal-access-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={sending} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={grant} disabled={sending} data-testid="confirm-portal-access"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {sending ? t('supplierAccess.sending') : t('supplierAccess.send')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

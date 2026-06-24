import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import { paymentService } from '../../services/paymentService';
import api from '../../services/api';
import { useCurrency } from '../../contexts/EnterpriseContext';

const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Virement bancaire' },
  { value: 'CHECK',         label: 'Chèque' },
  { value: 'CASH',          label: 'Espèces' },
  { value: 'MOBILE_MONEY',  label: 'Mobile Money' },
];

export default function PaymentForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get('invoiceId');
  const poId      = searchParams.get('poId');
  const taskId    = searchParams.get('taskId');

  const { currency } = useCurrency();
  const [invoice, setInvoice] = useState(null);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    amount: '',
    currency: '',
    paymentMethod: 'BANK_TRANSFER',
    paymentDate: new Date().toISOString().split('T')[0],
    reference: '',
    bankAccount: '',
    notes: ''
  });

  useEffect(() => {
    api.get('/currencies').then(r => setCurrencies(r.data?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (currency.code && !form.currency) {
      setForm(f => ({ ...f, currency: currency.code }));
    }
  }, [currency.code]);

  useEffect(() => {
    if (!invoiceId) return;
    api.get(`/invoices/${invoiceId}`)
      .then(r => {
        const d = r.data?.data;
        setInvoice(d);
        setForm(f => ({
          ...f,
          amount: d?.total_amount || '',
          currency: d?.currency || currency.code || ''
        }));
      })
      .catch(() => {});
  }, [invoiceId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.amount) { toast.error('Le montant est requis'); return; }

    setLoading(true);
    try {
      const res = await paymentService.create({
        ...form,
        invoiceId: invoiceId || undefined,
        poId: poId || undefined,
        taskId: taskId || undefined
      });
      if (res.success) {
        toast.success(`Paiement ${res.data.paymentNumber} enregistré`);
        navigate('/payments');
      } else {
        toast.error(res.message || 'Erreur création paiement');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erreur lors du paiement');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour
      </button>

      <div className="flex items-center gap-3 mb-6">
        <CreditCard size={28} className="text-green-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nouveau Paiement</h1>
          {invoice && <p className="text-gray-500 text-sm">Facture {invoice.invoice_number} — {invoice.supplier_name}</p>}
        </div>
      </div>

      {invoice && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 text-sm grid grid-cols-3 gap-3">
          <div><span className="text-green-700 font-medium">Facture</span><br />{invoice.invoice_number}</div>
          <div><span className="text-green-700 font-medium">Montant dû</span><br />{parseFloat(invoice.total_amount).toLocaleString()} {invoice.currency}</div>
          <div><span className="text-green-700 font-medium">Échéance</span><br />{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR') : '—'}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Montant *</label>
            <input type="number" min="0" step="0.01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Devise</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.currency}
              onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
            >
              {currencies.length > 0
                ? currencies.map(c => <option key={c.id} value={c.format_key}>{c.format_key} — {c.name}</option>)
                : <option value={currency.code}>{currency.code}</option>}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mode de paiement</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={form.paymentMethod}
            onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
          >
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date de paiement</label>
          <input type="date"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.paymentDate}
            onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Référence</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="N° de virement, chèque…"
              value={form.reference}
              onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Compte bancaire</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="IBAN ou n° compte"
              value={form.bankAccount}
              onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            Annuler
          </button>
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium">
            {loading ? 'Enregistrement…' : <><Save size={16} /> Enregistrer le paiement</>}
          </button>
        </div>
      </form>
    </div>
  );
}

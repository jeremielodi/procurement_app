import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoiceService } from '../../services/invoiceService';
import api from '../../services/api';
import { useCurrency } from '../../contexts/EnterpriseContext';

export default function InvoiceForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poId   = searchParams.get('poId');
  const grnId  = searchParams.get('grnId');
  const taskId = searchParams.get('taskId');

  const { currency } = useCurrency();
  const [po, setPO] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    subtotal: '',
    taxAmount: '0',
    totalAmount: '',
    currency: '',
    notes: '',
    supplierId: '',
    poId: poId || '',
    grnId: grnId || ''
  });

  useEffect(() => {
    api.get('/currencies').then(r => setCurrencies(r.data?.data || [])).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (currency.code && !form.currency) {
      setForm(f => ({ ...f, currency: currency.code }));
    }
  }, [currency.code]);

  useEffect(() => {
    if (!poId) return;
    api.get(`/purchase-orders/${poId}`)
      .then(r => {
        const d = r.data?.data;
        setPO(d);
        setForm(f => ({
          ...f,
          supplierId: d?.supplier_id || '',
          currency: d?.currency || currency.code || '',
          totalAmount: d?.total_amount || '',
          subtotal: d?.total_amount || ''
        }));
      })
      .catch(() => {});
  }, [poId]);

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      // Auto-compute total
      if (field === 'subtotal' || field === 'taxAmount') {
        next.totalAmount = (parseFloat(next.subtotal || 0) + parseFloat(next.taxAmount || 0)).toFixed(2);
      }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.totalAmount || !form.invoiceDate) {
      toast.error('Montant total et date de facture sont requis');
      return;
    }
    setLoading(true);
    try {
      const res = await invoiceService.create({
        ...form,
        taskId: taskId || undefined,
        poId: form.poId || undefined,
        grnId: form.grnId || undefined,
        supplierId: form.supplierId || undefined
      });
      if (res.success) {
        const matchLabel = res.data.match_status === 'MATCHED' ? '✅ Rapprochée' : `⚠️ ${res.data.match_status}`;
        toast.success(`Facture créée — ${matchLabel}`);
        navigate(`/invoices/${res.data.id}`);
      } else {
        toast.error(res.message || 'Erreur création facture');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour
      </button>

      <div className="flex items-center gap-3 mb-6">
        <FileText size={28} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Saisie Facture Fournisseur</h1>
          {po && <p className="text-gray-500 text-sm">Commande {po.po_number} — {po.supplier_name}</p>}
        </div>
      </div>

      {po && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm grid grid-cols-3 gap-3">
          <div><span className="text-blue-600 font-medium">PO</span><br />{po.po_number}</div>
          <div><span className="text-blue-600 font-medium">Montant PO</span><br />{parseFloat(po.total_amount || 0).toLocaleString()} {po.currency}</div>
          <div><span className="text-blue-600 font-medium">GRN lié</span><br />{grnId ? `GRN #${grnId}` : '—'}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">N° Facture fournisseur</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Auto-généré si vide"
              value={form.invoiceNumber}
              onChange={e => set('invoiceNumber', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.supplierId}
              onChange={e => set('supplierId', e.target.value)}
            >
              <option value="">Sélectionner…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date facture *</label>
            <input type="date" required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.invoiceDate}
              onChange={e => set('invoiceDate', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date d'échéance</label>
            <input type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.dueDate}
              onChange={e => set('dueDate', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sous-total HT *</label>
            <input type="number" min="0" step="0.01" required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.subtotal}
              onChange={e => set('subtotal', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TVA / Taxes</label>
            <input type="number" min="0" step="0.01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.taxAmount}
              onChange={e => set('taxAmount', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total TTC *</label>
            <input type="number" min="0" step="0.01" required
              className="w-full border border-blue-300 bg-blue-50 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.totalAmount}
              onChange={e => set('totalAmount', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Devise</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.currency}
              onChange={e => set('currency', e.target.value)}
            >
              {currencies.length > 0
              ? currencies.map(c => <option key={c.id} value={c.format_key}>{c.format_key} — {c.name}</option>)
              : <option value={currency.code}>{currency.code}</option>}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">N° Commande (PO)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
              value={form.poId}
              readOnly
              placeholder="Non lié à une commande"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Le rapprochement 3 voies (PO + GRN + Facture) sera effectué automatiquement lors de la validation.
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            Annuler
          </button>
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium">
            {loading ? 'Enregistrement…' : <><Save size={16} /> Enregistrer et rapprocher</>}
          </button>
        </div>
      </form>
    </div>
  );
}

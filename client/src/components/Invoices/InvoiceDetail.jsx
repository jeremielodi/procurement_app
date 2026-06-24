import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, FileText, CheckCircle, XCircle, AlertTriangle, RefreshCw, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoiceService } from '../../services/invoiceService';

const MATCH_CONFIG = {
  MATCHED:        { label: 'Rapprochement réussi ✅', cls: 'border-green-300 bg-green-50 text-green-800', icon: CheckCircle },
  PENDING:        { label: 'Rapprochement en attente', cls: 'border-yellow-300 bg-yellow-50 text-yellow-800', icon: AlertTriangle },
  PRICE_MISMATCH: { label: 'Écart de prix ❌', cls: 'border-red-300 bg-red-50 text-red-800', icon: XCircle },
  NO_GRN:         { label: 'Aucun GRN trouvé ❌', cls: 'border-red-300 bg-red-50 text-red-800', icon: XCircle },
  GRN_PARTIAL:    { label: 'GRN partiel ⚠️', cls: 'border-orange-300 bg-orange-50 text-orange-800', icon: AlertTriangle },
  MISMATCH:       { label: 'Non conforme ❌', cls: 'border-red-300 bg-red-50 text-red-800', icon: XCircle },
};

const STATUS_LABELS = {
  DRAFT: 'Brouillon', SUBMITTED: 'Soumise', APPROVED: 'Approuvée',
  REJECTED: 'Rejetée', PAID: 'Payée', PARTIALLY_PAID: 'Paiement partiel'
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rematchLoading, setRematchLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await invoiceService.getById(id);
      setInvoice(res.data);
    } catch {
      toast.error('Facture introuvable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  async function handleRematch() {
    setRematchLoading(true);
    try {
      const res = await invoiceService.runMatch(id);
      toast.success(`Rapprochement: ${res.data.match_status}`);
      load();
    } catch {
      toast.error('Erreur rapprochement');
    } finally {
      setRematchLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!invoice) return <div className="p-6 text-gray-500">Facture introuvable.</div>;

  const match = MATCH_CONFIG[invoice.match_status] || MATCH_CONFIG.PENDING;
  const MatchIcon = match.icon;
  const matchDetails = typeof invoice.match_details === 'object' ? invoice.match_details : null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText size={28} className="text-blue-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{invoice.invoice_number}</h1>
            <p className="text-sm text-gray-500">
              {invoice.supplier_name && `${invoice.supplier_name} — `}
              {STATUS_LABELS[invoice.status] || invoice.status}
            </p>
          </div>
        </div>
        <button onClick={handleRematch} disabled={rematchLoading}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm">
          <RefreshCw size={14} className={rematchLoading ? 'animate-spin' : ''} /> Relancer rapprochement
        </button>
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Sous-total HT', value: parseFloat(invoice.subtotal || 0).toLocaleString() },
          { label: 'TVA / Taxes', value: parseFloat(invoice.tax_amount || 0).toLocaleString() },
          { label: 'Total TTC', value: `${parseFloat(invoice.total_amount || 0).toLocaleString()} ${invoice.currency}`, bold: true },
        ].map(({ label, value, bold }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`${bold ? 'text-xl font-bold text-gray-900' : 'text-gray-700'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Dates & Links */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Date facture</p>
          <p>{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('fr-FR') : '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Échéance</p>
          <p>{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR') : '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Commande liée</p>
          <p>{invoice.po_number
            ? <Link to={`/purchase-orders/${invoice.po_id}`} className="text-blue-600 underline">{invoice.po_number}</Link>
            : '—'}
          </p>
        </div>
      </div>

      {/* 3-Way Match Result */}
      <div className={`border rounded-xl p-4 mb-6 ${match.cls}`}>
        <div className="flex items-center gap-2 font-semibold mb-3">
          <MatchIcon size={18} /> {match.label}
        </div>
        {matchDetails?.checks && (
          <div className="space-y-2">
            {matchDetails.checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {c.passed
                  ? <CheckCircle size={14} className="text-green-600 mt-0.5 shrink-0" />
                  : <XCircle size={14} className="text-red-600 mt-0.5 shrink-0" />}
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {invoice.match_status === 'MATCHED' && !['PAID', 'PARTIALLY_PAID'].includes(invoice.status) && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm text-green-800 font-medium mb-3">Facture rapprochée — vous pouvez initier le paiement</p>
          <Link
            to={`/payments/new?invoiceId=${invoice.id}`}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <CreditCard size={16} /> Initier le paiement →
          </Link>
        </div>
      )}

      {['PAID', 'PARTIALLY_PAID'].includes(invoice.status) && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
          Cette facture est {STATUS_LABELS[invoice.status]?.toLowerCase()}.
        </div>
      )}

      {invoice.notes && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
          <p className="font-medium text-gray-700 mb-1">Notes</p>
          <p className="text-gray-600">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}

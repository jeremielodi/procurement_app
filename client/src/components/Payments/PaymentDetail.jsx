import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CreditCard, FileText, CheckCircle, Clock, XCircle, Download, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { paymentService } from '../../services/paymentService';
import { useCurrency } from '../../contexts/EnterpriseContext';

const STATUS_CONFIG = {
  PENDING:    { label: 'En attente',   cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
  PROCESSING: { label: 'En cours',    cls: 'bg-blue-100 text-blue-800 border-blue-300',       icon: Clock },
  PAID:       { label: 'Payé',        cls: 'bg-green-100 text-green-800 border-green-300',    icon: CheckCircle },
  FAILED:     { label: 'Échoué',      cls: 'bg-red-100 text-red-800 border-red-300',          icon: XCircle },
  CANCELLED:  { label: 'Annulé',      cls: 'bg-gray-100 text-gray-800 border-gray-300',       icon: XCircle },
};

const METHOD_LABELS = {
  BANK_TRANSFER: 'Virement bancaire',
  CHECK:         'Chèque',
  CASH:          'Espèces',
  MOBILE_MONEY:  'Mobile Money',
};

export default function PaymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { formatAmount } = useCurrency();

  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await paymentService.getById(id);
      setPayment(res.data);
    } catch {
      toast.error('Paiement introuvable');
      navigate('/payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  async function handleApprove() {
    setApproving(true);
    try {
      await paymentService.approve(id);
      toast.success('Paiement marqué comme PAYÉ');
      load();
    } catch {
      toast.error('Erreur lors de l\'approbation');
    } finally {
      setApproving(false);
    }
  }

  async function loadPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await paymentService.generatePDF(id);
      if (!blob || blob.size === 0) throw new Error('PDF vide');
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPdfError(e.message || 'Impossible de charger le PDF');
      toast.error('Erreur génération PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  function handleOpenPdf() {
    setShowPdf(true);
    if (!pdfUrl) loadPdf();
  }

  async function handleDownloadPdf() {
    try {
      const blob = await paymentService.generatePDF(id);
      if (!blob || blob.size === 0) throw new Error('PDF vide');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `payment_${payment.payment_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('PDF téléchargé');
    } catch {
      toast.error('Erreur téléchargement PDF');
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
    </div>
  );
  if (!payment) return null;

  const sc = STATUS_CONFIG[payment.status] || STATUS_CONFIG.PENDING;
  const StatusIcon = sc.icon;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/payments')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour aux paiements
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <CreditCard size={28} className="text-green-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{payment.payment_number}</h1>
            <p className="text-sm text-gray-500">
              {payment.supplier_name && `${payment.supplier_name} — `}
              Créé le {payment.created_at ? new Date(payment.created_at).toLocaleDateString('fr-FR') : '—'}
              {payment.created_by_name && ` par ${payment.created_by_name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleDownloadPdf}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm text-gray-600">
            <Download size={14} /> Télécharger PDF
          </button>
          <button onClick={() => showPdf ? setShowPdf(false) : handleOpenPdf()}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
            <FileText size={14} /> {showPdf ? 'Fermer PDF' : 'Voir reçu PDF'}
          </button>
        </div>
      </div>

      {/* Status badge */}
      <div className={`inline-flex items-center gap-2 border rounded-full px-4 py-1.5 text-sm font-semibold mb-6 ${sc.cls}`}>
        <StatusIcon size={15} /> {sc.label}
      </div>

      {/* PDF Viewer */}
      {showPdf && (
        <div className="mb-6 border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Reçu PDF — {payment.payment_number}</span>
            <div className="flex gap-2">
              <button onClick={handleDownloadPdf}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <Download size={12} /> Télécharger
              </button>
              <button onClick={() => { setPdfError(null); loadPdf(); }}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <RefreshCw size={12} /> Actualiser
              </button>
              <button onClick={() => setShowPdf(false)}
                className="text-xs text-gray-500 hover:text-gray-700 ml-2">✕ Fermer</button>
            </div>
          </div>
          {pdfLoading ? (
            <div className="flex justify-center items-center h-96 bg-gray-50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
              <span className="ml-3 text-sm text-gray-500">Génération du PDF…</span>
            </div>
          ) : pdfError ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-500 bg-gray-50">
              <p className="text-sm">{pdfError}</p>
              <button onClick={loadPdf} className="mt-2 text-xs text-green-600 underline flex items-center gap-1">
                <RefreshCw size={12} /> Réessayer
              </button>
            </div>
          ) : pdfUrl ? (
            <embed
              key={pdfUrl}
              src={pdfUrl}
              type="application/pdf"
              className="w-full bg-white"
              style={{ minHeight: '70vh' }}
            />
          ) : null}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-700 uppercase mb-1">Montant payé</p>
          <p className="text-2xl font-bold text-green-800">{formatAmount(payment.amount)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Mode de paiement</p>
          <p className="text-base font-semibold text-gray-900">{METHOD_LABELS[payment.payment_method] || payment.payment_method || '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Date de paiement</p>
          <p className="text-base font-semibold text-gray-900">
            {payment.payment_date ? new Date(payment.payment_date).toLocaleDateString('fr-FR') : '—'}
          </p>
        </div>
      </div>

      {/* Linked documents */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Facture liée</p>
          {payment.invoice_number
            ? <Link to={`/invoices/${payment.invoice_id}`} className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
                {payment.invoice_number}
              </Link>
            : <span className="text-gray-400 text-sm">—</span>}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Commande (PO)</p>
          {payment.po_number
            ? <Link to={`/purchase-orders/${payment.po_id}`} className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
                {payment.po_number}
              </Link>
            : <span className="text-gray-400 text-sm">—</span>}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Fournisseur</p>
          <span className="text-sm font-medium text-gray-900">{payment.supplier_name || '—'}</span>
        </div>
      </div>

      {/* Reference & bank account */}
      {(payment.reference || payment.bank_account) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {payment.reference && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Référence</p>
              <p className="text-sm font-medium text-gray-900 font-mono">{payment.reference}</p>
            </div>
          )}
          {payment.bank_account && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Compte bancaire</p>
              <p className="text-sm font-medium text-gray-900 font-mono">{payment.bank_account}</p>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {payment.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-amber-700 uppercase mb-1">Notes</p>
          <p className="text-sm text-amber-900">{payment.notes}</p>
        </div>
      )}

      {/* Approve action */}
      {payment.status === 'PENDING' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-yellow-800 font-medium">Paiement en attente de confirmation</p>
          <button onClick={handleApprove} disabled={approving}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
            {approving
              ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <CheckCircle size={16} />}
            {approving ? 'En cours…' : 'Confirmer le paiement'}
          </button>
        </div>
      )}

      {payment.status === 'PAID' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          Paiement confirmé et enregistré.
          {payment.approved_at && ` Le ${new Date(payment.approved_at).toLocaleDateString('fr-FR')}.`}
        </div>
      )}
    </div>
  );
}

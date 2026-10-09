import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CreditCard, FileText, CheckCircle, Clock, XCircle, Download, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { paymentService } from '../../services/paymentService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t, withLabel, labelMap, getLocale } from '../../i18n';

const STATUS_CONFIG = withLabel('paymentStatus', {
  PENDING:    { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
  PROCESSING: { cls: 'bg-blue-100 text-blue-800 border-blue-300',       icon: Clock },
  PAID:       { cls: 'bg-green-100 text-green-800 border-green-300',    icon: CheckCircle },
  FAILED:     { cls: 'bg-red-100 text-red-800 border-red-300',          icon: XCircle },
  CANCELLED:  { cls: 'bg-gray-100 text-gray-800 border-gray-300',       icon: XCircle },
});

const METHOD_LABELS = labelMap('paymentMethod', ['BANK_TRANSFER', 'CHECK', 'CASH', 'MOBILE_MONEY']);

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
      toast.error(t('payment.notFound'));
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
      toast.success(t('payment.markedPaid'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || t('payment.approveError'));
    } finally {
      setApproving(false);
    }
  }

  async function loadPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await paymentService.generatePDF(id);
      if (!blob || blob.size === 0) throw new Error(t('payment.emptyPdf'));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPdfError(e.message || t('pdf.loadError'));
      toast.error(t('payment.pdfError'));
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
      if (!blob || blob.size === 0) throw new Error(t('payment.emptyPdf'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `payment_${payment.payment_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(t('payment.pdfDownloaded'));
    } catch {
      toast.error(t('payment.downloadError'));
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
        <ArrowLeft size={16} /> {t('payment.backToList')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <CreditCard size={28} className="text-green-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{payment.payment_number}</h1>
            <p className="text-sm text-gray-500">
              {payment.supplier_name && `${payment.supplier_name} — `}
              {t('payment.createdOn', { date: payment.created_at ? new Date(payment.created_at).toLocaleDateString(getLocale()) : '—' })}
              {payment.created_by_name && t('payment.by', { name: payment.created_by_name })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleDownloadPdf}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm text-gray-600">
            <Download size={14} /> {t('payment.downloadPdf')}
          </button>
          <button onClick={() => showPdf ? setShowPdf(false) : handleOpenPdf()}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
            <FileText size={14} /> {showPdf ? t('payment.closePdf') : t('payment.viewReceipt')}
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
            <span className="text-sm font-medium text-gray-700">{t('payment.receipt', { number: payment.payment_number })}</span>
            <div className="flex gap-2">
              <button onClick={handleDownloadPdf}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <Download size={12} /> {t('common.download')}
              </button>
              <button onClick={() => { setPdfError(null); loadPdf(); }}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <RefreshCw size={12} /> {t('common.refresh')}
              </button>
              <button onClick={() => setShowPdf(false)}
                className="text-xs text-gray-500 hover:text-gray-700 ml-2">{t('payment.close')}</button>
            </div>
          </div>
          {pdfLoading ? (
            <div className="flex justify-center items-center h-96 bg-gray-50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
              <span className="ml-3 text-sm text-gray-500">{t('pdf.generating')}</span>
            </div>
          ) : pdfError ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-500 bg-gray-50">
              <p className="text-sm">{pdfError}</p>
              <button onClick={loadPdf} className="mt-2 text-xs text-green-600 underline flex items-center gap-1">
                <RefreshCw size={12} /> {t('common.retry')}
              </button>
            </div>
          ) : pdfUrl ? (
            <iframe
              key={pdfUrl}
              src={pdfUrl}
              title={t('payment.pdfTitle')}
              className="w-full bg-white"
              style={{ minHeight: '70vh' }}
            />
          ) : null}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-700 uppercase mb-1">{t('payment.amountPaid')}</p>
          <p className="text-2xl font-bold text-green-800">{formatAmount(payment.amount)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.method')}</p>
          <p className="text-base font-semibold text-gray-900">{METHOD_LABELS[payment.payment_method] || payment.payment_method || '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.paymentDate')}</p>
          <p className="text-base font-semibold text-gray-900">
            {payment.payment_date ? new Date(payment.payment_date).toLocaleDateString(getLocale()) : '—'}
          </p>
        </div>
      </div>

      {/* Linked documents */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.linkedInvoice')}</p>
          {payment.invoice_number
            ? <Link to={`/invoices/${payment.invoice_id}`} className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
                {payment.invoice_number}
              </Link>
            : <span className="text-gray-400 text-sm">—</span>}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.order')}</p>
          {payment.po_number
            ? <Link to={`/purchase-orders/${payment.po_id}`} className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
                {payment.po_number}
              </Link>
            : <span className="text-gray-400 text-sm">—</span>}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('common.supplier')}</p>
          <span className="text-sm font-medium text-gray-900">{payment.supplier_name || '—'}</span>
        </div>
      </div>

      {/* Reference & bank account */}
      {(payment.reference || payment.bank_account) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {payment.reference && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.reference')}</p>
              <p className="text-sm font-medium text-gray-900 font-mono">{payment.reference}</p>
            </div>
          )}
          {payment.bank_account && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('payment.bankAccount')}</p>
              <p className="text-sm font-medium text-gray-900 font-mono">{payment.bank_account}</p>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {payment.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-amber-700 uppercase mb-1">{t('common.notes')}</p>
          <p className="text-sm text-amber-900">{payment.notes}</p>
        </div>
      )}

      {/* Approve action */}
      {payment.status === 'PENDING' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-yellow-800 font-medium">{t('payment.awaitingConfirmation')}</p>
            {['PENDING', 'REJECTED'].includes(payment.bank_status) && (
              <p className="mt-1 text-sm text-red-700" data-testid="payment-bank-blocked">
                {t('payment.bankBlocked')}{' '}
                {payment.supplier_id && <Link to={`/suppliers/${payment.supplier_id}?tab=bank`} className="underline">{t('supplierBank.open')}</Link>}
              </p>
            )}
          </div>
          {payment.self_approval ? (
            <span className="text-sm text-amber-800" data-testid="payment-self-approval">{t('payment.selfApproval')}</span>
          ) : (
            <button onClick={handleApprove} disabled={approving || ['PENDING', 'REJECTED'].includes(payment.bank_status)}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
              {approving
                ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                : <CheckCircle size={16} />}
              {approving ? t('payment.processing') : t('payment.confirm')}
            </button>
          )}
        </div>
      )}

      {payment.status === 'PAID' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          {t('payment.confirmed')}
          {payment.approved_at && t('payment.confirmedOn', { date: new Date(payment.approved_at).toLocaleDateString(getLocale()) })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Package, CheckCircle, AlertTriangle, Clock, Eye, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { grnService } from '../../services/grnService';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { t, withLabel, getLocale } from '../../i18n';

const STATUS_CONFIG = withLabel('grnStatus', {
  COMPLETE: { icon: CheckCircle, cls: 'text-green-600 bg-green-50 border-green-200' },
  PARTIAL:  { icon: AlertTriangle, cls: 'text-orange-600 bg-orange-50 border-orange-200' },
  PENDING:  { icon: Clock, cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  DRAFT:    { icon: Clock, cls: 'text-gray-600 bg-gray-50 border-gray-200' },
});

export default function GRNDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [grn, setGrn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    grnService.getById(id)
      .then(r => setGrn(r.data))
      .catch(() => toast.error(t('grn.notFound')))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }
  if (!grn) {
    return <div className="p-6 text-gray-500">{t('grn.notFoundDot')}</div>;
  }

  const status = STATUS_CONFIG[grn.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = status.icon;
  const totalReceived = (grn.items || []).reduce((s, i) => s + (i.quantity_received || 0), 0);
  const totalRejected = (grn.items || []).reduce((s, i) => s + (i.quantity_rejected || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
        <div className="flex gap-2">
          <button onClick={() => setShowPdf(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            <Eye size={16} /> {t('grn.pdfPreview')}
          </button>
          <button onClick={() => grnService.downloadPDF(grn.id, grn.grn_number).catch(() => {})}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            <Download size={16} /> {t('common.download')}
          </button>
        </div>
      </div>

      {showPdf && (
        <BlobPdfViewer
          title={grn.grn_number}
          fileName={`${grn.grn_number}.pdf`}
          fetchPdf={() => grnService.getPDF(grn.id)}
          onClose={() => setShowPdf(false)}
          infoBar={<>
            <span><span className="text-gray-500">{t('grn.orderLabel')}</span> <b>{grn.po_number || '—'}</b></span>
            <span><span className="text-gray-500">{t('grn.supplierLabel')}</span> <b>{grn.supplier_name || '—'}</b></span>
            <span><span className="text-gray-500">{t('grn.receiptLabel')}</span> <b>{grn.receipt_date ? new Date(grn.receipt_date).toLocaleDateString(getLocale()) : '—'}</b></span>
          </>}
        />
      )}

      {/* Header */}
      <div className={`flex items-center justify-between p-4 rounded-xl border mb-6 ${status.cls}`}>
        <div className="flex items-center gap-3">
          <Package size={28} />
          <div>
            <h1 className="text-xl font-bold">{grn.grn_number}</h1>
            <p className="text-sm opacity-80">
              {grn.po_number && <Link to={`/purchase-orders/${grn.po_id}`} className="underline">{t('grn.orderLink', { number: grn.po_number })}</Link>}
              {grn.supplier_name && ` — ${grn.supplier_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-medium">
          <StatusIcon size={18} /> {status.label}
        </div>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: t('grn.receiptDate'), value: grn.receipt_date ? new Date(grn.receipt_date).toLocaleDateString(getLocale()) : '—' },
          { label: t('grn.receivedBy'), value: grn.received_by_name || '—' },
          { label: t('grn.totalReceived'), value: totalReceived },
          { label: t('grn.rejectedQty'), value: totalRejected, warn: totalRejected > 0 },
        ].map(({ label, value, warn }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`font-semibold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h2 className="font-medium text-gray-700">{t('grn.receivedItems')}</h2>
        </div>
        {(grn.items || []).length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">{t('grn.noRecordedItems')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {t('grn.detailCols', { returnObjects: true }).map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grn.items.map(item => (
                <tr key={item.id} className={item.quantity_rejected > 0 ? 'bg-red-50' : ''}>
                  <td className="px-4 py-2 text-gray-900">{item.item_description}</td>
                  <td className="px-4 py-2 text-center">{item.quantity_received}</td>
                  <td className="px-4 py-2 text-center text-green-700 font-medium">{item.quantity_accepted}</td>
                  <td className="px-4 py-2 text-center text-red-600 font-medium">{item.quantity_rejected || 0}</td>
                  <td className="px-4 py-2 text-gray-500 italic">{item.rejection_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Observations */}
      {grn.observations && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-gray-700 mb-1">{t('grn.observations')}</p>
          <p className="text-gray-600">{grn.observations}</p>
        </div>
      )}

      {/* Action: Create Invoice */}
      {/* {grn.status === 'COMPLETE' && (
        <div className="mt-6">
          <Link
            to={`/invoices/new?poId=${grn.po_id}&grnId=${grn.id}`}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Saisir la facture pour cette réception →
          </Link>
        </div>
      )} */}
    </div>
  );
}

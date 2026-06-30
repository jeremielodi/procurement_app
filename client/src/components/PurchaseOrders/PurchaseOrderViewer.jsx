import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Printer, AlertCircle, FileText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { purchaseOrderService } from '../../services/purchaseOrderService';

const PurchaseOrderViewer = ({ poId, po, onClose }) => {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadPDF();
    }
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [poId]);

  const loadPDF = async () => {
    try {
      setLoading(true);
      setError(null);
      const pdfBlob = await purchaseOrderService.generatePDF(poId);
      if (!pdfBlob || pdfBlob.size === 0) throw new Error('Le PDF généré est vide');
      setPdfUrl(URL.createObjectURL(pdfBlob));
    } catch (err) {
      setError(err.message || 'Impossible de charger le PDF');
      toast.error('Erreur de chargement du PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const pdfBlob = await purchaseOrderService.generatePDF(poId);
      if (!pdfBlob || pdfBlob.size === 0) throw new Error('Le PDF est vide');
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PO_${po?.po_number || poId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('PDF téléchargé avec succès');
    } catch (err) {
      toast.error(err.message || 'Erreur lors du téléchargement');
    }
  };

  const handlePrint = () => {
    if (pdfUrl) {
      const win = window.open(pdfUrl, '_blank');
      if (win) win.onload = () => setTimeout(() => win.print(), 1000);
      else toast.error("Impossible d'ouvrir la fenêtre d'impression");
    }
  };

  const handleRetry = () => {
    hasLoadedRef.current = false;
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    loadPDF();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 flex flex-col items-center min-w-[320px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
          <p className="mt-4 text-gray-600">Génération du PDF…</p>
          <p className="text-sm text-gray-400 mt-1">Veuillez patienter</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle size={24} />
            <h3 className="text-lg font-semibold">Erreur</h3>
          </div>
          <p className="text-gray-600">{error}</p>
          <div className="mt-4 flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
              Fermer
            </button>
            <button onClick={handleRetry} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2">
              <RefreshCw size={16} /> Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Toolbar */}
        <div className="bg-gray-100 rounded-t-lg px-4 py-3 flex items-center justify-between border-b flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
              <X size={20} />
            </button>
            <div className="h-6 w-px bg-gray-300" />
            <FileText size={20} className="text-green-600" />
            <span className="font-medium text-gray-800">{po?.po_number || 'Bon de commande'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
              <Download size={16} /> Télécharger
            </button>
            <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm">
              <Printer size={16} /> Imprimer
            </button>
          </div>
        </div>

        {/* PO info bar */}
        {po && (
          <div className="bg-green-50 px-4 py-2 border-b border-green-100 flex flex-wrap gap-4 text-sm">
            <div><span className="text-gray-500">Statut :</span><span className="ml-1 font-medium">{po.status}</span></div>
            <div><span className="text-gray-500">Fournisseur :</span><span className="ml-1 font-medium">{po.supplier_name || '—'}</span></div>
            <div><span className="text-gray-500">Montant :</span><span className="ml-1 font-medium">{Number(po.total_amount || 0).toLocaleString()} {po.currency}</span></div>
            <div><span className="text-gray-500">Date :</span><span className="ml-1 font-medium">{po.order_date ? new Date(po.order_date).toLocaleDateString('fr-FR') : '—'}</span></div>
          </div>
        )}

        {/* PDF embed */}
        <div className="flex-1 p-4 overflow-auto bg-gray-50 rounded-b-lg">
          {pdfUrl ? (
            <embed key={pdfUrl} src={pdfUrl} type="application/pdf" className="w-full h-full bg-white rounded shadow-inner" style={{ minHeight: '600px' }} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <FileText size={48} />
              <p className="mt-2">Aucun PDF disponible</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderViewer;

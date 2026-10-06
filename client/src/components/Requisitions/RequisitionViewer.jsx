// src/components/Requisitions/RequisitionViewer.jsx
import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Printer, AlertCircle, FileText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import requisitionService from '../../services/requisitionService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t, getLang, getLocale } from '../../i18n';

const RequisitionViewer = ({ requisitionId, requisition, onClose }) => {
  const { currency } = useCurrency();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lang, setLang] = useState(getLang()); // langue du PDF (par défaut : celle de l'interface)
  const objectRef = useRef(null);
  const hasLoadedRef = useRef(false); // Ref pour suivre si le PDF a déjà été chargé

  // (Re)génère le PDF à l'ouverture et à chaque changement de langue
  useEffect(() => {
    loadPDF();
  }, [requisitionId, lang]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const loadPDF = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const pdfBlob = await requisitionService.generatePDF(requisitionId, lang);
      
      console.log('PDF Blob reçu:', {
        size: pdfBlob.size,
        type: pdfBlob.type,
        isBlob: pdfBlob instanceof Blob
      });
      
      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error(t('pdf.empty'));
      }
      
      const url = URL.createObjectURL(pdfBlob);
      setPdfUrl(url);
    
    } catch (err) {
      console.error('Error loading PDF:', err);
      setError(err.message || t('pdf.loadError'));
      toast.error(t('pdf.loadErrorToast'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const pdfBlob = await requisitionService.generatePDF(requisitionId, lang);
      
      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error(t('reqViewer.pdfEmpty'));
      }
      
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Requisition_${requisition?.requisition_number || 'document'}_${lang.toUpperCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      
      toast.success(t('reqViewer.downloaded'));
    } catch (error) {
      console.error('Download error:', error);
      toast.error(error.message || t('pdf.downloadError'));
    }
  };

  const handlePrint = () => {
    if (pdfUrl) {
      const printWindow = window.open(pdfUrl, '_blank');
      if (printWindow) {
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.print();
          }, 1000);
        };
      } else {
        toast.error(t('pdf.printError'));
      }
    }
  };

  const handleRetry = () => {
    // Réinitialiser le ref pour permettre un nouveau chargement
    hasLoadedRef.current = false;
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
    loadPDF();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 flex flex-col items-center min-w-[320px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">{t('reqViewer.generating')}</p>
          <p className="text-sm text-gray-400 mt-1">{t('reqViewer.pleaseWait')}</p>
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
            <h3 className="text-lg font-semibold">{t('common.error')}</h3>
          </div>
          <p className="text-gray-600">{error}</p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              {t('common.close')}
            </button>
            <button
              onClick={handleRetry}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} />
              {t('common.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Barre d'outils */}
        <div className="bg-gray-100 rounded-t-lg px-4 py-3 flex items-center justify-between border-b flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
            <div className="h-6 w-px bg-gray-300" />
            <FileText size={20} className="text-blue-600" />
            <div>
              <span className="font-medium text-gray-800">
                {requisition?.requisition_number || t('common.requisition')}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Langue du document */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm" role="group" aria-label={t('reqViewer.pdfLanguage')}>
              {[['fr', 'FR'], ['en', 'EN']].map(([code, label]) => (
                <button key={code} type="button" onClick={() => setLang(code)} aria-pressed={lang === code}
                  className={`px-3 py-1.5 ${lang === code ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Download size={16} />
              {t('common.download')}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
            >
              <Printer size={16} />
              {t('common.print')}
            </button>
          </div>
        </div>
        
        {/* Informations de la réquisition */}
        {requisition && (
          <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-gray-500">{t('reqViewer.status')}</span>
              <span className="ml-1 font-medium">{requisition.status ? requisitionService.getStatusOptionLabel(requisition.status) : '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('reqViewer.amount')}</span>
              <span className="ml-1 font-medium">
                {requisition.estimated_amount?.toLocaleString(getLocale())} {requisition.currency || currency.code}
              </span>
            </div>
            <div>
              <span className="text-gray-500">{t('reqViewer.department')}</span>
              <span className="ml-1 font-medium">{requisition.department_name || '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('reqViewer.requester')}</span>
              <span className="ml-1 font-medium">{requisition.first_name} {requisition.last_name}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('reqViewer.date')}</span>
              <span className="ml-1 font-medium">
                {requisition.created_at ? new Date(requisition.created_at).toLocaleDateString(getLocale()) : '-'}
              </span>
            </div>
          </div>
        )}
        
        {/* Zone d'affichage du PDF avec embed */}
        <div className="flex-1 p-4 overflow-auto bg-gray-50 rounded-b-lg">
          {pdfUrl ? (
            <iframe
              key={pdfUrl} // Utiliser pdfUrl comme key pour forcer le re-render
              src={pdfUrl}
              title={t('reqViewer.pdfTitle')}
              className="w-full h-full bg-white rounded shadow-inner"
              style={{ minHeight: '600px' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <FileText size={48} />
              <p className="mt-2">{t('reqViewer.noPdf')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RequisitionViewer;
// src/components/Common/PdfViewer.jsx - Version simple sans plein écran
import React, { useState, useEffect } from 'react';
import { X, Download, Printer, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadService } from '../../services/uploadService';

const PdfViewer = ({ attachmentId, fileName, onClose }) => {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        const blob = await uploadService.downloadFile(attachmentId);
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('Impossible de charger le PDF');
        toast.error('Erreur de chargement du PDF');
      } finally {
        setLoading(false);
      }
    };
    
    if (attachmentId) {
      loadPdf();
    }
    
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [attachmentId]);

  const handleDownload = async () => {
    try {
      const response = await fetch(`/api/upload/download/${attachmentId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName || 'document.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Téléchargement démarré');
    } catch (error) {
      toast.error('Erreur lors du téléchargement');
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 flex flex-col items-center min-w-[280px]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          <p className="mt-3 text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-2 text-red-600 mb-3">
            <AlertCircle size={20} />
            <h3 className="font-semibold">Erreur</h3>
          </div>
          <p className="text-gray-600 text-sm">{error}</p>
          <button
            onClick={onClose}
            className="mt-4 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm w-full"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* Barre d'outils */}
        <div className="bg-gray-100 rounded-t-lg px-4 py-2 flex items-center justify-between border-b">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
              title="Fermer"
            >
              <X size={18} />
            </button>
            <div className="h-4 w-px bg-gray-300" />
            
          </div>
          
          <div className="text-sm text-gray-500 truncate max-w-md">
            {fileName || 'Document PDF'}
          </div>
          
          {/* Espace vide pour équilibrer */}
          <div className="w-16" />
        </div>
        
        {/* Zone d'affichage du PDF */}
        <div className="flex-1 p-4 overflow-auto bg-gray-50 rounded-b-lg">
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              className="w-full h-full bg-white rounded shadow-inner"
              title="PDF Viewer"
              style={{ minHeight: '600px' }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfViewer;
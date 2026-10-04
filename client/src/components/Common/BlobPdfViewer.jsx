// src/components/Common/BlobPdfViewer.jsx
// Aperçu PDF générique (endpoint authentifié → blob → <iframe>).
// <iframe> et non <embed> : la CSP de production (object-src 'none') bloque <embed>.
import React, { useState, useEffect } from 'react';
import { X, Download, Printer, AlertCircle, FileText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BlobPdfViewer({ title, fetchPdf, fileName, infoBar, onClose }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await fetchPdf();
      if (!blob || blob.size === 0) throw new Error('Le PDF généré est vide');
      setPdfUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err.message || 'Impossible de charger le PDF');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const download = () => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = fileName;
    a.click();
    toast.success('PDF téléchargé');
  };

  const print = () => {
    const win = window.open(pdfUrl, '_blank');
    if (win) win.onload = () => setTimeout(() => win.print(), 800);
    else toast.error("Impossible d'ouvrir la fenêtre d'impression");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[90vh] flex flex-col">
        <div className="bg-gray-100 rounded-t-lg px-4 py-3 flex items-center justify-between border-b flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg" aria-label="Fermer">
              <X size={20} />
            </button>
            <div className="h-6 w-px bg-gray-300" />
            <FileText size={20} className="text-green-600" />
            <span className="font-medium text-gray-800">{title}</span>
          </div>
          {pdfUrl && (
            <div className="flex items-center gap-2">
              <button onClick={download} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                <Download size={16} /> Télécharger
              </button>
              <button onClick={print} className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm">
                <Printer size={16} /> Imprimer
              </button>
            </div>
          )}
        </div>

        {infoBar && <div className="bg-green-50 px-4 py-2 border-b border-green-100 flex flex-wrap gap-4 text-sm">{infoBar}</div>}

        <div className="flex-1 p-4 bg-gray-50 rounded-b-lg flex">
          {loading ? (
            <div className="m-auto flex flex-col items-center text-gray-500">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
              <p className="mt-3">Génération du PDF…</p>
            </div>
          ) : error ? (
            <div className="m-auto text-center">
              <AlertCircle size={32} className="text-red-500 mx-auto" />
              <p className="mt-2 text-gray-600">{error}</p>
              <button onClick={load} className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg">
                <RefreshCw size={16} /> Réessayer
              </button>
            </div>
          ) : (
            <iframe key={pdfUrl} src={pdfUrl} title={`${title} PDF`} className="w-full flex-1 bg-white rounded shadow-inner" />
          )}
        </div>
      </div>
    </div>
  );
}

// src/components/Requisitions/ImportItemsModal.jsx
// Import des articles depuis un fichier Excel (.xlsx) ou CSV : fichier → aperçu → ajout au formulaire.
// Pas de ligne budgétaire dans le fichier : elle s'assigne ensuite dans le formulaire (sélection multiple).
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import requisitionService from '../../services/requisitionService';

// Modèle généré dans le navigateur : CSV « ; » + BOM UTF-8 → s'ouvre directement dans Excel (accents corrects)
const TEMPLATE_ROWS = [
  ['Description', 'Quantité', 'Fréquence', 'Prix unitaire'],
  ['Ordinateur portable 15"', '2', '1', '950'],
  ['Ramette papier A4', '10', '1', '6,5'],
];

function downloadTemplate() {
  const csv = TEMPLATE_ROWS
    .map(row => row.map(v => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modele_articles_requisition.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportItemsModal({ isOpen, onClose, onImport, formatCurrency }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { items, errors }
  const [loading, setLoading] = useState(false);
  const [replace, setReplace] = useState(false);

  const reset = () => { setFile(null); setPreview(null); setReplace(false); };
  const close = () => { reset(); onClose(); };

  const analyze = async (f) => {
    setFile(f);
    setPreview(null);
    if (!f) return;
    setLoading(true);
    try {
      const res = await requisitionService.importItems(f);
      setPreview(res.data);
    } catch (_) {
      // toast via intercepteur
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    if (!preview?.items.length) return;
    onImport(preview.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      frequency: i.frequency,
      unitPrice: i.unitPrice,
      budgetLineId: '',
      budgetLineInfo: null,
    })), { replace });
    toast.success(`${preview.items.length} article(s) importé(s) — assignez maintenant la ligne budgétaire`);
    close();
  };

  const total = (preview?.items || []).reduce((s, i) => s + i.quantity * i.frequency * i.unitPrice, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Importer des articles (Excel / CSV)"
      size="xl"
      onConfirm={confirm}
      confirmText={preview?.items.length ? `Ajouter ${preview.items.length} article(s)` : 'Ajouter'}
      confirmDisabled={!preview?.items.length}
      isLoading={loading}
      loadingText="Analyse du fichier…"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 border-2 border-dashed border-blue-300 rounded-lg text-sm text-blue-700 cursor-pointer hover:bg-blue-50">
            <Upload size={16} />
            {file ? file.name : 'Choisir un fichier .xlsx ou .csv'}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              data-testid="import-file"
              onChange={(e) => { analyze(e.target.files?.[0] || null); e.target.value = ''; }}
            />
          </label>
          <button type="button" onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
            <Download size={16} /> Télécharger le modèle
          </button>
        </div>

        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
          <div className="font-medium text-gray-700 mb-1">Format attendu (1re ligne = en-têtes) — le modèle s'ouvre dans Excel :</div>
          <table className="w-full">
            <tbody>
              <tr><td className="pr-3 font-semibold">Description</td><td className="pr-3">obligatoire</td><td>libellé de l'article</td></tr>
              <tr><td className="pr-3 font-semibold">Quantité</td><td className="pr-3">obligatoire</td><td>nombre &gt; 0</td></tr>
              <tr><td className="pr-3 font-semibold">Fréquence</td><td className="pr-3">facultatif</td><td>x/mois, 1 par défaut</td></tr>
              <tr><td className="pr-3 font-semibold">Prix unitaire</td><td className="pr-3">obligatoire</td><td>décimales avec , ou .</td></tr>
            </tbody>
          </table>
          <p className="mt-2">Enregistrez au format <b>.xlsx</b> ou <b>.csv</b>. La ligne budgétaire s'assigne après l'import : cochez les articles puis « Assigner une ligne budgétaire ».</p>
        </div>

        {preview && (
          <>
            {preview.errors.length > 0 && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertTriangle size={16} /> {preview.errors.length} ligne(s) ignorée(s)
                </div>
                <ul className="list-disc pl-6 max-h-24 overflow-y-auto">
                  {preview.errors.map(e => <li key={e.line}>Ligne {e.line} : {e.message}</li>)}
                </ul>
              </div>
            )}

            {preview.items.length > 0 ? (
              <>
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle size={16} /> {preview.items.length} article(s) prêt(s) — total estimé {formatCurrency(total)}
                </div>
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full text-sm" data-testid="import-preview">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs text-gray-500">Ligne</th>
                        <th className="px-2 py-2 text-left text-xs text-gray-500">Description</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">Qté</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">Fréq.</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">Prix unit.</th>
                        <th className="px-2 py-2 text-right text-xs text-gray-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.items.map(i => (
                        <tr key={i.line}>
                          <td className="px-2 py-1 text-gray-400">{i.line}</td>
                          <td className="px-2 py-1">{i.description}</td>
                          <td className="px-2 py-1 text-right">{i.quantity}</td>
                          <td className="px-2 py-1 text-right">{i.frequency}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(i.unitPrice)}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(i.quantity * i.frequency * i.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
                  Remplacer les articles déjà saisis (sinon ils sont conservés)
                </label>
              </>
            ) : (
              <p className="text-sm text-gray-500 flex items-center gap-2"><FileSpreadsheet size={16} /> Aucun article valide dans ce fichier.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// Champ d'un document de préqualification : fichier choisi, document déjà déposé (consultable), remplacement
import React from 'react';
import toast from 'react-hot-toast';
import { FileText, Upload, Eye, CheckCircle, AlertCircle } from 'lucide-react';
import { DOC_LABELS, docAccept, checkDocFile } from '../../../utils/supplierDocs';
import { t } from '../../../i18n';

export default function DocumentField({ type, required, file, existing, onFile, onView, error }) {
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const problem = checkDocFile(type, f);
    if (problem) return toast.error(problem);
    onFile(type, f);
  };

  return (
    <div className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 ${error ? 'border-red-500' : 'border-gray-200'}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
          <FileText size={14} className="text-gray-400" />
          {DOC_LABELS[type]}{required && <span className="text-red-500">*</span>}
        </p>
        <p className="text-xs truncate">
          {file
            ? <span className="text-blue-700">{t('prequal.toSend', { name: file.name })}</span>
            : existing
              ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle size={12} />{existing.file_name}</span>
              : <span className={`inline-flex items-center gap-1 ${required ? 'text-orange-600' : 'text-gray-400'}`}>
                  {required && <AlertCircle size={12} />}{t('prequal.noFile')}
                </span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {existing && onView && !file && (
          <button type="button" onClick={() => onView(existing)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title={t('prequal.consult')}>
            <Eye size={16} />
          </button>
        )}
        <label className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs cursor-pointer hover:bg-gray-50">
          <Upload size={14} /> {existing || file ? t('prequal.replace') : t('prequal.choose')}
          <input type="file" accept={docAccept(type)} className="hidden" onChange={pick} data-testid={`doc-${type}`} />
        </label>
      </div>
    </div>
  );
}

// src/components/Common/WorkflowOnlyPage.jsx
// Formulaire ouvert sans son document parent (réception / SAN / facture sans bon de commande, paiement sans facture) :
// ces documents se créent UNIQUEMENT depuis l'onglet tâches de la réquisition, pour rester rattachés à la bonne
// réquisition et au bon bon de commande. Affiche une explication et les liens utiles, jamais un formulaire orphelin.
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, CheckSquare, ShoppingCart } from 'lucide-react';
import { t } from '../../i18n';

/**
 * @param {string} title  titre du formulaire
 * @param {Function} icon icône lucide du document
 * @param {string} doc    grn | san | invoice | payment
 */
export default function WorkflowOnlyPage({ title, icon: Icon, doc }) {
  const navigate = useNavigate();
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>
      <div className="flex items-center gap-3 mb-6">
        {Icon && <Icon size={28} className="text-blue-600" />}
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900" data-testid="workflow-only">
        <p className="flex items-start gap-2 font-medium">
          <Info size={18} className="mt-0.5 shrink-0" /> {t(`workflowOnly.${doc}`)}
        </p>
        <p className="mt-2 text-blue-800">{t('workflowOnly.how')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/tasks" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
            <CheckSquare size={16} /> {t('nav.myTasks')}
          </Link>
          <Link to="/requisitions" className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-blue-700 hover:bg-blue-50">
            <ShoppingCart size={16} /> {t('nav.requisitions')}
          </Link>
        </div>
      </div>
    </div>
  );
}

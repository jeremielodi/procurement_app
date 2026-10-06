// src/components/Enterprises/EnterpriseSettings.jsx — administrateur d'entreprise : « Mon entreprise »
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import EnterpriseInfoForm from './EnterpriseInfoForm';
import { enterpriseService } from '../../services/enterpriseService';
import { useEnterprise } from '../../contexts/EnterpriseContext';
import { t } from '../../i18n';

export default function EnterpriseSettings() {
  const { enterprise, refreshEnterprise } = useEnterprise();
  const [saving, setSaving] = useState(false);

  const save = async (form, logo) => {
    setSaving(true);
    try {
      await enterpriseService.updateCurrent(form, logo);
      await refreshEnterprise();
      toast.success(t('enterprises.settingsUpdated'));
    } catch (_) { /* toast via intercepteur */ } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('nav.myCompany')}</h1>
        <p className="text-gray-500 text-sm">{t('enterprises.settingsHint')}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {enterprise
          ? <EnterpriseInfoForm enterprise={enterprise} submitting={saving} onSubmit={save} />
          : <p className="text-gray-500 text-sm">{t('common.loading')}</p>}
      </div>
    </div>
  );
}

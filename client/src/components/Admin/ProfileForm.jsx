// src/components/Admin/ProfileForm.jsx
import React, { useState, useEffect } from 'react';
import { profileService } from '../../services/profileService';
import toast from 'react-hot-toast';
import { t } from '../../i18n';

export default function ProfileForm({ profile, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || '',
        description: profile.description || ''
      });
    }
  }, [profile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (profile) {
        await profileService.update(profile.id, formData);
        toast.success(t('profiles.updated'));
      } else {
        await profileService.create(formData);
        toast.success(t('profiles.created'));
      }
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">{t('profiles.name')}</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          required
          placeholder={t('profiles.namePlaceholder')}
          disabled={profile?.id === 'prof_admin'}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows="3"
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          placeholder={t('profiles.descriptionPlaceholder')}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? t('supplierForm.saving') : (profile ? t('supplierForm.update') : t('common.create'))}
        </button>
      </div>
    </form>
  );
}
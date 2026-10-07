// src/components/Enterprises/EnterpriseDetail.jsx — super admin : fiche d'une entreprise
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, UserPlus, PauseCircle, PlayCircle, Trash2, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import EnterpriseInfoForm from './EnterpriseInfoForm';
import { enterpriseService } from '../../services/enterpriseService';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';
import { t, LANGUAGES } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function EnterpriseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [adminForm, setAdminForm] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'suspend' | 'delete'

  const { data, isLoading, refetch } = useQuery({ queryKey: ['enterprise', id], queryFn: () => enterpriseService.getById(id) });
  const e = data?.data;

  if (isLoading) return <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!e) return <div className="p-6 text-gray-500">{t('enterprises.notFound')}</div>;

  const reload = () => { refetch(); queryClient.invalidateQueries(['enterprises']); };

  const save = async (form, logo) => {
    setSaving(true);
    try {
      await enterpriseService.update(id, form, logo);
      toast.success(t('enterprises.updated'));
      reload();
    } catch (_) { /* toast */ } finally { setSaving(false); }
  };

  const addAdmin = async () => {
    if ((adminForm.password || '').length < 8) return toast.error(t('enterprises.passwordMin'));
    setSaving(true);
    try {
      await enterpriseService.addAdmin(id, adminForm);
      toast.success(t('enterprises.adminCreated', { email: adminForm.email }));
      setAdminForm(null);
      reload();
    } catch (_) { /* toast */ } finally { setSaving(false); }
  };

  const doConfirm = async () => {
    setSaving(true);
    try {
      if (confirm === 'delete') {
        await enterpriseService.delete(id);
        toast.success(t('enterprises.deleted'));
        queryClient.invalidateQueries(['enterprises']);
        navigate('/admin/enterprises');
        return;
      }
      await enterpriseService.setActive(id, !e.is_active);
      toast.success(e.is_active ? t('enterprises.suspended') : t('enterprises.reactivated'));
      setConfirm(null);
      reload();
    } catch (_) { /* toast */ } finally { setSaving(false); }
  };

  const logo = enterpriseLogoUrl(e);
  const empty = e.user_count === 0 && e.requisition_count === 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/enterprises')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div className="w-12 h-12 rounded border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
            {logo ? <img src={logo} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 size={22} className="text-gray-300" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              {e.name}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{e.is_active ? t('enterprises.active') : t('enterprises.suspendedOne')}</span>
            </h1>
            <p className="text-sm text-gray-500 font-mono">{t('enterprises.counts', { code: e.code, users: e.user_count, requisitions: e.requisition_count })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setConfirm('suspend')}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm ${e.is_active ? 'border-yellow-400 text-yellow-800 hover:bg-yellow-50' : 'border-green-400 text-green-700 hover:bg-green-50'}`}>
            {e.is_active ? <><PauseCircle size={16} /> {t('enterprises.suspend')}</> : <><PlayCircle size={16} /> {t('enterprises.reactivate')}</>}
          </button>
          <button onClick={() => setConfirm('delete')} disabled={!empty}
            title={empty ? '' : t('enterprises.cannotDelete')}
            className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Trash2 size={16} /> {t('common.delete')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-4">{t('enterprises.info')}</h2>
          <EnterpriseInfoForm enterprise={e} canEditCode submitting={saving} onSubmit={save} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 h-fit">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2"><ShieldCheck size={18} /> {t('enterprises.admins')}</h2>
            <button onClick={() => setAdminForm({ email: '', password: '', firstName: '', lastName: '', language: LANGUAGES[0].code })}
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"><UserPlus size={14} /> {t('common.add')}</button>
          </div>
          {(e.admins || []).length === 0 ? (
            <p className="text-sm text-orange-600">{t('enterprises.noAdmin')}</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {e.admins.map(a => (
                <li key={a.id} className="py-2">
                  <div className="font-medium text-gray-800">{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email}</div>
                  <div className="text-xs text-gray-500">{a.email}{!a.is_active && t('enterprises.inactiveSuffix')}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal isOpen={!!adminForm} onClose={() => setAdminForm(null)} title={t('enterprises.newAdminTitle', { name: e.name })}
        onConfirm={addAdmin} confirmText={t('enterprises.createAdmin')} isLoading={saving}>
        {adminForm && (
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} placeholder={t('enterprises.firstName')} value={adminForm.firstName} onChange={ev => setAdminForm(f => ({ ...f, firstName: ev.target.value }))} />
            <input className={inputCls} placeholder={t('enterprises.lastName')} value={adminForm.lastName} onChange={ev => setAdminForm(f => ({ ...f, lastName: ev.target.value }))} />
            <input className={`${inputCls} col-span-2`} type="email" placeholder={t('enterprises.loginEmail')} value={adminForm.email} onChange={ev => setAdminForm(f => ({ ...f, email: ev.target.value }))} />
            <input className={`${inputCls} col-span-2`} type="password" placeholder={t('enterprises.password')} value={adminForm.password} onChange={ev => setAdminForm(f => ({ ...f, password: ev.target.value }))} />
            <label className="col-span-2 text-sm text-gray-600">{t('users.language')}
              <SearchSelect className={`${inputCls} mt-1`} value={adminForm.language} onChange={ev => setAdminForm(f => ({ ...f, language: ev.target.value }))}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </SearchSelect>
            </label>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} type={confirm === 'delete' ? 'danger' : 'warning'} isLoading={saving}
        title={confirm === 'delete' ? t('enterprises.deleteTitle') : e.is_active ? t('enterprises.suspendTitle') : t('enterprises.reactivateTitle')}
        onConfirm={doConfirm}>
        <p className="text-sm text-gray-700">
          {confirm === 'delete'
            ? t('enterprises.deleteMsg', { name: e.name })
            : e.is_active
              ? t('enterprises.suspendMsg', { name: e.name })
              : t('enterprises.reactivateMsg', { name: e.name })}
        </p>
      </Modal>
    </div>
  );
}

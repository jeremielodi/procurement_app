// src/components/Landing/ContactForm.jsx
// Formulaire de contact du site vitrine → POST /api/public/contact (email envoyé à Digitales Solutions)
import React, { useState } from 'react';
import { Send, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { t } from '../../i18n';

const EMPTY = { name: '', email: '', company: '', phone: '', message: '', website: '' };
const MAX = { name: 100, email: 255, company: 150, phone: 40, message: 5000 };

function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = t('landing.contact.form.required');
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = t('landing.contact.form.emailInvalid');
  if (f.message.trim().length < 10) e.message = t('landing.contact.form.messageTooShort');
  return e;
}

// Codes d'erreur renvoyés par le backend → messages traduits
const serverError = (code) => ({
  required: t('landing.contact.form.required'),
  invalid: t('landing.contact.form.emailInvalid'),
  tooShort: t('landing.contact.form.messageTooShort'),
  tooLong: t('landing.contact.form.tooLong'),
}[code] || code);

export default function ContactForm() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const [globalError, setGlobalError] = useState('');

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setErrors({ ...errors, [k]: undefined });
    setGlobalError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setStatus('sending');
    try {
      await api.post('/public/contact', form);
      setStatus('sent');
      setForm(EMPTY);
    } catch (err) {
      setStatus('idle');
      const data = err.response?.data;
      if (err.response?.status === 400 && data?.errors) {
        setErrors(Object.fromEntries(Object.entries(data.errors).map(([k, c]) => [k, serverError(c)])));
      } else {
        setGlobalError(err.response?.status === 429 ? t('landing.contact.form.tooMany') : t('landing.contact.form.error'));
      }
    }
  };

  if (status === 'sent') {
    return (
      <div className="mt-10 rounded-xl bg-white border border-green-200 p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
        <p className="mt-3 text-slate-700">{t('landing.contact.form.sent')}</p>
        <button onClick={() => setStatus('idle')} className="mt-5 text-sm font-medium text-blue-700 hover:underline">
          {t('landing.contact.form.another')}
        </button>
      </div>
    );
  }

  const input = (k, label, { type = 'text', optional = false, autoComplete } = {}) => (
    <div>
      <label htmlFor={`contact-${k}`} className="block text-sm font-medium text-slate-700 mb-1">
        {label}{optional && <span className="text-slate-400 font-normal"> ({t('landing.contact.form.optional')})</span>}
      </label>
      <input
        id={`contact-${k}`}
        type={type}
        value={form[k]}
        onChange={set(k)}
        maxLength={MAX[k]}
        autoComplete={autoComplete}
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors[k] ? 'border-red-500' : 'border-slate-300'}`}
      />
      {errors[k] && <p className="mt-1 text-sm text-red-600">{errors[k]}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-10 rounded-xl bg-white border border-slate-200 p-6 sm:p-8 text-left space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        {input('name', t('landing.contact.form.name'), { autoComplete: 'name' })}
        {input('email', t('landing.contact.form.email'), { type: 'email', autoComplete: 'email' })}
        {input('company', t('landing.contact.form.company'), { optional: true, autoComplete: 'organization' })}
        {input('phone', t('landing.contact.form.phone'), { type: 'tel', optional: true, autoComplete: 'tel' })}
      </div>
      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 mb-1">{t('landing.contact.form.message')}</label>
        <textarea
          id="contact-message"
          rows={5}
          value={form.message}
          onChange={set('message')}
          maxLength={MAX.message}
          placeholder={t('landing.contact.form.messagePlaceholder')}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.message ? 'border-red-500' : 'border-slate-300'}`}
        />
        {errors.message && <p className="mt-1 text-sm text-red-600">{errors.message}</p>}
      </div>
      {/* Champ piège anti-robot : invisible pour un visiteur */}
      <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off"
        aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }} />

      {globalError && (
        <p className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {globalError}
        </p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {status === 'sending'
          ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          : <Send className="w-4 h-4" />}
        {status === 'sending' ? t('landing.contact.form.sending') : t('landing.contact.form.submit')}
      </button>
    </form>
  );
}

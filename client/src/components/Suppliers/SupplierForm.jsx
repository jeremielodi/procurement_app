// src/components/Suppliers/SupplierForm.jsx
import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save,
  X,
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  Globe,
  User,
  Briefcase,
  FileText,
  Shield,
  Award,
  Star,
  Upload,
  Trash2,
  Plus,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import { supplierService } from '../../services/supplierService'
import { locationService, categoryService } from '../../services/referenceService'
import { SUPPLIER_TYPE_LABELS } from '../../utils/supplierDocs'
import MultiCheckList from './prequal/MultiCheckList'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { validateEmail, validatePhone } from '../../utils/validators'
import toast from 'react-hot-toast'
import { t, useTranslation } from '../../i18n'
import SearchSelect from '../Common/SearchSelect'

export default function SupplierForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    supplier_type: 'COMPANY',
    id_nat: '',
    id_document_number: '',
    name: '',
    registration_number: '',
    tax_id: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    status: 'ACTIVE',
    prequalified: false,
    payment_terms: '',
    delivery_terms: '',
    bank_name: '',
    bank_account: '',
    bank_iban: '',
    bank_swift: '',
    notes: ''
  })

  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [documents, setDocuments] = useState([])
  // Localisations desservies et catégories de marché (référentiels de la plateforme)
  const [locationIds, setLocationIds] = useState([])
  const [categoryIds, setCategoryIds] = useState([])
  const [refs, setRefs] = useState({ locations: [], categories: [] })
  const { lang } = useTranslation()
  useEffect(() => {
    Promise.all([locationService.list(), categoryService.list()])
      .then(([l, c]) => setRefs({ locations: l.data || [], categories: c.data || [] }))
      .catch(() => {})
  }, [lang])
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Récupérer les données du fournisseur en mode édition
  const { data: supplierData, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: isEditMode && !!id
  })

  const isSelfRegistered = isEditMode && !!supplierData?.data?.self_registered

  // Mutation pour créer un fournisseur
  const createMutation = useMutation({
    mutationFn: (data) => supplierService.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['suppliers'])
      toast.success(t('supplierForm.created'))
      navigate(`/suppliers/${response.data.id}`)
    },
    onError: (error) => {
      toast.error(error.message || t('po.createError'))
      setIsSubmitting(false)
    }
  })

  // Mutation pour mettre à jour un fournisseur
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => supplierService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['suppliers'])
      queryClient.invalidateQueries(['supplier', id])
      toast.success(t('supplierForm.updated'))
      navigate(`/suppliers/${id}`)
    },
    onError: (error) => {
      toast.error(error.message || t('profile.updateError'))
      setIsSubmitting(false)
    }
  })

  // Mutation pour uploader des documents
  const uploadMutation = useMutation({
    mutationFn: (files) => supplierService.uploadDocuments(id, files),
    onSuccess: () => {
      queryClient.invalidateQueries(['supplier', id])
      toast.success(t('supplierForm.docsUploaded'))
    },
    onError: (error) => {
      toast.error(error.message || t('upload.uploadError'))
    }
  })

  useEffect(() => {
    if (isEditMode && supplierData?.data) {
      const supplier = supplierData.data
      setLocationIds((supplier.locations || []).map(l => l.id))
      setCategoryIds((supplier.categories || []).map(c => c.id))
      setFormData({
        supplier_type: supplier.supplier_type || 'COMPANY',
        id_nat: supplier.id_nat || '',
        id_document_number: supplier.id_document_number || '',
        name: supplier.name || '',
        registration_number: supplier.registration_number || '',
        tax_id: supplier.tax_id || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        address: supplier.address || '',
        website: supplier.website || '',
        status: supplier.status || 'ACTIVE',
        prequalified: supplier.prequalified || false,
        payment_terms: supplier.payment_terms || '',
        delivery_terms: supplier.delivery_terms || '',
        bank_name: supplier.bank_name || '',
        bank_account: supplier.bank_account || '',
        bank_iban: supplier.bank_iban || '',
        bank_swift: supplier.bank_swift || '',
        notes: supplier.notes || ''
      })
      if (supplier.documents) {
        setDocuments(supplier.documents)
      }
    }
  }, [isEditMode, supplierData])

  const validateForm = () => {
    const newErrors = {}

    if (!formData.name.trim()) {
      newErrors.name = t('supplierForm.nameRequired')
    }

    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = t('auth.emailInvalid')
    }

    if (formData.phone && !validatePhone(formData.phone)) {
      newErrors.phone = t('supplierForm.phoneInvalid')
    }

    if (formData.website && !formData.website.match(/^https?:\/\/.+/)) {
      newErrors.website = t('supplierForm.urlInvalid')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
    // Effacer l'erreur du champ
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleBlur = (e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
  }

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    if (isEditMode) {
      await uploadMutation.mutateAsync(files)
    } else {
      // Stocker temporairement les fichiers pour upload après création
      setDocuments(prev => [...prev, ...files.map(f => ({
        file: f,
        name: f.name,
        size: f.size,
        type: f.type,
        temporary: true
      }))])
      toast.success(t('supplierForm.filesAdded', { count: files.length }))
    }
  }

  const handleRemoveDocument = (index) => {
    setDocuments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) {
      // Scroll vers le premier champ en erreur
      const firstError = Object.keys(errors)[0]
      const element = document.querySelector(`[name="${firstError}"]`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.focus()
      }
      return
    }

    setIsSubmitting(true)

    try {
      const data = { ...formData, locationIds, categoryIds }
      if (isEditMode) {
        await updateMutation.mutateAsync({ id, data })
      } else {
        // Documents de préqualification : déposés ensuite depuis l'onglet « Préqualification » de la fiche
        await createMutation.mutateAsync(data)
      }
    } catch (error) {
      console.error('Submit error:', error)
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (Object.values(formData).some(v => v) || documents.length > 0) {
      setShowCancelModal(true)
    } else {
      navigate('/suppliers')
    }
  }

  if (isEditMode && isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text={t('supplierDetail.loading')} />
      </div>
    )
  }

  if (isEditMode && error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title={t('requisitions.loadError')}
          message={t('supplierForm.loadErrorMsg')}
          details={error.message}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleCancel}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {isEditMode ? t('supplierForm.editTitle') : t('supplierForm.newTitle')}
            </h1>
            <p className="text-gray-500 mt-1">
              {isEditMode ? t('supplierForm.editSubtitle') : t('supplierForm.newSubtitle')}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informations générales */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Building2 size={20} />
              {t('supplierForm.generalInfo')}
            </h2>
          </div>
          <div className="p-6">
            {isSelfRegistered && (
              <p className="mb-4 text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {t('supplierForm.selfRegistered')}
              </p>
            )}
            <div className="flex gap-2 mb-6">
              {Object.entries(SUPPLIER_TYPE_LABELS).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setFormData(f => ({ ...f, supplier_type: v }))}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${formData.supplier_type === v ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.supplier_type === 'INDIVIDUAL' ? t('supplierForm.fullNameRequired') : t('supplierForm.companyNameRequired')}
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    touched.name && errors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder={t('supplierForm.namePlaceholder')}
                />
                {touched.name && errors.name && (
                  <p className="mt-1 text-sm text-red-500">{errors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierFields.registrationNumber')}
                </label>
                <input
                  type="text"
                  name="registration_number"
                  value={formData.registration_number}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('supplierForm.rccmPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierFields.idNat')}</label>
                <input type="text" name="id_nat" value={formData.id_nat} onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierFields.idDocumentNumber')}</label>
                <input type="text" name="id_document_number" value={formData.id_document_number} onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierFields.taxId')}
                </label>
                <input
                  type="text"
                  name="tax_id"
                  value={formData.tax_id}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('supplierForm.taxPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierFields.website')}
                </label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    touched.website && errors.website ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder={t('supplierForm.websitePlaceholder')}
                />
                {touched.website && errors.website && (
                  <p className="mt-1 text-sm text-red-500">{errors.website}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Mail size={20} />
              {t('supplierForm.contact')}
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.email')}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      touched.email && errors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder={t('supplierForm.emailPlaceholder')}
                  />
                </div>
                {touched.email && errors.email && (
                  <p className="mt-1 text-sm text-red-500">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.phone')}
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      touched.phone && errors.phone ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="+33 1 23 45 67 89"
                  />
                </div>
                {touched.phone && errors.phone && (
                  <p className="mt-1 text-sm text-red-500">{errors.phone}</p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.address')}
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                  <textarea
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    rows="3"
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('supplierForm.addressPlaceholder')}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Informations bancaires */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Briefcase size={20} />
              {t('supplierForm.bankInfo')}
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierForm.bankName')}
                </label>
                <input
                  type="text"
                  name="bank_name"
                  value={formData.bank_name}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder={t('supplierForm.bankName')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierFields.bankAccount')}
                </label>
                <input
                  type="text"
                  name="bank_account"
                  value={formData.bank_account}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder={t('supplierForm.accountPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IBAN
                </label>
                <input
                  type="text"
                  name="bank_iban"
                  value={formData.bank_iban}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="IBAN"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierForm.swift')}
                </label>
                <input
                  type="text"
                  name="bank_swift"
                  value={formData.bank_swift}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="SWIFT/BIC"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Conditions commerciales */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <FileText size={20} />
              {t('supplierForm.commercialTerms')}
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierForm.paymentTerms')}
                </label>
                <SearchSelect
                  name="payment_terms"
                  value={formData.payment_terms}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('common.select')}</option>
                  {['NET_15', 'NET_30', 'NET_45', 'NET_60', 'COD', 'PREPAID'].map(v => <option key={v} value={v}>{t(`supplierForm.terms.${v}`)}</option>)}
                </SearchSelect>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('supplierForm.deliveryTerms')}
                </label>
                <SearchSelect
                  name="delivery_terms"
                  value={formData.delivery_terms}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('common.select')}</option>
                  {['EXW', 'FOB', 'CIF', 'DDP'].map(v => <option key={v} value={v}>{t(`supplierForm.incoterms.${v}`)}</option>)}
                </SearchSelect>
              </div>
            </div>
          </div>
        </div>

        {/* Statut */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Shield size={20} />
              {t('common.status')}
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.status')}
                </label>
                <SearchSelect
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ACTIVE">{t('common.active')}</option>
                  <option value="INACTIVE">{t('common.inactive')}</option>
                </SearchSelect>
              </div>

              <p className="text-sm text-gray-500 self-center">
                {t('supplierForm.prequalHint')}
              </p>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <FileText size={20} />
              {t('supplierForm.internalNotes')}
            </h2>
          </div>
          <div className="p-6">
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="4"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={t('supplierForm.notesPlaceholder')}
            />
          </div>
        </div>

        {/* Localisations et catégories */}
        {!isSelfRegistered && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <MapPin size={20} />
                {t('supplierForm.locationsCategories')}
              </h2>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">{t('supplierForm.locationsServed')}</p>
                <MultiCheckList options={refs.locations} value={locationIds} onChange={setLocationIds} columns={1} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">{t('supplierForm.categoriesSupplied')}</p>
                <MultiCheckList options={refs.categories} value={categoryIds} onChange={setCategoryIds} columns={1} />
              </div>
              <p className="md:col-span-2 text-xs text-gray-500">
                {t('supplierForm.docsHint')}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <X size={18} />
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save size={18} />
            {isSubmitting ? t('supplierForm.saving') : (isEditMode ? t('supplierForm.update') : t('common.create'))}
          </button>
        </div>
      </form>

      {/* Modal de confirmation d'annulation */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title={t('supplierForm.leaveTitle')}
        type="warning"
        confirmText={t('supplierForm.leave')}
        cancelText={t('supplierForm.keepEditing')}
        onConfirm={() => navigate('/suppliers')}
      >
        <p>{t('supplierForm.unsaved')}</p>
        <p className="text-sm text-gray-500 mt-2">{t('supplierForm.confirmLeave')}</p>
      </Modal>
    </div>
  )
}
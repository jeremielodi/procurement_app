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
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { validateEmail, validatePhone } from '../../utils/validators'
import toast from 'react-hot-toast'

export default function SupplierForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
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
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Récupérer les données du fournisseur en mode édition
  const { data: supplierData, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: isEditMode && !!id
  })

  // Mutation pour créer un fournisseur
  const createMutation = useMutation({
    mutationFn: (data) => supplierService.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['suppliers'])
      toast.success('Fournisseur créé avec succès')
      navigate(`/suppliers/${response.data.id}`)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la création')
      setIsSubmitting(false)
    }
  })

  // Mutation pour mettre à jour un fournisseur
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => supplierService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['suppliers'])
      queryClient.invalidateQueries(['supplier', id])
      toast.success('Fournisseur mis à jour avec succès')
      navigate(`/suppliers/${id}`)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la mise à jour')
      setIsSubmitting(false)
    }
  })

  // Mutation pour uploader des documents
  const uploadMutation = useMutation({
    mutationFn: (files) => supplierService.uploadDocuments(id, files),
    onSuccess: () => {
      queryClient.invalidateQueries(['supplier', id])
      toast.success('Documents uploadés avec succès')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de l\'upload')
    }
  })

  useEffect(() => {
    if (isEditMode && supplierData?.data) {
      const supplier = supplierData.data
      setFormData({
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
      newErrors.name = 'Le nom du fournisseur est requis'
    }

    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = 'Email invalide'
    }

    if (formData.phone && !validatePhone(formData.phone)) {
      newErrors.phone = 'Numéro de téléphone invalide'
    }

    if (formData.website && !formData.website.match(/^https?:\/\/.+/)) {
      newErrors.website = 'URL invalide (doit commencer par http:// ou https://)'
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
      toast.success(`${files.length} fichier(s) ajouté(s) (seront uploadés à la création)`)
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
      if (isEditMode) {
        await updateMutation.mutateAsync({ id, data: formData })
      } else {
        const result = await createMutation.mutateAsync(formData)
        // Upload des documents temporaires si nécessaire
        const tempDocs = documents.filter(d => d.temporary)
        if (tempDocs.length > 0 && result.data?.id) {
          const files = tempDocs.map(d => d.file)
          await supplierService.uploadDocuments(result.data.id, files)
        }
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
        <LoadingSpinner size="lg" text="Chargement du fournisseur..." />
      </div>
    )
  }

  if (isEditMode && error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title="Erreur de chargement"
          message="Impossible de charger les données du fournisseur"
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
              {isEditMode ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
            </h1>
            <p className="text-gray-500 mt-1">
              {isEditMode ? 'Modifiez les informations du fournisseur' : 'Ajoutez un nouveau fournisseur à votre catalogue'}
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
              Informations générales
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom du fournisseur *
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
                  placeholder="Ex: Entreprise SARL"
                />
                {touched.name && errors.name && (
                  <p className="mt-1 text-sm text-red-500">{errors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  N° d'enregistrement
                </label>
                <input
                  type="text"
                  name="registration_number"
                  value={formData.registration_number}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Ex: RC 12345"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  N° TVA
                </label>
                <input
                  type="text"
                  name="tax_id"
                  value={formData.tax_id}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Ex: FR12345678901"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Site web
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
                  placeholder="https://www.exemple.com"
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
              Contact
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
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
                    placeholder="contact@entreprise.com"
                  />
                </div>
                {touched.email && errors.email && (
                  <p className="mt-1 text-sm text-red-500">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Téléphone
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
                  Adresse
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                  <textarea
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    rows="3"
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Adresse complète"
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
              Informations bancaires
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de la banque
                </label>
                <input
                  type="text"
                  name="bank_name"
                  value={formData.bank_name}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Nom de la banque"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  N° de compte
                </label>
                <input
                  type="text"
                  name="bank_account"
                  value={formData.bank_account}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="N° de compte bancaire"
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
                  Code SWIFT/BIC
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
              Conditions commerciales
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Conditions de paiement
                </label>
                <select
                  name="payment_terms"
                  value={formData.payment_terms}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sélectionner...</option>
                  <option value="NET_15">Net 15 jours</option>
                  <option value="NET_30">Net 30 jours</option>
                  <option value="NET_45">Net 45 jours</option>
                  <option value="NET_60">Net 60 jours</option>
                  <option value="COD">Contre remboursement</option>
                  <option value="PREPAID">Prépaiement</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Conditions de livraison
                </label>
                <select
                  name="delivery_terms"
                  value={formData.delivery_terms}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sélectionner...</option>
                  <option value="EXW">EXW (Départ usine)</option>
                  <option value="FOB">FOB (Port d'embarquement)</option>
                  <option value="CIF">CIF (Assurance incluse)</option>
                  <option value="DDP">DDP (Rendu dédouané)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Statut */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Shield size={20} />
              Statut
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Statut
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ACTIVE">Actif</option>
                  <option value="INACTIVE">Inactif</option>
                </select>
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="prequalified"
                    checked={formData.prequalified}
                    onChange={handleChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Préqualifié</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <FileText size={20} />
              Notes internes
            </h2>
          </div>
          <div className="p-6">
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="4"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Notes internes sur ce fournisseur..."
            />
          </div>
        </div>

        {/* Documents */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Upload size={20} />
              Documents
            </h2>
          </div>
          <div className="p-6">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer inline-flex flex-col items-center"
              >
                <Upload size={40} className="text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">
                  Cliquez ou glissez-déposez des fichiers
                </span>
                <span className="text-xs text-gray-400 mt-1">
                  PDF, DOC, XLS, JPG, PNG (max 10MB)
                </span>
              </label>
            </div>

            {documents.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-medium text-gray-700">Documents uploadés</h3>
                {documents.map((doc, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileText size={18} className="text-blue-500" />
                      <span className="text-sm text-gray-700">{doc.name || doc.file_name}</span>
                      {doc.size && (
                        <span className="text-xs text-gray-400">
                          ({(doc.size / 1024).toFixed(0)} KB)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveDocument(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <X size={18} />
            Annuler
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save size={18} />
            {isSubmitting ? 'Enregistrement...' : (isEditMode ? 'Mettre à jour' : 'Créer')}
          </button>
        </div>
      </form>

      {/* Modal de confirmation d'annulation */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Quitter sans enregistrer"
        type="warning"
        confirmText="Quitter"
        cancelText="Continuer l'édition"
        onConfirm={() => navigate('/suppliers')}
      >
        <p>Vous avez des modifications non enregistrées.</p>
        <p className="text-sm text-gray-500 mt-2">Êtes-vous sûr de vouloir quitter ?</p>
      </Modal>
    </div>
  )
}
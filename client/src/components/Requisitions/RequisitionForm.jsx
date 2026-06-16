// src/components/Requisitions/RequisitionForm.jsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, X, Search, AlertCircle, CheckCircle, Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import { requisitionService } from '../../services/requisitionService'
import { projectService } from '../../services/projectService'
import { budgetService } from '../../services/budgetService'
import { departmentService } from '../../services/departmentService'
import { uploadService } from '../../services/uploadService'
import BudgetLineSearchModal from './BudgetLineSearchModal'
import FileUpload from '../Common/FileUpload'

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

export default function RequisitionForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [createdRequisitionId, setCreatedRequisitionId] = useState(null)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm({
    defaultValues: {
      items: [{ 
        description: '', 
        quantity: 1, 
        frequency: 1,
        unitPrice: 0,
        budgetLineId: '',
        budgetLineInfo: null
      }],
      projectId: '',
      departmentId: '',
      priority: 'MEDIUM',
      justification: ''
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  })

  const projectId = watch('projectId')
  const items = watch('items')

  // Charger les projets actifs
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['active-projects'],
    queryFn: () => projectService.getAll({ is_active: true })
  })

  // Charger les départements actifs
  const { data: departmentsData, isLoading: departmentsLoading } = useQuery({
    queryKey: ['active-departments'],
    queryFn: () => departmentService.getAll({ is_active: true })
  })

  const projects = projectsData?.data || []
  const departments = departmentsData?.data || []

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const result = await requisitionService.create(data);
      return result;
    },
    onSuccess: async (response) => {
      const requisitionId = response.data?.id;
      setCreatedRequisitionId(requisitionId);
      
      if (attachments.length > 0 && requisitionId) {
        const filesToUpload = attachments.filter(a => a.temporary).map(a => a.file);
        if (filesToUpload.length > 0) {
          await uploadService.uploadMultipleFiles(filesToUpload, 'requisition', requisitionId);
        }
      }
      
      queryClient.invalidateQueries(['requisitions'])
      toast.success('Réquisition créée avec succès')
      navigate('/requisitions')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la création')
    },
  })

  // Vérifier si un article est complet
  const isItemComplete = (item) => {
    return item && 
           item.description && 
           item.description.trim() !== '' &&
           item.quantity > 0 && 
           item.unitPrice > 0 && 
           item.budgetLineId &&
           item.frequency > 0
  }

  // Vérifier si tous les articles sont complets
  const areAllItemsComplete = () => {
    if (!items || items.length === 0) return false
    return items.every(item => isItemComplete(item))
  }

  // Vérifier si le formulaire global est valide
  const isFormValid = () => {
    const hasProject = !!projectId
    const hasDepartment = !!getValues('departmentId')
    const hasTitle = !!getValues('title') && getValues('title').trim() !== ''
    const itemsComplete = areAllItemsComplete()
    
    return hasProject && hasDepartment && hasTitle && itemsComplete
  }

  // Calculer le total d'un article: quantity * frequency * unitPrice
  const calculateItemTotal = (quantity, frequency, unitPrice) => {
    return (quantity || 0) * (frequency || 1) * (unitPrice || 0)
  }

  // Calculer le total général
  const calculateTotal = () => {
    if (!items) return 0
    return items.reduce((sum, item) => {
      return sum + calculateItemTotal(item.quantity, item.frequency, item.unitPrice)
    }, 0)
  }

  const onSubmit = async (data) => {
    if (!isFormValid()) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }

    setIsSubmitting(true)
    try {
      const totalAmount = calculateTotal()
      
      const itemsWithBudget = data.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        frequency: item.frequency,
        unitPrice: item.unitPrice,
        budgetLineId: item.budgetLineId,
        specifications: item.specifications || null
      }))
      
      await createMutation.mutateAsync({
        title: data.title,
        description: data.description,
        departmentId: data.departmentId,
        projectId: data.projectId,
        estimatedAmount: totalAmount,
        currency: 'USD',
        priority: data.priority,
        justification: data.justification || '',
        items: itemsWithBudget
      })
    } catch (error) {
      console.error('Submit error:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleProjectChange = (e) => {
    const projectId = e.target.value
    setValue('projectId', projectId)
    if (projectId) {
      const project = projects.find(p => p.id === projectId)
      setSelectedProject(project)
    } else {
      setSelectedProject(null)
    }
  }

  const handleBudgetLineSelect = (budgetLine) => {
    if (selectedItemIndex !== null) {
      setValue(`items.${selectedItemIndex}.budgetLineId`, budgetLine.id)
      setValue(`items.${selectedItemIndex}.budgetLineInfo`, budgetLine)
      toast.success(`Ligne budgétaire ${budgetLine.entity_code} assignée à l'article ${selectedItemIndex + 1}`)
    }
    setShowBudgetModal(false)
    setSelectedItemIndex(null)
  }

  const openBudgetSearch = (index) => {
    if (!projectId) {
      toast.error('Veuillez d\'abord sélectionner un projet')
      return
    }
    setSelectedItemIndex(index)
    setShowBudgetModal(true)
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(amount || 0)
  }

  const getItemStatus = (item) => {
    const isComplete = isItemComplete(item)
    return {
      isComplete,
      icon: isComplete ? <CheckCircle size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-red-500" />,
      tooltip: isComplete ? 'Article complet' : 'Champs manquants'
    }
  }

  const totalAmount = calculateTotal()
  const formValid = isFormValid()
  const completedItemsCount = items?.filter(i => isItemComplete(i)).length || 0
  const totalItemsCount = items?.length || 0

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Nouvelle Réquisition</h1>
        <button
          onClick={() => navigate('/requisitions')}
          className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800"
        >
          <X size={20} className="mr-2" />
          Annuler
        </button>
      </div>

      {/* Barre de progression / validation */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${formValid ? 'text-green-600' : 'text-red-600'}`}>
              {formValid ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
              <span className="font-medium">
                {formValid ? 'Formulaire complet' : 'Formulaire incomplet'}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              {completedItemsCount}/{totalItemsCount} articles complets
            </div>
          </div>
          <div className="text-lg font-semibold text-blue-600">
            Total: {formatCurrency(totalAmount)}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Informations générales */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Informations générales</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Titre *
              </label>
              <input
                {...register('title', { required: 'Le titre est requis' })}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  errors.title ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Titre de la réquisition"
              />
              {errors.title && (
                <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Département *
              </label>
              <select
                {...register('departmentId', { required: 'Le département est requis' })}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  errors.departmentId ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={departmentsLoading}
              >
                <option value="">Sélectionner un département</option>
                {departmentsLoading ? (
                  <option disabled>Chargement des départements...</option>
                ) : (
                  departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.code} - {dept.name}
                    </option>
                  ))
                )}
              </select>
              {errors.departmentId && (
                <p className="text-red-500 text-sm mt-1">{errors.departmentId.message}</p>
              )}
              {!departmentsLoading && departments.length === 0 && (
                <p className="text-sm text-amber-600 mt-1">
                  ⚠️ Aucun département disponible. Veuillez d'abord créer des départements.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Projet *
              </label>
              <select
                value={projectId}
                onChange={handleProjectChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  !projectId ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={projectsLoading}
              >
                <option value="">Sélectionner un projet</option>
                {projectsLoading ? (
                  <option disabled>Chargement des projets...</option>
                ) : (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </option>
                  ))
                )}
              </select>
              {!projectId && <p className="text-red-500 text-sm mt-1">Projet requis</p>}
              {!projectsLoading && projects.length === 0 && (
                <p className="text-sm text-amber-600 mt-1">
                  ⚠️ Aucun projet disponible. Veuillez d'abord créer des projets.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priorité *
              </label>
              <select
                {...register('priority', { required: 'La priorité est requise' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              {...register('description')}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Description détaillée de la demande..."
            />
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Justification
            </label>
            <textarea
              {...register('justification')}
              rows="2"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Justifiez cette demande d'achat..."
            />
          </div>
        </div>

        {/* Articles */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Articles</h2>
            <button
              type="button"
              onClick={() => append({ 
                description: '', 
                quantity: 1, 
                frequency: 1,
                unitPrice: 0,
                budgetLineId: '',
                budgetLineInfo: null
              })}
              className="flex items-center px-3 py-1 text-sm text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50"
            >
              <Plus size={16} className="mr-1" />
              Ajouter un article
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-10">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-20">Quantité</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-20">Fréquence (x/mois)</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">Prix unitaire</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">Total</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ligne budgétaire</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-12">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {fields.map((field, index) => {
                  const item = watch(`items.${index}`)
                  const status = getItemStatus(item)
                  const budgetLineInfo = watch(`items.${index}.budgetLineInfo`)
                  const itemTotal = calculateItemTotal(
                    item?.quantity || 0, 
                    item?.frequency || 1, 
                    item?.unitPrice || 0
                  )
                  
                  return (
                    <tr key={field.id} className={!status.isComplete ? 'bg-red-50' : ''}>
                      <td className="px-2 py-2 text-center" title={status.tooltip}>
                        {status.icon}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.description`, {
                            required: 'Description requise',
                          })}
                          placeholder="Description de l'article"
                          className={`w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${
                            !item?.description ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="1"
                          {...register(`items.${index}.quantity`, {
                            required: 'Quantité requise',
                            min: 1,
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-center focus:ring-2 focus:ring-blue-500 ${
                            !item?.quantity || item.quantity <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="1"
                          {...register(`items.${index}.frequency`, {
                            required: 'Fréquence requise',
                            min: 1,
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-center focus:ring-2 focus:ring-blue-500 ${
                            !item?.frequency || item.frequency <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                          placeholder="x/mois"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          {...register(`items.${index}.unitPrice`, {
                            required: 'Prix requis',
                            min: 0,
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-right focus:ring-2 focus:ring-blue-500 ${
                            !item?.unitPrice || item.unitPrice <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-medium text-blue-600">
                        {formatCurrency(itemTotal)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input
                            readOnly
                            value={budgetLineInfo ? `${budgetLineInfo.entity_code} - ${budgetLineInfo.description || 'Sans description'}` : ''}
                            onClick={() => openBudgetSearch(index)}
                            placeholder="Sélectionner ligne budgétaire"
                            className={`flex-1 px-2 py-1 border rounded bg-gray-50 cursor-pointer text-sm ${
                              !item?.budgetLineId ? 'border-red-400 bg-red-50' : 'border-green-400 bg-green-50'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => openBudgetSearch(index)}
                            className="px-2 py-1 bg-gray-100 border rounded hover:bg-gray-200"
                          >
                            <Search size={14} />
                          </button>
                        </div>
                        {budgetLineInfo && (
                          <div className="mt-1 text-xs text-green-600">
                            {budgetLineInfo.entity_code} - {budgetLineInfo.description?.substring(0, 50) || 'Sans description'}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan="5" className="px-3 py-3 text-right font-semibold">
                    Total général:
                  </td>
                  <td className="px-2 py-3 text-right font-bold text-blue-600">
                    {formatCurrency(totalAmount)}
                  </td>
                  <td colSpan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {fields.length === 0 && (
            <p className="text-center text-gray-500 py-4">
              Aucun article. Cliquez sur "Ajouter un article"
            </p>
          )}
        </div>

        {/* Pièces jointes */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Paperclip size={20} className="text-gray-500" />
            <h2 className="text-lg font-semibold">Pièces jointes</h2>
          </div>
          <FileUpload
            entityType="requisition"
            entityId={createdRequisitionId}
            onUploadComplete={setAttachments}
            existingFiles={attachments}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/requisitions')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !formValid}
            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={20} className="mr-2" />
            {isSubmitting ? 'Création...' : 'Créer la réquisition'}
          </button>
        </div>
      </form>

      {/* Modal de recherche de ligne budgétaire */}
      <BudgetLineSearchModal
        isOpen={showBudgetModal}
        onClose={() => {
          setShowBudgetModal(false)
          setSelectedItemIndex(null)
        }}
        onSelect={handleBudgetLineSelect}
        projectId={projectId}
      />
    </div>
  )
}
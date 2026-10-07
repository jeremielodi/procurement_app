// src/components/Requisitions/RequisitionForm.jsx
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, X, Search, AlertCircle, CheckCircle, Paperclip, Upload, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import requisitionService from '../../services/requisitionService'
import { projectService } from '../../services/projectService'
import { budgetService } from '../../services/budgetService'
import { departmentService } from '../../services/departmentService'
import { uploadService } from '../../services/uploadService'
import { enterpriseService } from '../../services/enterpriseService'
import BudgetLineSearchModal from './BudgetLineSearchModal'
import ImportItemsModal from './ImportItemsModal'
import FileUpload from '../Common/FileUpload'
import CatalogAutocomplete from '../Stock/CatalogAutocomplete'
import { t, getLocale } from '../../i18n'

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const priorityLabel = (p) => t(`priority.${p}`)

export default function RequisitionForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedEnterprise, setSelectedEnterprise] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [createdRequisitionId, setCreatedRequisitionId] = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)
  // Sélection multiple d'articles (field.id) pour assigner une ligne budgétaire en une fois
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkAssign, setBulkAssign] = useState(false)

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
        budgetLineInfo: null,
        stockItem: null
      }],
      projectId: '',
      departmentId: '',
      priority: 'MEDIUM',
      justification: ''
    },
  })

  const { fields, append, remove, replace: replaceItems } = useFieldArray({
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

  // Charger les projets actifs
  const { data: enterprisesData } = useQuery({
    queryKey: ['current-enteprise'],
    queryFn: () => enterpriseService.getAll()
  })
  // Charger les départements actifs
  const { data: departmentsData, isLoading: departmentsLoading } = useQuery({
    queryKey: ['active-departments'],
    queryFn: () => departmentService.getAll({ is_active: true })
  })

  const projects = projectsData?.data || []
  const departments = departmentsData?.data || []
  const enterprises = enterprisesData?.data || [];
  let currency = {};
  if (enterprises.length > 0) {
    currency = {
      code: enterprises[0].currency_code,
      id: enterprises[0].currency_id,
      name: enterprises[0].currency_name,
      symbol: enterprises[0].currency_symbol,
    }
  }
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
      toast.success(t('reqForm.created'))
      navigate('/requisitions')
    },
    onError: (error) => {
      toast.error(error.message || t('reqForm.createError'))
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
      toast.error(t('reqForm.fillRequired'))
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
        specifications: item.specifications || null,
        // Article du catalogue (gestion de stock) ; absent = texte libre
        stockItemId: item.stockItem?.id || null
      }))

      await createMutation.mutateAsync({
        title: data.title,
        description: data.description,
        departmentId: data.departmentId,
        projectId: data.projectId,
        estimatedAmount: totalAmount,
        currencyId: currency.id,
        currencyCode: currency.code,
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
    if (bulkAssign) {
      const indexes = fields.map((f, i) => (selectedIds.includes(f.id) ? i : -1)).filter(i => i >= 0)
      indexes.forEach(i => {
        setValue(`items.${i}.budgetLineId`, budgetLine.id)
        setValue(`items.${i}.budgetLineInfo`, budgetLine)
      })
      toast.success(t('reqForm.bulkAssigned', { code: budgetLine.entity_code, count: indexes.length }))
      setBulkAssign(false)
      setSelectedIds([])
    } else if (selectedItemIndex !== null) {
      setValue(`items.${selectedItemIndex}.budgetLineId`, budgetLine.id)
      setValue(`items.${selectedItemIndex}.budgetLineInfo`, budgetLine)
      toast.success(t('reqForm.assigned', { code: budgetLine.entity_code, index: selectedItemIndex + 1 }))
    }
    setShowBudgetModal(false)
    setSelectedItemIndex(null)
  }

  const openBulkBudgetSearch = () => {
    if (!projectId) {
      toast.error(t('reqForm.selectProjectFirst'))
      return
    }
    setBulkAssign(true)
    setShowBudgetModal(true)
  }

  const toggleSelected = (id) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const allSelected = fields.length > 0 && selectedIds.length === fields.length
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : fields.map(f => f.id))

  const removeSelected = () => {
    const indexes = fields.map((f, i) => (selectedIds.includes(f.id) ? i : -1)).filter(i => i >= 0)
    remove(indexes)
    setSelectedIds([])
  }

  // Articles importés : remplacent la ligne vide par défaut, ou tout si demandé
  const handleImport = (imported, { replace }) => {
    const current = getValues('items') || []
    const onlyEmptyRow = current.length === 1 && !current[0].description?.trim()
    if (replace || current.length === 0 || onlyEmptyRow) replaceItems(imported)
    else append(imported)
    setSelectedIds([])
  }

  const openBudgetSearch = (index) => {
    if (!projectId) {
      toast.error(t('reqForm.selectProjectFirst'))
      return
    }
    setSelectedItemIndex(index)
    setShowBudgetModal(true)
  }

  const formatCurrency = (amount) => {
    if (!currency.code) {
      return amount;
    }
    return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: currency.code }).format(amount || 0)
  }

  const getItemStatus = (item) => {
    const isComplete = isItemComplete(item)
    return {
      isComplete,
      icon: isComplete ? <CheckCircle size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-red-500" />,
      tooltip: isComplete ? t('reqForm.itemComplete') : t('reqForm.missingFields')
    }
  }

  const totalAmount = calculateTotal()
  const formValid = isFormValid()
  const completedItemsCount = items?.filter(i => isItemComplete(i)).length || 0
  const totalItemsCount = items?.length || 0

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{t('reqForm.title')}</h1>
        <button
          onClick={() => navigate('/requisitions')}
          className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800"
        >
          <X size={20} className="mr-2" />
          {t('common.cancel')}
        </button>
      </div>

      {/* Barre de progression / validation */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${formValid ? 'text-green-600' : 'text-red-600'}`}>
              {formValid ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
              <span className="font-medium">
                {formValid ? t('reqForm.formComplete') : t('reqForm.formIncomplete')}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              {t('reqForm.itemsComplete', { done: completedItemsCount, total: totalItemsCount })}
            </div>
          </div>
          <div className="text-lg font-semibold text-blue-600">
            {t('reqForm.total', { amount: formatCurrency(totalAmount) })}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Informations générales */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">{t('reqForm.generalInfo')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reqForm.titleLabel')}
              </label>
              <input
                {...register('title', { required: t('reqForm.titleRequired') })}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors.title ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('reqForm.titlePlaceholder')}
              />
              {errors.title && (
                <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reqForm.departmentLabel')}
              </label>
              <select
                {...register('departmentId', { required: t('reqForm.departmentRequired') })}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${errors.departmentId ? 'border-red-500' : 'border-gray-300'
                  }`}
                disabled={departmentsLoading}
              >
                <option value="">{t('reqForm.selectDepartment')}</option>
                {departmentsLoading ? (
                  <option disabled>{t('reqForm.loadingDepartments')}</option>
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
                  {t('reqForm.noDepartment')}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reqForm.projectLabel')}
              </label>
              <select
                value={projectId}
                onChange={handleProjectChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${!projectId ? 'border-red-500' : 'border-gray-300'
                  }`}
                disabled={projectsLoading}
              >
                <option value="">{t('reqForm.selectProject')}</option>
                {projectsLoading ? (
                  <option disabled>{t('reqForm.loadingProjects')}</option>
                ) : (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </option>
                  ))
                )}
              </select>
              {!projectId && <p className="text-red-500 text-sm mt-1">{t('reqForm.projectRequired')}</p>}
              {!projectsLoading && projects.length === 0 && (
                <p className="text-sm text-amber-600 mt-1">
                  {t('reqForm.noProject')}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reqForm.priorityLabel')}
              </label>
              <select
                {...register('priority', { required: t('reqForm.priorityRequired') })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('common.description')}
            </label>
            <textarea
              {...register('description')}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={t('reqForm.descriptionPlaceholder')}
            />
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reqForm.justification')}
            </label>
            <textarea
              {...register('justification')}
              rows="2"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={t('reqForm.justificationPlaceholder')}
            />
          </div>
        </div>

        {/* Articles */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">{t('reqForm.items')}</h2>
            <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="flex items-center px-3 py-1 text-sm text-green-700 border border-green-600 rounded-lg hover:bg-green-50"
            >
              <Upload size={16} className="mr-1" />
              {t('reqForm.import')}
            </button>
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
              {t('reqForm.addItem')}
            </button>
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 p-2 rounded-lg bg-blue-50 border border-blue-200 text-sm" data-testid="bulk-bar">
              <span className="font-medium text-blue-800">{t('reqForm.selectedItems', { count: selectedIds.length })}</span>
              <button type="button" onClick={openBulkBudgetSearch}
                className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Tag size={14} /> {t('reqForm.assignBudgetLine')}
              </button>
              <button type="button" onClick={removeSelected}
                className="flex items-center gap-1 px-3 py-1 text-red-600 border border-red-300 rounded-lg hover:bg-red-50">
                <Trash2 size={14} /> {t('common.delete')}
              </button>
              <button type="button" onClick={() => setSelectedIds([])} className="text-gray-600 hover:underline">
                {t('reqForm.deselect')}
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-center w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      aria-label={t('reqForm.selectAllItems')} className="rounded border-gray-300 text-blue-600" />
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-10">{t('reqForm.statusCol')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('common.description')}</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-20">{t('common.quantity')}</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-20">{t('reqForm.frequency')}</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">{t('common.unitPrice')}</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">{t('common.total')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('reqForm.budgetLine')}</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 w-12">{t('reqForm.action')}</th>
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
                    <tr key={field.id} className={selectedIds.includes(field.id) ? 'bg-blue-50' : !status.isComplete ? 'bg-red-50' : ''}>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={selectedIds.includes(field.id)} onChange={() => toggleSelected(field.id)}
                          aria-label={t('reqForm.selectItem', { index: index + 1 })} className="rounded border-gray-300 text-blue-600" />
                      </td>
                      <td className="px-2 py-2 text-center" title={status.tooltip}>
                        {status.icon}
                      </td>
                      <td className="px-3 py-2">
                        <CatalogAutocomplete
                          inputProps={register(`items.${index}.description`, {
                            required: t('reqForm.descriptionRequired'),
                          })}
                          linked={item?.stockItem || null}
                          onLink={(stockItem) => {
                            setValue(`items.${index}.stockItem`, stockItem)
                            if (stockItem) setValue(`items.${index}.description`, stockItem.name, { shouldValidate: true })
                          }}
                          placeholder={t('reqForm.itemDescription')}
                          className={`w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${!item?.description ? 'border-red-400 bg-red-50' : 'border-gray-300'
                            }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="any"
                          {...register(`items.${index}.quantity`, {
                            required: t('reqForm.quantityRequired'),
                            validate: (v) => v > 0 || t('reqForm.quantityRequired'),
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-center focus:ring-2 focus:ring-blue-500 ${!item?.quantity || item.quantity <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
                            }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="1"
                          {...register(`items.${index}.frequency`, {
                            required: t('reqForm.frequencyRequired'),
                            min: 1,
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-center focus:ring-2 focus:ring-blue-500 ${!item?.frequency || item.frequency <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
                            }`}
                          placeholder={t('reqForm.perMonth')}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          {...register(`items.${index}.unitPrice`, {
                            required: t('reqForm.priceRequired'),
                            min: 0,
                            valueAsNumber: true
                          })}
                          className={`w-full px-2 py-1 border rounded text-right focus:ring-2 focus:ring-blue-500 ${!item?.unitPrice || item.unitPrice <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'
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
                            value={budgetLineInfo ? `${budgetLineInfo.entity_code} - ${budgetLineInfo.description || t('reqForm.noDescription')}` : ''}
                            onClick={() => openBudgetSearch(index)}
                            placeholder={t('reqForm.selectBudgetLine')}
                            className={`flex-1 px-2 py-1 border rounded bg-gray-50 cursor-pointer text-sm ${!item?.budgetLineId ? 'border-red-400 bg-red-50' : 'border-green-400 bg-green-50'
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
                            {budgetLineInfo.entity_code} - {budgetLineInfo.description?.substring(0, 50) || t('reqForm.noDescription')}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => { remove(index); setSelectedIds(prev => prev.filter(x => x !== field.id)) }}
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
                  <td colSpan="6" className="px-3 py-3 text-right font-semibold">
                    {t('reqForm.grandTotal')}
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
              {t('reqForm.noItems')}
            </p>
          )}
        </div>

        {/* Pièces jointes */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Paperclip size={20} className="text-gray-500" />
            <h2 className="text-lg font-semibold">{t('reqForm.attachments')}</h2>
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
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !formValid}
            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={20} className="mr-2" />
            {isSubmitting ? t('reqForm.creating') : t('reqForm.create')}
          </button>
        </div>
      </form>

      {/* Modal de recherche de ligne budgétaire */}
      <BudgetLineSearchModal
        isOpen={showBudgetModal}
        onClose={() => {
          setShowBudgetModal(false)
          setSelectedItemIndex(null)
          setBulkAssign(false)
        }}
        onSelect={handleBudgetLineSelect}
        projectId={projectId}
      />

      <ImportItemsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImport}
        formatCurrency={formatCurrency}
      />
    </div>
  )
}
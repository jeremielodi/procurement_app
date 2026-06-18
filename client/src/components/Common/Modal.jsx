// src/components/Common/Modal.jsx
import React, { useEffect, useRef } from 'react'
import { X, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react'

const modalSizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw]'
}

const modalTypes = {
  default: {
    icon: null,
    iconColor: '',
    buttonColor: 'bg-blue-600 hover:bg-blue-700'
  },
  danger: {
    icon: AlertTriangle,
    iconColor: 'text-red-600',
    buttonColor: 'bg-red-600 hover:bg-red-700'
  },
  warning: {
    icon: AlertCircle,
    iconColor: 'text-yellow-600',
    buttonColor: 'bg-yellow-600 hover:bg-yellow-700'
  },
  success: {
    icon: CheckCircle,
    iconColor: 'text-green-600',
    buttonColor: 'bg-green-600 hover:bg-green-700'
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-600',
    buttonColor: 'bg-blue-600 hover:bg-blue-700'
  }
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  type = 'default',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showFooter = true,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  onConfirm,
  onCancel,
  isLoading = false,
  loadingText = 'Traitement en cours...',
  confirmDisabled = false,
  cancelDisabled = false,
  footerClassName = '',
  className = '',
  overlayClassName = '',
  contentClassName = ''
}) {
  const modalRef = useRef(null)
  const confirmButtonRef = useRef(null)

  // Gestion de la fermeture par la touche Escape
  useEffect(() => {
    const handleEscape = (event) => {
      if (closeOnEscape && event.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, closeOnEscape, onClose])

  // Gestion du clic sur l'overlay
  const handleOverlayClick = (e) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose()
    }
  }

  // Gestion de la confirmation
  const handleConfirm = async () => {
    if (onConfirm) {
      await onConfirm()
    }
  }

  // Gestion de l'annulation
  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    }
    onClose()
  }

  if (!isOpen) return null

  const ModalIcon = modalTypes[type].icon
  const iconColor = modalTypes[type].iconColor
  const buttonColor = modalTypes[type].buttonColor

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto ${overlayClassName}`}
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      {/* Modal container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={modalRef}
          className={`relative bg-white rounded-lg shadow-xl transform transition-all w-full ${modalSizes[size]} ${className}`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              {ModalIcon && (
                <div className={`${iconColor}`}>
                  <ModalIcon size={24} />
                </div>
              )}
              <h2 id="modal-title" className="text-xl font-semibold text-gray-900">
                {title}
              </h2>
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1 transition-colors"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {/* Body */}
          <div className={`p-6 ${contentClassName}`}>
            {children}
          </div>

          {/* Footer */}
          {showFooter && (
            <div className={`flex justify-end gap-3 p-6 border-t border-gray-200 ${footerClassName}`}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelDisabled || isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cancelText}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                onClick={handleConfirm}
                disabled={confirmDisabled || isLoading}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${buttonColor}`}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {loadingText}
                  </span>
                ) : (
                  confirmText
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Modal de confirmation
export const ConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = 'Confirmation',
  message = 'Êtes-vous sûr de vouloir effectuer cette action ?',
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  type = 'warning',
  isLoading = false
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      type={type}
      confirmText={confirmText}
      cancelText={cancelText}
      onConfirm={onConfirm}
      isLoading={isLoading}
      size="sm"
    >
      <p className="text-gray-600">{message}</p>
    </Modal>
  )
}

// Modal de suppression
export const DeleteModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  itemName = 'cet élément',
  isLoading = false
}) => {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Confirmer la suppression"
      message={`Êtes-vous sûr de vouloir supprimer ${itemName} ? Cette action est irréversible.`}
      confirmText="Supprimer"
      type="danger"
      isLoading={isLoading}
    />
  )
}

// Modal de formulaire
export const FormModal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  onSubmit,
  submitText = 'Enregistrer',
  cancelText = 'Annuler',
  isLoading = false,
  size = 'lg'
}) => {
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (onSubmit) {
      await onSubmit()
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      confirmText={submitText}
      cancelText={cancelText}
      onConfirm={handleSubmit}
      isLoading={isLoading}
      size={size}
    >
      <form id="modal-form" onSubmit={handleSubmit}>
        {children}
      </form>
    </Modal>
  )
}

// Modal de chargement
export const LoadingModal = ({ isOpen, message = 'Chargement en cours...' }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      title="Chargement"
      showFooter={false}
      showCloseButton={false}
      closeOnOverlayClick={false}
      closeOnEscape={false}
      size="sm"
    >
      <div className="flex flex-col items-center justify-center py-6">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-gray-600">{message}</p>
      </div>
    </Modal>
  )
}

// Modal avec détails
export const DetailModal = ({ 
  isOpen, 
  onClose, 
  title, 
  details,
  size = 'lg'
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      confirmText="Fermer"
      cancelText=""
      onConfirm={onClose}
      size={size}
    >
      <div className="space-y-4">
        {Object.entries(details).map(([key, value]) => (
          <div key={key} className="border-b border-gray-100 pb-3">
            <dt className="text-sm font-medium text-gray-500">{key}</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {typeof value === 'object' ? JSON.stringify(value, null, 2) : value || '-'}
            </dd>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// Modal de succès
export const SuccessModal = ({ 
  isOpen, 
  onClose, 
  title = 'Succès', 
  message,
  autoCloseDelay = 3000
}) => {
  useEffect(() => {
    if (isOpen && autoCloseDelay) {
      const timer = setTimeout(() => {
        onClose()
      }, autoCloseDelay)
      return () => clearTimeout(timer)
    }
  }, [isOpen, autoCloseDelay, onClose])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      type="success"
      confirmText="Fermer"
      cancelText=""
      onConfirm={onClose}
      size="sm"
    >
      <div className="text-center py-4">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
        <p className="text-gray-600">{message}</p>
      </div>
    </Modal>
  )
}

// Modal d'erreur
export const ErrorModal = ({ 
  isOpen, 
  onClose, 
  title = 'Erreur', 
  message,
  details,
  onRetry
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      type="danger"
      confirmText={onRetry ? "Réessayer" : "Fermer"}
      cancelText={onRetry ? "Annuler" : ""}
      onConfirm={onRetry || onClose}
      size="md"
    >
      <div className="text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
        <p className="text-gray-600 mb-2">{message}</p>
        {details && (
          <details className="mt-4 text-left">
            <summary className="text-sm text-gray-500 cursor-pointer">Détails techniques</summary>
            <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
              {typeof details === 'object' ? JSON.stringify(details, null, 2) : details}
            </pre>
          </details>
        )}
      </div>
    </Modal>
  )
}
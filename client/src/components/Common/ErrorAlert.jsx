// src/components/Common/ErrorAlert.jsx
import React from 'react'
import { AlertCircle, X, AlertTriangle, Info, CheckCircle, RefreshCw } from 'lucide-react'

const errorTypes = {
  error: {
    icon: AlertCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
    titleColor: 'text-red-800',
    messageColor: 'text-red-700',
    iconColor: 'text-red-500',
    buttonColor: 'bg-red-100 hover:bg-red-200 text-red-800'
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-800',
    titleColor: 'text-yellow-800',
    messageColor: 'text-yellow-700',
    iconColor: 'text-yellow-500',
    buttonColor: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800'
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-800',
    titleColor: 'text-blue-800',
    messageColor: 'text-blue-700',
    iconColor: 'text-blue-500',
    buttonColor: 'bg-blue-100 hover:bg-blue-200 text-blue-800'
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-800',
    titleColor: 'text-green-800',
    messageColor: 'text-green-700',
    iconColor: 'text-green-500',
    buttonColor: 'bg-green-100 hover:bg-green-200 text-green-800'
  }
}

export default function ErrorAlert({ 
  type = 'error', 
  title, 
  message, 
  details, 
  onClose, 
  onRetry,
  showIcon = true,
  className = '',
  dismissible = true,
  retryText = 'Réessayer'
}) {
  const [showDetails, setShowDetails] = React.useState(false)
  const styles = errorTypes[type] || errorTypes.error
  const Icon = styles.icon

  return (
    <div className={`${styles.bgColor} border ${styles.borderColor} rounded-lg p-4 ${className}`} role="alert">
      <div className="flex items-start">
        {showIcon && (
          <div className="flex-shrink-0">
            <Icon className={`h-5 w-5 ${styles.iconColor}`} />
          </div>
        )}
        <div className={`flex-1 ${showIcon ? 'ml-3' : ''}`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-medium ${styles.titleColor}`}>
              {title || (type === 'error' ? 'Erreur' : type === 'warning' ? 'Attention' : type === 'success' ? 'Succès' : 'Information')}
            </h3>
            {dismissible && onClose && (
              <button
                onClick={onClose}
                className={`ml-4 flex-shrink-0 ${styles.textColor} hover:opacity-75 transition-opacity`}
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className={`mt-1 text-sm ${styles.messageColor}`}>
            {message}
          </div>
          {details && (
            <div className="mt-2">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className={`text-xs font-medium ${styles.textColor} underline hover:no-underline`}
              >
                {showDetails ? 'Masquer les détails' : 'Voir les détails'}
              </button>
              {showDetails && (
                <pre className={`mt-2 text-xs ${styles.messageColor} bg-white bg-opacity-50 p-2 rounded overflow-x-auto`}>
                  {typeof details === 'object' ? JSON.stringify(details, null, 2) : details}
                </pre>
              )}
            </div>
          )}
          {onRetry && (
            <div className="mt-3">
              <button
                onClick={onRetry}
                className={`inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-md ${styles.buttonColor} transition-colors`}
              >
                <RefreshCw className="h-3 w-3" />
                {retryText}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Variante pour les formulaires
export const FormError = ({ errors, onClose }) => {
  if (!errors || Object.keys(errors).length === 0) return null

  return (
    <ErrorAlert
      type="error"
      title="Erreur de validation"
      message="Veuillez corriger les erreurs suivantes :"
      details={Object.values(errors).join('\n')}
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs API
export const ApiError = ({ error, onRetry, onClose }) => {
  const statusCode = error?.response?.status
  const statusText = error?.response?.statusText
  const message = error?.response?.data?.message || error?.message || 'Une erreur est survenue'

  let title = 'Erreur'
  let errorMessage = message

  switch (statusCode) {
    case 400:
      title = 'Requête invalide'
      break
    case 401:
      title = 'Non autorisé'
      errorMessage = 'Veuillez vous connecter pour accéder à cette ressource'
      break
    case 403:
      title = 'Accès interdit'
      errorMessage = 'Vous n\'avez pas les droits nécessaires pour effectuer cette action'
      break
    case 404:
      title = 'Ressource non trouvée'
      errorMessage = 'La ressource demandée n\'existe pas'
      break
    case 500:
      title = 'Erreur serveur'
      errorMessage = 'Une erreur interne est survenue. Veuillez réessayer plus tard'
      break
    default:
      break
  }

  return (
    <ErrorAlert
      type="error"
      title={title}
      message={errorMessage}
      details={process.env.NODE_ENV === 'development' ? error : null}
      onRetry={onRetry}
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs de connexion
export const ConnectionError = ({ onRetry, onClose }) => {
  return (
    <ErrorAlert
      type="warning"
      title="Problème de connexion"
      message="Impossible de se connecter au serveur. Veuillez vérifier votre connexion Internet."
      details="Vérifiez que le serveur est en cours d'exécution et que votre connexion réseau est active."
      onRetry={onRetry}
      retryText="Reconnecter"
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs de validation
export const ValidationError = ({ errors, onClose }) => {
  const errorList = Array.isArray(errors) ? errors : [errors]
  
  return (
    <ErrorAlert
      type="error"
      title="Erreur de validation"
      message="Les données fournies ne sont pas valides"
      details={errorList.join('\n')}
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs de permission
export const PermissionError = ({ onClose }) => {
  return (
    <ErrorAlert
      type="warning"
      title="Permission refusée"
      message="Vous n'avez pas l'autorisation d'accéder à cette page ou d'effectuer cette action."
      details="Contactez votre administrateur si vous pensez qu'il s'agit d'une erreur."
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs de chargement
export const LoadingError = ({ resourceName = 'données', onRetry, onClose }) => {
  return (
    <ErrorAlert
      type="error"
      title={`Impossible de charger les ${resourceName}`}
      message={`Une erreur est survenue lors du chargement des ${resourceName}. Veuillez réessayer.`}
      onRetry={onRetry}
      retryText={`Recharger les ${resourceName}`}
      onClose={onClose}
    />
  )
}

// Variante pour les erreurs d'envoi de formulaire
export const SubmitError = ({ error, onRetry, onClose }) => {
  return (
    <ErrorAlert
      type="error"
      title="Erreur d'envoi"
      message="Le formulaire n'a pas pu être soumis. Veuillez vérifier les informations et réessayer."
      details={error?.message}
      onRetry={onRetry}
      retryText="Réessayer l'envoi"
      onClose={onClose}
    />
  )
}

// Variante pour les alertes de succès
export const SuccessAlert = ({ title, message, onClose, duration = 5000 }) => {
  React.useEffect(() => {
    if (onClose && duration) {
      const timer = setTimeout(onClose, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  return (
    <ErrorAlert
      type="success"
      title={title || 'Succès'}
      message={message}
      onClose={onClose}
      dismissible={true}
    />
  )
}

// Variante pour les alertes d'information
export const InfoAlert = ({ title, message, onClose }) => {
  return (
    <ErrorAlert
      type="info"
      title={title || 'Information'}
      message={message}
      onClose={onClose}
      dismissible={true}
    />
  )
}

// Composant pour afficher plusieurs erreurs en liste
export const ErrorList = ({ errors, onClose, onRetry }) => {
  if (!errors || errors.length === 0) return null

  return (
    <div className="space-y-2">
      {errors.map((error, index) => (
        <ErrorAlert
          key={index}
          type={error.type || 'error'}
          title={error.title}
          message={error.message}
          details={error.details}
          onClose={onClose}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}

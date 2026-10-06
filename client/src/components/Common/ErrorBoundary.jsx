// src/components/common/ErrorBoundary.jsx
import React from 'react';
import { AlertTriangle, RefreshCw, Home, Mail, FileText } from 'lucide-react';
import { t, getLocale } from '../../i18n';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error) {
    // Mettre à jour l'état pour afficher l'UI de fallback
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log l'erreur dans la console
    console.error('Erreur capturée par ErrorBoundary:', error, errorInfo);
    
    this.setState({
      errorInfo,
      errorCount: this.state.errorCount + 1,
    });

    // Optionnel: Envoyer l'erreur à un service de monitoring
    this.logErrorToService(error, errorInfo);
  }

  // Simuler l'envoi d'erreur à un service externe
  logErrorToService(error, errorInfo) {
    // Ici vous pouvez intégrer Sentry, LogRocket, etc.
    // Exemple: Sentry.captureException(error, { extra: errorInfo });
    console.log('Erreur envoyée au service de monitoring:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
    });
  }

  // Gérer le rechargement
  handleReload = () => {
    window.location.reload();
  };

  // Gérer le retour à l'accueil
  handleGoHome = () => {
    window.location.href = '/';
  };

  // Gérer le signalement d'erreur
  handleReportError = () => {
    const errorReport = {
      message: this.state.error?.message || t('errorBoundary.unknown'),
      stack: this.state.error?.stack || 'Stack non disponible',
      componentStack: this.state.errorInfo?.componentStack || 'Component stack non disponible',
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    };

    // Copier le rapport dans le presse-papier
    const reportText = JSON.stringify(errorReport, null, 2);
    navigator.clipboard?.writeText(reportText);

    alert(t('errorBoundary.reportCopied'));
  };

  // Obtenir un message d'erreur convivial
  getFriendlyErrorMessage() {
    const { error } = this.state;
    
    if (!error) return t('errorBoundary.unexpected');
    
    const errorMessages = Object.fromEntries(
      ['NetworkError', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'URIError', 'EvalError', 'Error']
        .map(k => [k, t(`errorBoundary.${k}`)])
    );

    // Vérifier si le message contient un mot-clé
    const message = error.message || '';
    for (const [key, value] of Object.entries(errorMessages)) {
      if (message.includes(key) || message.toLowerCase().includes(key.toLowerCase())) {
        return value;
      }
    }

    // Message personnalisé basé sur le type d'erreur
    if (message.includes('401')) return t('errorBoundary.e401');
    if (message.includes('403')) return t('errorBoundary.e403');
    if (message.includes('404')) return t('errorBoundary.e404');
    if (message.includes('500')) return t('errorBoundary.e500');
    if (message.includes('timeout')) return t('errorBoundary.timeout');
    if (message.includes('permission')) return t('errorBoundary.permission');
    if (message.includes('not found')) return t('errorBoundary.notFound');
    if (message.includes('already exists')) return t('errorBoundary.exists');
    if (message.includes('validation')) return t('errorBoundary.validation');

    // Si l'erreur est liée à l'authentification
    if (message.includes('auth') || message.includes('login') || message.includes('token')) {
      return t('errorBoundary.auth');
    }

    // Erreur de chargement de module
    if (message.includes('ChunkLoadError') || message.includes('Loading chunk')) {
      return t('errorBoundary.chunk');
    }

    return t('errorBoundary.fallback');
  }

  render() {
    const { hasError, error } = this.state;
    const { fallback, children } = this.props;

    // Si pas d'erreur, afficher les enfants
    if (!hasError) {
      return children;
    }

    // Si un fallback personnalisé est fourni, l'utiliser
    if (fallback) {
      return fallback;
    }

    // Afficher l'UI de fallback
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full">
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
            {/* En-tête avec icône d'erreur */}
            <div className="bg-gradient-to-r from-red-50 to-red-100 px-8 py-6 border-b border-red-200">
              <div className="flex items-center justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-500 rounded-full opacity-20 animate-pulse"></div>
                  <div className="relative bg-red-500 rounded-full p-4">
                    <AlertTriangle className="w-12 h-12 text-white" />
                  </div>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 text-center">
                {t('errorBoundary.title')}
              </h2>
              <p className="text-gray-600 text-center mt-2">
                {this.getFriendlyErrorMessage()}
              </p>
            </div>

            {/* Corps du message */}
            <div className="px-8 py-6">
              {/* Détails de l'erreur (développeur seulement) */}
              {process.env.NODE_ENV === 'development' && error && (
                <div className="mb-6">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-xs font-mono text-gray-600 break-all">
                      <span className="font-semibold text-red-600">{t('errorBoundary.errorLabel')}</span> {error.message || t('errorBoundary.unknown')}
                    </p>
                    {this.state.errorInfo && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                          {t('errorBoundary.stackTrace')}
                        </summary>
                        <pre className="mt-2 text-xs font-mono text-gray-600 whitespace-pre-wrap bg-gray-100 p-2 rounded">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )}

              {/* Compteur d'erreurs */}
              {this.state.errorCount > 1 && (
                <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-700">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    {t('errorBoundary.occurred', { count: this.state.errorCount })}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={this.handleReload}
                  className="flex items-center justify-center px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('common.refresh')}
                </button>

                <button
                  onClick={this.handleGoHome}
                  className="flex items-center justify-center px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors duration-200"
                >
                  <Home className="w-4 h-4 mr-2" />
                  {t('errorBoundary.home')}
                </button>

                <button
                  onClick={this.handleReportError}
                  className="flex items-center justify-center px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-medium rounded-lg transition-colors duration-200 border border-red-200"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  {t('errorBoundary.report')}
                </button>
              </div>

              {/* Conseils */}
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-800 mb-2">
                  {t('errorBoundary.tipsTitle')}
                </h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  {t('errorBoundary.tips', { returnObjects: true }).map(tip => <li key={tip}>• {tip}</li>)}
                </ul>
              </div>

              {/* ID de session / référence */}
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-400">
                  {t('errorBoundary.sessionId', { id: this.generateSessionId() })}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('errorBoundary.dateLabel', { date: new Date().toLocaleString(getLocale()) })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Générer un ID de session simple
  generateSessionId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

// HOC pour utiliser ErrorBoundary facilement
export function withErrorBoundary(WrappedComponent, fallback = null) {
  return function WithErrorBoundary(props) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

// Composant d'erreur minimal pour les petits composants
export function MinimalErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-center">
        <AlertTriangle className="w-5 h-5 text-red-500 mr-2" />
        <p className="text-sm text-red-700">
          {error?.message || t('common.errorOccurred')}
        </p>
      </div>
      <button
        onClick={resetErrorBoundary}
        className="mt-2 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

// Composant d'erreur pour les sections de page
export function SectionErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex flex-col items-center justify-center py-8">
        <div className="bg-red-100 rounded-full p-3 mb-4">
          <AlertTriangle className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {t('errorBoundary.sectionTitle')}
        </h3>
        <p className="text-sm text-gray-500 text-center max-w-md mb-4">
          {error?.message || t('errorBoundary.sectionMsg')}
        </p>
        <div className="flex space-x-3">
          <button
            onClick={resetErrorBoundary}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
          >
            {t('common.retry')}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
          >
            {t('errorBoundary.reloadPage')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;
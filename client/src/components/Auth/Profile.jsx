// src/components/Auth/Profile.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { User, Mail, Building2, Briefcase, Key, Save, Eye, EyeOff, AlertCircle, Calendar, Shield, CheckCircle, XCircle, Users, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { t, getLocale } from '../../i18n';
import LanguageSwitcher from '../Common/LanguageSwitcher';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [userDetails, setUserDetails] = useState(null);
  
  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    department: user?.department || '',
    position: user?.position || ''
  });
  
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  const [errors, setErrors] = useState({});

  // Charger les détails complets de l'utilisateur
  useEffect(() => {
    loadUserDetails();
  }, []);

  const loadUserDetails = async () => {
    try {
      const response = await api.get('/auth/profile');
      setUserDetails(response.data.data);
    } catch (error) {
      console.error('Error loading user details:', error);
    }
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validatePassword = () => {
    const newErrors = {};
    if (!passwordData.currentPassword) {
      newErrors.currentPassword = t('profile.currentRequired');
    }
    if (!passwordData.newPassword) {
      newErrors.newPassword = t('profile.newRequired');
    } else if (passwordData.newPassword.length < 6) {
      newErrors.newPassword = t('profile.minLength');
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      newErrors.confirmPassword = t('profile.mismatch');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdateProfile = async () => {
    setIsLoading(true);
    try {
      const response = await api.put('/auth/profile', profileData);
      if (response.data.success) {
        updateUser({ ...user, ...profileData });
        toast.success(t('profile.updated'));
        setIsEditing(false);
        loadUserDetails();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t('profile.updateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!validatePassword()) return;
    
    setIsLoading(true);
    try {
      const response = await api.post('/auth/change-password', {
        oldPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      
      if (response.data.success) {
        toast.success(t('profile.passwordChanged'));
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t('profile.passwordError'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString(getLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const details = userDetails || user;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t('nav.myProfile')}</h1>
      
      {/* Cartes de statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-full">
              <Shield size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('profile.bpmnProfiles')}</p>
              <p className="text-lg font-bold text-gray-800">
                {details?.profiles?.length || 0}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-full">
              <CheckCircle size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('common.status')}</p>
              <p className={`text-lg font-bold ${details?.isActive ? 'text-green-600' : 'text-red-600'}`}>
                {details?.isActive ? t('common.active') : t('common.inactive')}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-full">
              <Clock size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('profile.lastLogin')}</p>
              <p className="text-sm font-medium text-gray-800">
                {formatDate(details?.lastLogin)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Informations personnelles */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <User size={20} />
            {t('profile.personalInfo')}
          </h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
            >
              <Save size={14} />
              {t('common.edit')}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleUpdateProfile}
                disabled={isLoading}
                className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1"
              >
                <Save size={14} />
                {t('common.save')}
              </button>
            </div>
          )}
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.firstName')}</label>
              {isEditing ? (
                <input
                  type="text"
                  name="firstName"
                  value={profileData.firstName}
                  onChange={handleProfileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-gray-900 font-medium">{details?.firstName || '-'}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.lastName')}</label>
              {isEditing ? (
                <input
                  type="text"
                  name="lastName"
                  value={profileData.lastName}
                  onChange={handleProfileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-gray-900 font-medium">{details?.lastName || '-'}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail size={14} className="inline mr-1" />
                {t('common.email')}
              </label>
              <p className="text-gray-900">{details?.email}</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Users size={14} className="inline mr-1" />
                {t('profile.username')}
              </label>
              <p className="text-gray-900">@{details?.username}</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Building2 size={14} className="inline mr-1" />
                {t('common.department')}
              </label>
              {isEditing ? (
                <input
                  type="text"
                  name="department"
                  value={profileData.department}
                  onChange={handleProfileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-gray-900">{details?.department || '-'}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Briefcase size={14} className="inline mr-1" />
                {t('profile.position')}
              </label>
              {isEditing ? (
                <input
                  type="text"
                  name="position"
                  value={profileData.position}
                  onChange={handleProfileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-gray-900">{details?.position || '-'}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Calendar size={14} className="inline mr-1" />
                {t('profile.registeredAt')}
              </label>
              <p className="text-gray-900">{formatDate(details?.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Profils BPMN */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Shield size={20} />
            {t('profile.assignedProfiles')}
          </h2>
        </div>
        <div className="p-6">
          {details?.profiles && details.profiles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {details.profiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="p-2 bg-blue-100 rounded-full">
                    <Shield size={16} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">{profile.name}</p>
                    <p className="text-xs text-gray-500">{profile.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">{t('profile.noProfile')}</p>
          )}
        </div>
      </div>

      {/* Permissions */}
      {details?.permissions && details.permissions.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Key size={20} />
              {t('profile.permissions')}
            </h2>
          </div>
          <div className="p-6">
            <div className="flex flex-wrap gap-2">
              {details.permissions.map((permission, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs"
                >
                  {permission}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Langue de l'interface */}
      <div className="bg-white rounded-lg shadow p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{t('profile.language')}</h2>
          <p className="text-sm text-gray-500">{t('profile.languageHint')}</p>
        </div>
        <LanguageSwitcher variant="select" />
      </div>

      {/* Changement de mot de passe */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Key size={20} />
            {t('profile.changePassword')}
          </h2>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile.currentPassword')}
              </label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  name="currentPassword"
                  value={passwordData.currentPassword}
                  onChange={handlePasswordChange}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                    errors.currentPassword ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.currentPassword}
                </p>
              )}
            </div>
            
            <div></div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile.newPassword')}
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  name="newPassword"
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                    errors.newPassword ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.newPassword && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.newPassword}
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile.confirmNewPassword')}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                    errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>
          
          <div className="mt-6">
            <button
              onClick={handleChangePassword}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <Key size={16} />
              )}
              {t('profile.changePassword')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
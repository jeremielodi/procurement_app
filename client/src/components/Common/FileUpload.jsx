// src/components/Common/FileUpload.jsx
import React, { useState, useRef } from 'react';
import { Upload, X, FileText, Image, File, Trash2, Eye, Download } from 'lucide-react';
import { uploadService } from '../../services/uploadService';
import toast from 'react-hot-toast';

const FileUpload = ({ entityType, entityId, onUploadComplete, existingFiles = [] }) => {
  const [files, setFiles] = useState(existingFiles);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return <Image size={20} className="text-blue-500" />;
    if (mimeType === 'application/pdf') return <FileText size={20} className="text-red-500" />;
    return <File size={20} className="text-gray-500" />;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    await handleUpload(droppedFiles);
  };

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    await handleUpload(selectedFiles);
  };

  const handleUpload = async (newFiles) => {
    if (!entityId) {
      // Si pas encore d'ID, stocker temporairement
      const tempFiles = newFiles.map(file => ({
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        temporary: true,
        preview: URL.createObjectURL(file)
      }));
      setFiles(prev => [...prev, ...tempFiles]);
      if (onUploadComplete) onUploadComplete([...files, ...tempFiles]);
      toast.success(`${newFiles.length} fichier(s) sélectionné(s)`);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadService.uploadMultipleFiles(newFiles, entityType, entityId);
      const uploadedFiles = result.data.map(file => ({
        id: file.id,
        file_name: file.file_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        file_path: file.file_path,
        uploaded_at: file.uploaded_at
      }));
      setFiles(prev => [...prev, ...uploadedFiles]);
      if (onUploadComplete) onUploadComplete([...files, ...uploadedFiles]);
      toast.success(`${uploadedFiles.length} fichier(s) uploadé(s)`);
    } catch (error) {
      toast.error('Erreur lors de l\'upload');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId, index) => {
    if (!fileId) {
      // Supprimer un fichier temporaire
      const newFiles = files.filter((_, i) => i !== index);
      setFiles(newFiles);
      if (onUploadComplete) onUploadComplete(newFiles);
      toast.success('Fichier supprimé');
      return;
    }

    try {
      await uploadService.deleteFile(fileId);
      const newFiles = files.filter((_, i) => i !== index);
      setFiles(newFiles);
      if (onUploadComplete) onUploadComplete(newFiles);
      toast.success('Fichier supprimé');
    } catch (error) {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleDownload = async (fileId, fileName) => {
    try {
      const blob = await uploadService.downloadFile(fileId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erreur lors du téléchargement');
    }
  };

  return (
    <div className="space-y-4">
      {/* Zone de drop */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept=".pdf"
        />
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-3" />
        <p className="text-sm text-gray-600">
          Glissez-déposez vos fichiers ici ou{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            parcourez
          </button>
        </p>
        <p className="text-xs text-gray-400 mt-2">
          PDF, DOC, XLS, JPG, PNG (max. 10MB par fichier)
        </p>
      </div>

      {/* Liste des fichiers */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">Fichiers joints ({files.length})</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((file, index) => (
              <div key={file.id || index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  {file.preview ? (
                    <img src={file.preview} alt={file.name} className="w-8 h-8 object-cover rounded" />
                  ) : (
                    getFileIcon(file.mime_type)
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-800">{file.file_name || file.name}</p>
                    <p className="text-xs text-gray-400">{formatFileSize(file.file_size || file.size)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {file.id && (
                    <button
                      type="button"
                      onClick={() => handleDownload(file.id, file.file_name)}
                      className="p-1 text-gray-500 hover:text-blue-600 rounded"
                      title="Télécharger"
                    >
                      <Download size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(file.id, index)}
                    className="p-1 text-gray-500 hover:text-red-600 rounded"
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          Upload en cours...
        </div>
      )}
    </div>
  );
};

export default FileUpload;
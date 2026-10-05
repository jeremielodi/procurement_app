// Documents de préqualification des fournisseurs (mêmes règles que backend/src/utils/supplierDocuments.js)
// Tous facultatifs : EXPECTED_DOCS = documents proposés selon le type de fournisseur
export const DOC_LABELS = {
  ID_CARD: "Pièce d'identité",
  RCCM: 'RCCM',
  TAX: 'Attestation fiscale (n° impôt)',
  ID_NAT: 'Identification nationale (ID Nat)',
  RIB: "RIB (relevé d'identité bancaire)",
};

export const EXPECTED_DOCS = {
  COMPANY: ['ID_CARD', 'RCCM', 'TAX', 'ID_NAT', 'RIB'],
  INDIVIDUAL: ['ID_CARD', 'RIB'],
};

export const SUPPLIER_TYPE_LABELS = { COMPANY: 'Entreprise', INDIVIDUAL: 'Personne physique' };

// PDF pour tous ; la pièce d'identité peut aussi être une photo
export const docAccept = (type) => (type === 'ID_CARD' ? 'application/pdf,image/jpeg,image/png' : 'application/pdf');
export const MAX_DOC_SIZE = 5 * 1024 * 1024;

/** Message d'erreur si le fichier ne convient pas, sinon null */
export function checkDocFile(type, file) {
  const allowed = docAccept(type).split(',');
  if (!allowed.includes(file.type)) return `${DOC_LABELS[type]} : ${type === 'ID_CARD' ? 'PDF, JPG ou PNG' : 'fichier PDF'} attendu`;
  if (file.size > MAX_DOC_SIZE) return `${DOC_LABELS[type]} : 5 Mo maximum`;
  return null;
}

export const PREQ_STATUS = {
  APPROVED: { label: 'Préqualifié', cls: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rejeté', cls: 'bg-red-100 text-red-800' },
  PENDING: { label: 'En attente', cls: 'bg-yellow-100 text-yellow-800' },
};

/**
 * Ouvre un document authentifié dans un nouvel onglet (blob).
 * L'onglet est ouvert avant le téléchargement pour ne pas être bloqué par le navigateur.
 */
export async function openDocument(fetchBlob) {
  const win = window.open('', '_blank');
  try {
    const blob = await fetchBlob();
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
  }
}

/** Télécharge un blob sous un nom de fichier */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

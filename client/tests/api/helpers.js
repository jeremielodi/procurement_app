export const TEST_CREDS = {
  email: 'admin@procurement.com',
  password: 'Admin123!',
};

/**
 * Login and return the JWT token.
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function getToken(request) {
  const res  = await request.post('/api/auth/login', { data: TEST_CREDS });
  const body = await res.json();
  const token = body.data?.token || body.token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return token;
}

/** Returns the Authorization header object for a given token. */
export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// PDF minimal valide pour les documents de préqualification
export const PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const pdf = (name) => ({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: PDF_BUFFER });

/**
 * Formulaire d'inscription fournisseur complet (multipart).
 * type : COMPANY (5 documents + RCCM / impôt / ID Nat) ou INDIVIDUAL (pièce d'identité + RIB).
 */
export function supplierRegistration({ type = 'COMPANY', name, email, password = 'Secret123', locationIds, categoryIds, extra = {} }) {
  const base = {
    supplierType: type, name, email, password,
    address: 'Avenue de test 1, Goma', bankName: 'Banque Test', bankAccount: '00011-22233-44',
    locationIds: JSON.stringify(locationIds), categoryIds: JSON.stringify(categoryIds),
    doc_ID_CARD: pdf('id'), doc_RIB: pdf('rib'),
  };
  const company = type === 'COMPANY' ? {
    contactName: 'Jean Test', phone: '+243 990 000 000',
    registrationNumber: 'CD/GOM/RCCM/24-B-0001', taxId: 'A1234567X', idNat: '01-93-N12345X',
    doc_RCCM: pdf('rccm'), doc_TAX: pdf('impot'), doc_ID_NAT: pdf('idnat'),
  } : {};
  return { ...base, ...company, ...extra };
}

/** Ids de la première localisation et de la première catégorie actives */
export async function firstReferenceIds(request) {
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const categories = (await (await request.get('/api/public/market-categories')).json()).data;
  return { locationId: locations[0].id, categoryId: categories[0].id, locations, categories };
}

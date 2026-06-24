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

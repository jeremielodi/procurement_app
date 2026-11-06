import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Code initial des n° d'inventaire par projet (migration 50_inventory_prefix.sql) : projects.inventory_prefix
// (ex. INVT-MSH ; vide → INVT) ; n° automatique <code initial>-AAAA-NNNNN, compteur par code initial et par année ;
// préfixe du projet de financement de l'unité ; préfixes de documents (INV = factures…) refusés ; changement tracé.
test.describe.serial('API › Code initial des n° d\'inventaire par projet', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const prefix = `INVT-${stamp}`.slice(0, 20);
  const year = new Date().getFullYear();
  let admin, project, warehouse, laptop;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const register = async (request, projectId, serials) => {
    const r = await json(await request.post('/api/stock-units/register', { headers: H(), data: {
      stockItemId: laptop.id, warehouseId: warehouse.id, ...(projectId ? { projectId } : {}), units: serials.map(serialNumber => ({ serialNumber })),
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return Promise.all(r.body.data.ids.map(async (id) => (await (await request.get(`/api/stock-units/${id}`, { headers: H() })).json()).data.asset_tag));
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const [locations, cats] = await Promise.all(['/api/public/locations', '/api/public/market-categories']
      .map(async (u) => (await (await request.get(u, { headers: H() })).json()).data));
    warehouse = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `IP-${stamp}`.slice(0, 30), name: `Dépôt inventaire ${stamp}`, locationId: locations[0].id } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: {
      code: `IP-LAP-${stamp}`, name: 'Ordinateur (inventaire)', unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id, trackSerials: true,
    } })).json()).data;
    expect(warehouse?.id && laptop?.id).toBeTruthy();
  });

  test('Projet : code initial contrôlé (format, préfixes de documents refusés)', async ({ request }) => {
    const create = (inventoryPrefix) => request.post('/api/projects', { headers: H(), data: { code: `IP-${stamp}`, name: `Projet inventaire ${stamp}`, inventoryPrefix } });
    for (const [value, code] of [['INVT MSH', 'INVENTORY_PREFIX_INVALID'], ['INVT--X', 'INVENTORY_PREFIX_INVALID'], ['A'.repeat(21), 'INVENTORY_PREFIX_INVALID'], ['INV', 'INVENTORY_PREFIX_RESERVED'], ['inv-msh', 'INVENTORY_PREFIX_RESERVED']]) {
      const r = await json(await create(value));
      expect([r.status, r.body.code], value).toEqual([400, code]);
    }
    const r = await json(await create(prefix.toLowerCase()));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    project = (await (await request.get(`/api/projects/${r.body.data.id}`, { headers: H() })).json()).data;
    expect(project.inventory_prefix).toBe(prefix); // en majuscules
  });

  test('Équipements financés par le projet : <code initial>-AAAA-NNNNN, sans projet : INVT', async ({ request }) => {
    const tags = await register(request, project.id, [`SN-IP1-${stamp}`, `SN-IP2-${stamp}`]);
    expect(tags.sort()).toEqual([`${prefix}-${year}-00001`, `${prefix}-${year}-00002`]);
    const [plain] = await register(request, null, [`SN-IP3-${stamp}`]);
    expect(plain).toMatch(new RegExp(`^INVT-${year}-\\d{5}$`));
  });

  test('Code initial vidé : INVT ; n° déjà attribués inchangés ; changement tracé', async ({ request }) => {
    const r = await json(await request.put(`/api/projects/${project.id}`, { headers: H(), data: { ...project, projectManagerId: project.project_manager_id, isActive: true, inventoryPrefix: '' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await (await request.get(`/api/projects/${project.id}`, { headers: H() })).json()).data.inventory_prefix).toBeNull();
    const [tag] = await register(request, project.id, [`SN-IP4-${stamp}`]);
    expect(tag).toMatch(new RegExp(`^INVT-${year}-\\d{5}$`));
    const units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H() })).json()).data;
    expect(units.filter(u => u.asset_tag?.startsWith(`${prefix}-`))).toHaveLength(2);

    const logs = (await (await request.get('/api/audit-logs?action=PROJECT_INVENTORY_PREFIX_CHANGED&limit=20', { headers: H() })).json()).data;
    const entry = logs.find(l => l.entity_id === project.id || l.new_value?._label?.startsWith(`IP-${stamp}`));
    expect(entry?.new_value?.inventoryPrefix ?? null).toBeNull();
    expect(entry?.old_value?.inventoryPrefix).toBe(prefix);
  });
});

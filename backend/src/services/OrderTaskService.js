// src/services/OrderTaskService.js
// Tâches BpmnGo du cycle de commande (bon de commande → paiement). Elles vivent dans le sous-processus
// SubProcess_SupplierOrder du BPMN, répété une fois par part (migration 38_supplier_split.sql) : une réquisition
// répartie entre plusieurs fournisseurs a donc plusieurs tâches de même clé ouvertes en même temps (ex. deux
// réceptions). Chaque tâche voit les variables locales de sa part : supplierLotId (id de la part, 'MAIN' sans
// répartition) et poId (bon de commande de la part, une fois créé). Ce service retrouve LA tâche d'un bon de commande
// et le bon de commande d'une tâche. Processus démarrés avant (sans sous-processus) : aucune variable de part,
// comportement d'origine (une seule tâche de chaque clé).
const db = require('../config/database');
const camundaService = require('./CamundaService');

const MAIN_LOT = 'MAIN';
const ORDER_TASKS = ['Activity_CreatePO', 'Activity_POApproval', 'Activity_SupplierConfirmation', 'Activity_ServiceAcceptance',
  'Activity_GoodsReceipt', 'Activity_EnterInvoice', 'Activity_ProcessPayment'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// BpmnGo initialise les variables locales à 0 (source « =null ») : 0 / vide = pas encore de bon de commande
const idOf = (v) => (Number(v) > 0 ? Number(v) : null);
const lotIdOf = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

class OrderTaskService {
  get MAIN_LOT() { return MAIN_LOT; }
  get ORDER_TASKS() { return ORDER_TASKS; }

  /** { lotId (UUID d'une part, sinon null), poId } d'une tâche — variables lues dans BpmnGo */
  async varsOf(taskId) {
    try {
      const vars = await camundaService.getTaskVariables(taskId, ['supplierLotId', 'poId']);
      return { lotId: lotIdOf(vars.supplierLotId), poId: idOf(vars.poId) };
    } catch {
      return { lotId: null, poId: null };
    }
  }

  async openTasks(processInstanceId, keys) {
    if (!processInstanceId) return [];
    const list = Array.isArray(keys) ? keys : [keys];
    return ((await camundaService.getProcessTasks(processInstanceId)) || [])
      .filter(t => list.includes(t.taskDefinitionKey) && t.status !== 'completed');
  }

  /**
   * Tâche ouverte (clé ou liste de clés) de CE bon de commande, sinon null. taskId (envoyé par le client) n'est retenu
   * que s'il désigne une tâche de ce bon.
   */
  async findForPurchaseOrder(processInstanceId, keys, poId, taskId = null) {
    const tasks = await this.openTasks(processInstanceId, keys);
    if (!tasks.length) return null;
    const po = await db.one('SELECT id, supplier_lot_id FROM purchase_orders WHERE id = $1', [poId]);
    if (!po) return null;
    // Sans répartition et une seule tâche : pas besoin d'interroger BpmnGo (processus d'avant le sous-processus)
    if (!po.supplier_lot_id && tasks.length === 1) return tasks[0];
    const matches = [];
    for (const t of tasks) {
      const v = await this.varsOf(t.id);
      const ok = v.poId ? String(v.poId) === String(po.id)
        : v.lotId ? String(v.lotId) === String(po.supplier_lot_id)
          : !po.supplier_lot_id;
      if (ok) matches.push(t);
    }
    return matches.find(t => t.id === taskId) || matches[0] || null;
  }

  /** Tâche « Créer le bon de commande » d'une part (lotId null = sans répartition) */
  async findCreateTask(processInstanceId, lotId, taskId = null) {
    const tasks = await this.openTasks(processInstanceId, 'Activity_CreatePO');
    if (!tasks.length) return null;
    const matches = [];
    for (const t of tasks) {
      const v = tasks.length === 1 && !lotId ? { lotId: null } : await this.varsOf(t.id);
      if (String(v.lotId || '') === String(lotId || '')) matches.push(t);
    }
    return matches.find(t => t.id === taskId) || matches[0] || null;
  }

  /** Part d'une tâche (UUID) ou null — pour la création du bon de commande */
  async lotOfTask(taskId) {
    return (await this.varsOf(taskId)).lotId;
  }

  /**
   * Bon de commande d'une tâche du cycle de commande, sinon null (l'appelant garde alors sa règle d'origine : le
   * dernier bon de la réquisition)
   */
  async purchaseOrderOfTask(taskId) {
    const v = await this.varsOf(taskId);
    if (v.poId) return v.poId;
    if (v.lotId) return idOf((await db.one('SELECT po_id FROM requisition_supplier_lots WHERE id = $1', [v.lotId]))?.po_id);
    return null;
  }

  /**
   * Ajoute `lot` aux tâches du cycle de commande des réquisitions réparties :
   * { id, number, supplierId, supplierName, poId, poNumber }. Les autres tâches sont rendues telles quelles.
   */
  async withLots(tasks) {
    const list = tasks || [];
    const candidates = list.filter(t => ORDER_TASKS.includes(t.taskDefinitionKey) && t.status !== 'completed' && t.processInstanceId);
    if (!candidates.length) return list;
    const processIds = [...new Set(candidates.map(t => t.processInstanceId))];
    const lots = await db.select(
      `SELECT l.id, l.lot_number, l.supplier_id, s.name AS supplier_name, l.po_id, po.po_number, r.process_instance_id
       FROM requisition_supplier_lots l
       JOIN requisitions r ON r.id = l.requisition_id
       JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN purchase_orders po ON po.id = l.po_id
       WHERE r.process_instance_id = ANY($1)`,
      [processIds]
    );
    if (!lots.length) return list;
    const split = new Set(lots.map(l => l.process_instance_id));
    const byId = new Map(lots.map(l => [String(l.id), l]));
    const lotOf = new Map();
    await Promise.all(candidates.filter(t => split.has(t.processInstanceId)).map(async (t) => {
      const v = await this.varsOf(t.id);
      const l = v.lotId && byId.get(String(v.lotId));
      if (l) {
        lotOf.set(t.id, {
          id: l.id, number: l.lot_number, supplierId: l.supplier_id, supplierName: l.supplier_name,
          poId: idOf(l.po_id) || v.poId, poNumber: l.po_number || null,
        });
      }
    }));
    return list.map(t => (lotOf.has(t.id) ? { ...t, lot: lotOf.get(t.id) } : t));
  }
}

module.exports = new OrderTaskService();

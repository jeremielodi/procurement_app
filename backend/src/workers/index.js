// backend/src/workers/index.js
require('dotenv').config();

const axios = require('axios');
const debug = require('debug');

const logInfo = debug('worker:info');
const logError = debug('worker:error');
const logSuccess = debug('worker:success');
const logWarn = debug('worker:warn');
const logTask = debug('worker:task');
const logDebug = debug('worker:debug');
const logSocket = debug('worker:socket');

const requisitionModel = require('../models/RequisitionModel');
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const notificationService = require('../services/NotificationService');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');

const CAMUNDA_REST_URL = process.env.CAMUNDA_REST_URL || 'http://localhost:8080/engine-rest';
const USERNAME = process.env.CAMUNDA_USERNAME;
const PASSWORD = process.env.CAMUNDA_PASSWORD;

const camunda = axios.create({
  baseURL: CAMUNDA_REST_URL,
  auth: { username: USERNAME, password: PASSWORD },
  timeout: 30000
});

const WORKER_ID = `worker-${process.pid}`;
const MAX_TASKS = 10;
const LOCK_DURATION = 60000;

let io = null;

function setIo(ioInstance) {
  io = ioInstance;
  logSuccess('Socket.IO instance set in worker');
}

function emitNotification(userId, title, message, type, link) {
  if (io) {
    io.to(`user-${userId}`).emit('notification', {
      title, message, type, link,
      timestamp: new Date().toISOString()
    });
    logSocket('Notification sent to user %s: %s', userId, title);
  }
}

function emitRequisitionUpdate(requisitionId, data) {
  if (io) {
    io.to(`requisition-${requisitionId}`).emit('requisition-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    logSocket('Requisition update sent for %s', requisitionId);
  }
}

function emitPurchaseOrderUpdate(poId, data) {
  if (io) {
    io.to(`po-${poId}`).emit('po-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    logSocket('PO update sent for %s', poId);
  }
}

function emitWorkflowUpdate(processInstanceId, data) {
  if (io) {
    io.to(`workflow-${processInstanceId}`).emit('workflow-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    logSocket('Workflow update sent for %s', processInstanceId);
  }
}

function getVariableValue(variables, key) {
  return variables?.[key]?.value;
}

function formatVariables(variables) {
  const formatted = {};
  for (const [key, value] of Object.entries(variables)) {
    formatted[key] = { value, type: getVariableType(value) };
  }
  return formatted;
}

function getVariableType(value) {
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'Double';
  if (typeof value === 'boolean') return 'Boolean';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return 'Object';
  return 'String';
}

function parseJsonVariable(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

async function addWorkflowHistory(processInstanceId, entityType, entityId, taskId, taskName, action, comments) {
  try {
    await db.insert('workflow_history', {
      process_instance_id: processInstanceId,
      entity_type: entityType,
      entity_id: entityId,
      task_id: taskId,
      task_name: taskName,
      action: action,
      comments: comments,
      performed_at: new Date()
    });
  } catch (error) {
    logError('Error adding workflow history: %s', error.message);
  }
}

async function checkRequisitionExists(requisitionId) {
  try {
    const result = await db.one('SELECT COUNT(*) as count FROM requisitions WHERE id = $1', [requisitionId]);
    return parseInt(result.count) > 0;
  } catch (error) {
    logError('Error checking requisition existence: %s', error.message);
    return false;
  }
}

/**
 * Get the requester_id from the requisition linked to a PO.
 * POs have 'created_by' (the procurement officer), NOT the original requester.
 */
async function getRequesterIdForPO(po) {
  if (!po?.requisition_id) return null;
  try {
    const req = await db.one('SELECT requester_id FROM requisitions WHERE id = $1', [po.requisition_id]);
    return req?.requester_id || null;
  } catch {
    return null;
  }
}

async function closeTaskAndProcess(task, processInstanceId, reason) {
  logWarn('Closing task %s and terminating process %s - Reason: %s', task.id, processInstanceId, reason);

  try {
    await addWorkflowHistory(processInstanceId, 'requisition', null, task.id, 'Processus terminé', 'PROCESS_TERMINATED', reason);

    await camunda.post(`/process-instance/${processInstanceId}/delete`, { deleteReason: reason });

    await camunda.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: formatVariables({ processTerminated: true, terminationReason: reason })
    });

    logSuccess('Task %s closed and process %s terminated', task.id, processInstanceId);
  } catch (error) {
    logError('Error closing task %s: %s', task.id, error.message);
    await camunda.post(`/external-task/${task.id}/failure`, {
      workerId: WORKER_ID,
      errorMessage: reason,
      retries: 0,
      retryTimeout: 0
    });
  }
}

async function getFinanceUsers() {
  try {
    return await db.select(`
      SELECT u.id, u.email, u.first_name, u.last_name
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      JOIN profiles p ON up.profile_id = p.id
      WHERE p.id = 'prof_finance' AND u.is_active = true
    `);
  } catch (error) {
    logError('Error getting finance users: %s', error.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// External task handlers
// ─────────────────────────────────────────────────────────────────────────────

async function processCheckBudget(task) {
  logTask('[%s] Processing task: %s', 'check_budget', task.id);

  const processInstanceId = task.processInstanceId; // use directly — no getJobById needed
  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found', requisitionId);
    await closeTaskAndProcess(task, processInstanceId, `Réquisition ${requisitionId} non trouvée`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const estimatedAmount = getVariableValue(task.variables, 'estimatedAmount');
  const requesterId = getVariableValue(task.variables, 'requesterId');
  const requisitionNumber = getVariableValue(task.variables, 'requisitionNumber');
  const projectName = getVariableValue(task.variables, 'projectName');
  const items = getVariableValue(task.variables, 'items');

  const requisitionItems = parseJsonVariable(items);

  // Group items by budget line and check each
  const budgetGroups = new Map();
  for (const item of requisitionItems) {
    const budgetLineId = item.budgetLineId;
    const itemTotal = item.total || (item.quantity * (item.frequency || 1) * item.unitPrice);

    if (!budgetGroups.has(budgetLineId)) {
      budgetGroups.set(budgetLineId, {
        budgetLineId,
        budgetLineCode: item.budgetLineCode,
        budgetLineDescription: item.budgetLineDescription,
        items: [],
        totalAmount: 0
      });
    }
    const group = budgetGroups.get(budgetLineId);
    group.items.push(item);
    group.totalAmount += itemTotal;
  }

  const budgetResults = [];
  let allBudgetsAvailable = true;
  const insufficientBudgets = [];

  for (const [budgetLineId, group] of budgetGroups) {
    const budgetCheck = await requisitionModel.checkBudgetAvailability(budgetLineId, group.totalAmount);

    budgetResults.push({ ...group, ...budgetCheck });

    if (!budgetCheck.available) {
      allBudgetsAvailable = false;
      insufficientBudgets.push({
        budgetLineCode: group.budgetLineCode,
        budgetLineDescription: group.budgetLineDescription,
        requestedAmount: group.totalAmount,
        availableAmount: budgetCheck.availableAmount
      });
    }

    await addWorkflowHistory(
      processInstanceId, 'requisition', requisitionId, task.id,
      `Budget Check - ${group.budgetLineCode}`,
      budgetCheck.available ? 'Budget Available' : 'Budget Insufficient',
      `Line: ${group.budgetLineCode}, Available: ${budgetCheck.availableAmount}, Requested: ${group.totalAmount}`
    );
  }

  await addWorkflowHistory(
    processInstanceId, 'requisition', requisitionId, task.id,
    'Budget Check Summary',
    allBudgetsAvailable ? 'All Budgets Available' : 'Budget Insufficient',
    `Total: ${estimatedAmount}, Lines: ${budgetResults.length}, All OK: ${allBudgetsAvailable}`
  );

  if (requesterId) {
    if (allBudgetsAvailable) {
      emitNotification(requesterId, 'Budget vérifié ✅',
        `Tous les budgets pour la réquisition ${requisitionNumber} sont disponibles.`,
        'SUCCESS', `/requisitions/${requisitionId}`);
    } else {
      emitNotification(requesterId, 'Budget insuffisant ❌',
        `Budget insuffisant pour ${requisitionNumber}. Lignes concernées: ${insufficientBudgets.map(b => b.budgetLineCode).join(', ')}`,
        'ERROR', `/requisitions/${requisitionId}`);
    }
  }

  emitWorkflowUpdate(processInstanceId, {
    taskId: task.id, topic: 'check_budget', status: 'completed',
    result: { allBudgetsAvailable, budgetResults }
  });

  if (!allBudgetsAvailable) {
    const errorDetails = insufficientBudgets.map(b =>
      `${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`
    ).join('; ');

    await db.update('requisitions', {
      status: 'BUDGET_INSUFFICIENT',
      rejected_reason: `Budget insuffisant. ${errorDetails}`,
      updated_at: new Date()
    }, 'id', requisitionId);

    // Notify finance users
    const financeUsers = await getFinanceUsers();
    for (const financeUser of financeUsers) {
      emitNotification(financeUser.id, 'Alerte Budget Insuffisant ⚠️',
        `Budget insuffisant pour ${requisitionNumber}. Projet: ${projectName || '-'}`,
        'ERROR', '/budget');
    }

    await camundaService.terminateProcess(processInstanceId, {
      budgetAvailable: false,
      terminationReason: 'BUDGET_INSUFFICIENT'
    });

    return {
      budgetAvailable: false,
      allBudgetsAvailable: false,
      insufficientBudgets,
      processTerminated: true
    };
  }

  return {
    budgetAvailable: true,
    allBudgetsAvailable: true,
    budgetResults
  };
}

async function processClassifyProcurement(task) {
  logTask('[%s] Processing task: %s', 'classify_procurement', task.id);

  const processInstanceId = task.processInstanceId;
  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    await closeTaskAndProcess(task, processInstanceId, `Réquisition ${requisitionId} non trouvée`);
    return { processTerminated: true };
  }

  const estimatedAmount = getVariableValue(task.variables, 'estimatedAmount');
  const requesterId = getVariableValue(task.variables, 'requesterId');
  const requisitionNumber = getVariableValue(task.variables, 'requisitionNumber');

  const result = await requisitionModel.classifyProcurement(estimatedAmount, requisitionId);

  await addWorkflowHistory(
    processInstanceId, 'requisition', requisitionId, task.id,
    'Procurement Classification', result.procurementMethod, result.classificationReason
  );

  const methodLabels = {
    DIRECT_PURCHASE: 'Achat direct',
    MULTIPLE_QUOTATIONS: 'Multiples devis',
    RFP: "Appel d'offres",
    SOLE_SOURCE: 'Source unique'
  };

  if (requesterId) {
    emitNotification(requesterId, "Méthode d'achat déterminée",
      `Réquisition ${requisitionNumber} → ${methodLabels[result.procurementMethod] || result.procurementMethod}`,
      'INFO', `/requisitions/${requisitionId}`);
  }

  emitRequisitionUpdate(requisitionId, {
    status: `CLASSIFIED_${result.procurementMethod}`,
    procurementMethod: result.procurementMethod
  });

  emitWorkflowUpdate(processInstanceId, {
    taskId: task.id, topic: 'classify_procurement', status: 'completed',
    result: { procurementMethod: result.procurementMethod }
  });

  return { procurementMethod: result.procurementMethod };
}

async function processAnalyzeOffers(task) {
  logTask('[%s] Processing task: %s', 'analyze_offers', task.id);

  const processInstanceId = task.processInstanceId;
  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    await closeTaskAndProcess(task, processInstanceId, `Réquisition ${requisitionId} non trouvée`);
    return { processTerminated: true };
  }

  // offers may be stored as a JSON string in Camunda
  const offersRaw = getVariableValue(task.variables, 'offers');
  const offers = parseJsonVariable(offersRaw);
  const requesterId = getVariableValue(task.variables, 'requesterId');

  let bestOffer = null;
  let lowestAmount = Infinity;

  for (const offer of offers) {
    if ((offer.amount || 0) < lowestAmount) {
      lowestAmount = offer.amount;
      bestOffer = offer;
    }
  }

  const selectedSupplierId = bestOffer?.supplierId || null;
  const selectedAmount = bestOffer?.amount || 0;

  await addWorkflowHistory(
    processInstanceId, 'requisition', requisitionId, task.id,
    'Offer Analysis', 'Analyzed',
    `Selected supplier: ${selectedSupplierId}, Amount: ${selectedAmount}`
  );

  if (requesterId && bestOffer) {
    emitNotification(requesterId, 'Offres analysées',
      `Meilleure offre: ${bestOffer.supplierName} — ${selectedAmount}`,
      'SUCCESS', `/requisitions/${requisitionId}`);
  }

  emitWorkflowUpdate(processInstanceId, {
    taskId: task.id, topic: 'analyze_offers', status: 'completed',
    result: { selectedSupplierId, selectedAmount, analysisComplete: true }
  });

  return { selectedSupplierId, selectedAmount, analysisComplete: true };
}

async function processSendPONotification(task) {
  logTask('[%s] Processing task: %s', 'send_po_notification', task.id);

  const processInstanceId = task.processInstanceId;
  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    await closeTaskAndProcess(task, processInstanceId, `Réquisition ${requisitionId} non trouvée`);
    return { processTerminated: true };
  }

  const poId = getVariableValue(task.variables, 'poId');
  if (!poId) {
    logWarn('No poId in variables for send_po_notification, skipping email');
    return {};
  }

  const po = await purchaseOrderModel.findById(poId);
  if (!po) {
    logWarn('PO %s not found, skipping notification', poId);
    return {};
  }

  if (po.supplier_email) {
    await notificationService.sendEmail(
      po.supplier_email,
      `Purchase Order ${po.po_number}`,
      `<h1>Purchase Order ${po.po_number}</h1>
       <p>Dear ${po.supplier_name},</p>
       <p>Please find below your purchase order details.</p>
       <ul>
         <li>PO Number: ${po.po_number}</li>
         <li>Order Date: ${po.order_date}</li>
         <li>Delivery Date: ${po.delivery_date}</li>
         <li>Total Amount: ${po.total_amount} ${po.currency}</li>
       </ul>
       <p>Thank you for your business.</p>`
    );
    logSuccess('Email sent to supplier %s', po.supplier_email);
  } else {
    logWarn('No supplier email on PO %s, skipping email', po.po_number);
  }

  await addWorkflowHistory(
    processInstanceId, 'purchase_order', poId, task.id,
    'Send PO Notification', 'Sent', `PO ${po.po_number} sent to supplier`
  );

  emitPurchaseOrderUpdate(poId, { status: 'PO_SENT', po_number: po.po_number });

  // Notify the original requester (from the linked requisition, not the PO creator)
  const requesterId = await getRequesterIdForPO(po);
  if (requesterId) {
    emitNotification(requesterId, 'Commande envoyée',
      `La commande ${po.po_number} a été envoyée au fournisseur`,
      'SUCCESS', `/purchase-orders/${poId}`);
  }

  return {};
}

async function processInvoice(task) {
  logTask('[%s] Processing task: %s', 'process_invoice', task.id);

  const processInstanceId = task.processInstanceId;
  const poId = getVariableValue(task.variables, 'poId');
  const invoiceId = getVariableValue(task.variables, 'invoiceId');

  let isValid = false;
  let validationMessage = '';
  let matchStatus = 'PENDING';

  if (invoiceId) {
    // Invoice was created via InvoiceController — 3-way match already computed, just read it
    const inv = await db.one('SELECT match_status, total_amount, invoice_number FROM invoices WHERE id = $1', [invoiceId]);
    if (inv) {
      matchStatus = inv.match_status;
      isValid = matchStatus === 'MATCHED';
      validationMessage = `Facture ${inv.invoice_number} — rapprochement: ${matchStatus}`;
    } else {
      validationMessage = `Facture ${invoiceId} introuvable en base`;
    }
  } else {
    // Fallback: basic amount check using Camunda variables
    const invoiceAmount = parseFloat(getVariableValue(task.variables, 'invoiceAmount') || 0);
    const invoiceNumber = getVariableValue(task.variables, 'invoiceNumber');
    const grnCompliant  = getVariableValue(task.variables, 'grnCompliant');
    const po = poId ? await purchaseOrderModel.findById(poId) : null;

    if (po && invoiceAmount) {
      const amountOk = invoiceAmount <= parseFloat(po.total_amount) * 1.02;
      const grnOk = grnCompliant !== false;
      isValid = amountOk && grnOk;
      matchStatus = isValid ? 'MATCHED' : (amountOk ? 'GRN_PARTIAL' : 'PRICE_MISMATCH');
      validationMessage = isValid
        ? `Facture ${invoiceNumber} validée (${invoiceAmount} ≤ ${po.total_amount})`
        : `Rapprochement échoué: montant=${amountOk}, GRN=${grnOk}`;
    } else {
      validationMessage = 'Données insuffisantes pour le rapprochement';
    }
  }

  await addWorkflowHistory(
    processInstanceId, 'purchase_order', poId, task.id,
    'Invoice 3-Way Match', matchStatus, validationMessage
  );

  const po = poId ? await purchaseOrderModel.findById(poId) : null;
  const requesterId = await getRequesterIdForPO(po);
  if (requesterId) {
    emitNotification(requesterId,
      isValid ? 'Facture validée ✅' : 'Facture invalide ❌',
      validationMessage,
      isValid ? 'SUCCESS' : 'ERROR',
      `/purchase-orders/${poId}`);
  }

  if (poId) {
    emitPurchaseOrderUpdate(poId, { invoiceValid: isValid, matchStatus, validationMessage });
  }

  return { invoiceValid: isValid, paymentApproved: isValid, matchStatus };
}

async function processGoodsReceipt(task) {
  logTask('[%s] Processing task: %s', 'goods_receipt', task.id);

  const processInstanceId = task.processInstanceId;
  const poId = getVariableValue(task.variables, 'poId');
  const receivedBy = getVariableValue(task.variables, 'receivedBy');
  const observations = getVariableValue(task.variables, 'observations') || null;

  // grnItems: array of { item_description, quantity_ordered, quantity_received, quantity_accepted, quantity_rejected, rejection_reason }
  const grnItemsRaw = getVariableValue(task.variables, 'grnItems');
  const grnItems = parseJsonVariable(grnItemsRaw);

  const po = await purchaseOrderModel.findById(poId);

  // Generate GRN number
  const year = new Date().getFullYear();
  const countResult = await db.one(
    'SELECT COUNT(*) as count FROM goods_receipt_notes WHERE EXTRACT(YEAR FROM receipt_date) = $1',
    [year]
  );
  const grnNumber = `GRN-${year}-${String(parseInt(countResult.count) + 1).padStart(4, '0')}`;

  // Determine compliance: all items accepted without significant rejection
  const totalReceived = grnItems.reduce((s, i) => s + (i.quantity_received || 0), 0);
  const totalRejected = grnItems.reduce((s, i) => s + (i.quantity_rejected || 0), 0);
  const grnCompliant = totalReceived > 0 && totalRejected === 0;
  const receiptStatus = totalRejected > 0 ? 'PARTIAL' : (totalReceived > 0 ? 'COMPLETE' : 'PENDING');

  // Persist GRN to DB via GoodsReceiptModel (handles SERIAL id correctly)
  const grnModel = require('../models/GoodsReceiptModel');
  let grnId = null;
  try {
    const grnResult = await grnModel.create({ poId, receivedBy, grnItems, observations });
    grnId = grnResult.id;
    logSuccess('GRN %s created in DB (id=%s)', grnResult.grnNumber, grnId);
  } catch (dbErr) {
    logError('Error persisting GRN to DB: %s', dbErr.message);
  }

  await addWorkflowHistory(
    processInstanceId, 'purchase_order', poId, task.id,
    'Goods Receipt', receiptStatus,
    `GRN received: ${totalReceived}, rejected: ${totalRejected}`
  );

  const requesterId = await getRequesterIdForPO(po);
  if (requesterId) {
    emitNotification(requesterId, 'Marchandises reçues',
      `GRN enregistré pour la commande ${po?.po_number} — ${receiptStatus}`,
      'INFO', `/purchase-orders/${poId}`);
  }

  emitPurchaseOrderUpdate(poId, { receiptStatus, grnId });

  return { grnId, receiptStatus, grnCompliant };
}

async function processServiceAcceptance(task) {
  logTask('[%s] Processing task: %s', 'service_acceptance', task.id);

  const processInstanceId = task.processInstanceId;
  const poId = getVariableValue(task.variables, 'poId');
  const serviceQuality = getVariableValue(task.variables, 'serviceQuality');
  const acceptanceNotes = getVariableValue(task.variables, 'acceptanceNotes');

  const isAccepted = serviceQuality === 'GOOD' || serviceQuality === 'EXCELLENT';
  const sanNumber = `SAN-${Date.now()}`;

  await addWorkflowHistory(
    processInstanceId, 'purchase_order', poId, task.id,
    'Service Acceptance', isAccepted ? 'Accepted' : 'Rejected',
    acceptanceNotes || 'No notes'
  );

  const po = await purchaseOrderModel.findById(poId);
  const requesterId = await getRequesterIdForPO(po);
  if (requesterId) {
    emitNotification(requesterId,
      isAccepted ? 'Service accepté ✅' : 'Service refusé ❌',
      `Service pour la commande ${po?.po_number}: ${isAccepted ? 'accepté' : 'refusé'}`,
      isAccepted ? 'SUCCESS' : 'WARNING',
      `/purchase-orders/${poId}`);
  }

  emitPurchaseOrderUpdate(poId, {
    acceptanceStatus: isAccepted ? 'ACCEPTED' : 'REJECTED',
    sanNumber,
    acceptanceNotes
  });

  return { sanNumber, isAccepted, serviceAccepted: isAccepted, acceptanceNotes };
}

async function processUpdateSupplierRating(task) {
  logTask('[%s] Processing task: %s', 'update_supplier_rating', task.id);

  const processInstanceId = task.processInstanceId;
  const supplierId = getVariableValue(task.variables, 'supplierId');
  const rating = getVariableValue(task.variables, 'rating');
  const performanceNotes = getVariableValue(task.variables, 'performanceNotes');

  await db.update('suppliers', {
    rating,
    evaluation_comments: performanceNotes,
    last_evaluation_date: new Date()
  }, 'id', supplierId);

  await addWorkflowHistory(
    processInstanceId, 'supplier', supplierId, task.id,
    'Update Supplier Rating', 'Updated', `New rating: ${rating}`
  );

  return { ratingUpdated: true, newRating: rating };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task dispatch + polling
// ─────────────────────────────────────────────────────────────────────────────

async function processTask(task) {
  const topicName = task.topicName;
  try {
    let result;
    switch (topicName) {
      case 'check_budget':         result = await processCheckBudget(task);        break;
      case 'classify_procurement': result = await processClassifyProcurement(task); break;
      case 'analyze_offers':       result = await processAnalyzeOffers(task);       break;
      case 'send_po_notification': result = await processSendPONotification(task);  break;
      case 'process_invoice':      result = await processInvoice(task);             break;
      case 'goods_receipt':        result = await processGoodsReceipt(task);        break;
      case 'service_acceptance':   result = await processServiceAcceptance(task);   break;
      case 'update_supplier_rating': result = await processUpdateSupplierRating(task); break;
      default:
        logWarn('Unknown topic: %s', topicName);
        result = {};
    }

    // Don't re-complete if the handler already terminated the process
    if (!result?.processTerminated) {
      await camunda.post(`/external-task/${task.id}/complete`, {
        workerId: WORKER_ID,
        variables: formatVariables(result || {})
      });
      logSuccess('Task %s (%s) completed', task.id, topicName);
    }
  } catch (error) {
    logError('Error processing task %s (%s): %s', task.id, topicName, error.message);
    await camunda.post(`/external-task/${task.id}/failure`, {
      workerId: WORKER_ID,
      errorMessage: error.message,
      retries: 2,
      retryTimeout: 5000
    });
  }
}

async function fetchAndLockTasks() {
  try {
    const { data: tasks } = await camunda.post('/external-task/fetchAndLock', {
      workerId: WORKER_ID,
      maxTasks: MAX_TASKS,
      usePriority: true,
      lockDuration: LOCK_DURATION,
      topics: [
        { topicName: 'check_budget', lockDuration: LOCK_DURATION },
        { topicName: 'classify_procurement', lockDuration: LOCK_DURATION },
        { topicName: 'analyze_offers', lockDuration: LOCK_DURATION },
        { topicName: 'send_po_notification', lockDuration: LOCK_DURATION },
        { topicName: 'process_invoice', lockDuration: LOCK_DURATION },
        { topicName: 'goods_receipt', lockDuration: LOCK_DURATION },
        { topicName: 'service_acceptance', lockDuration: LOCK_DURATION },
        { topicName: 'update_supplier_rating', lockDuration: LOCK_DURATION }
      ]
    });
    return tasks;
  } catch (error) {
    if (error.response?.status !== 404) {
      logError('Error fetching tasks: %s', error.message);
    }
    return [];
  }
}

async function poll() {
  try {
    const tasks = await fetchAndLockTasks();
    if (tasks.length > 0) {
      logInfo('Received %d task(s) from Camunda', tasks.length);
      await Promise.all(tasks.map(task => processTask(task)));
    }
  } catch (error) {
    logError('Polling error: %s', error.message);
  }
}

async function checkConnection() {
  try {
    await camunda.get('/engine');
    logSuccess('Camunda connection successful');
    return true;
  } catch (error) {
    logError('Camunda connection failed: %s', error.message);
    return false;
  }
}

async function startWorkers() {
  logInfo('========================================');
  logInfo('🚀 Starting Camunda Workers');
  logInfo('Worker ID: %s', WORKER_ID);
  logInfo('Camunda URL: %s', CAMUNDA_REST_URL);
  logInfo('========================================');

  const connected = await checkConnection();
  if (!connected) {
    logWarn('Camunda unreachable — workers will retry on each poll');
  }

  await poll();
  setInterval(poll, 5000);
  setInterval(() => logInfo('Worker %s alive', WORKER_ID), 60000);
}

process.on('SIGINT', () => { logWarn('Shutting down workers...'); process.exit(0); });
process.on('SIGTERM', () => { logWarn('Shutting down workers...'); process.exit(0); });

startWorkers();

module.exports = { startWorkers, poll, setIo, emitNotification, emitRequisitionUpdate, emitPurchaseOrderUpdate, emitWorkflowUpdate };

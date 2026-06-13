// backend/src/workers/simple-worker.js
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
      title,
      message,
      type,
      link,
      timestamp: new Date().toISOString()
    });
    logSocket('Notification sent to user %s: %s', userId, title);
  } else {
    logWarn('Socket.IO not available, notification not sent to user %s', userId);
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
    formatted[key] = {
      value: value,
      type: getVariableType(value)
    };
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

async function closeTaskAndProcess(task, processInstanceId, reason) {
  logWarn('Closing task %s and terminating process %s - Reason: %s', task.id, processInstanceId, reason);

  try {
    await addWorkflowHistory(
      processInstanceId,
      'requisition',
      null,
      task.id,
      'Processus terminé',
      'PROCESS_TERMINATED',
      reason
    );

    await camunda.post(`/process-instance/${processInstanceId}/delete`, {
      deleteReason: reason
    });

    await camunda.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: formatVariables({
        processTerminated: true,
        terminationReason: reason
      })
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
    const users = await db.select(`
      SELECT u.id, u.email, u.first_name, u.last_name
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      JOIN profiles p ON up.profile_id = p.id
      WHERE p.name = 'Finance' AND u.is_active = true
    `);
    return users;
  } catch (error) {
    logError('Error getting finance users: %s', error.message);
    return [];
  }
}

async function processCheckBudget(task) {
  logTask('[%s] Processing task: %s', 'check_budget', task.id);

  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found, closing task and process', requisitionId);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const job = await camundaService.getJobById(task.id);
  const estimatedAmount = getVariableValue(task.variables, 'estimatedAmount');
  const budgetLine = getVariableValue(task.variables, 'budgetLine');
  const department = getVariableValue(task.variables, 'department');
  const requesterId = getVariableValue(task.variables, 'requesterId');
  const items = getVariableValue(task.variables, 'items');
  const requisitionNumber = getVariableValue(task.variables, 'requisitionNumber');
  const projectId = getVariableValue(task.variables, 'projectId');
  const projectName = getVariableValue(task.variables, 'projectName');

  let requisitionItems = [];
  try {
    requisitionItems = JSON.parse(items || '[]');
  } catch (error) {
    logError('Error parsing items: %s', error.message);
  }

  const budgetGroups = new Map();

  for (const item of requisitionItems) {
    const budgetLineId = item.budgetLineId;
    const itemTotal = item.total || (item.quantity * item.frequency * item.unitPrice);

    if (!budgetGroups.has(budgetLineId)) {
      budgetGroups.set(budgetLineId, {
        budgetLineId: budgetLineId,
        budgetLineCode: item.budgetLineCode,
        budgetLineDescription: item.budgetLineDescription,
        items: [],
        totalAmount: 0
      });
    }

    const group = budgetGroups.get(budgetLineId);
    group.items.push({
      description: item.description,
      quantity: item.quantity,
      frequency: item.frequency,
      unitPrice: item.unitPrice,
      total: itemTotal
    });
    group.totalAmount += itemTotal;
  }

  const budgetResults = [];
  let allBudgetsAvailable = true;
  let insufficientBudgets = [];

  for (const [budgetLineId, group] of budgetGroups) {
    logDebug('Checking budget for line: %s - Amount: %d', group.budgetLineCode, group.totalAmount);

    const budgetCheck = await requisitionModel.checkBudgetAvailability(budgetLineId, group.totalAmount);

    budgetResults.push({
      ...group,
      available: budgetCheck.available,
      availableAmount: budgetCheck.availableAmount,
      message: budgetCheck.message
    });

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
      job.processInstanceId,
      'requisition',
      requisitionId,
      task.id,
      `Budget Check - ${group.budgetLineCode}`,
      budgetCheck.available ? 'Budget Available' : 'Budget Insufficient',
      `Line: ${group.budgetLineCode}, Available: ${budgetCheck.availableAmount}, Requested: ${group.totalAmount}`
    );
  }

  await addWorkflowHistory(
    job.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Budget Check Summary',
    allBudgetsAvailable ? 'All Budgets Available' : 'Budget Insufficient',
    `Total amount: ${estimatedAmount}, Lines checked: ${budgetResults.length}, All available: ${allBudgetsAvailable}`
  );

  if (requesterId) {
    if (allBudgetsAvailable) {
      emitNotification(
        requesterId,
        'Budget vérifié ✅',
        `Tous les budgets pour la réquisition ${requisitionNumber} sont disponibles. Montant total: ${estimatedAmount}`,
        'SUCCESS',
        `/requisitions/${requisitionId}`
      );
    } else {
      const insufficientDetails = insufficientBudgets.map(b =>
        `- ${b.budgetLineCode} (${b.budgetLineDescription || 'Sans description'}): demandé ${b.requestedAmount}, disponible ${b.availableAmount}`
      ).join('\n');

      emitNotification(
        requesterId,
        'Budget insuffisant ❌',
        `Budget insuffisant pour la réquisition ${requisitionNumber} sur le projet ${projectName || 'Non spécifié'}.\n\nLignes concernées:\n${insufficientDetails}`,
        'ERROR',
        `/requisitions/${requisitionId}`
      );
    }
  }

  emitWorkflowUpdate(job.processInstanceId, {
    taskId: task.id,
    topic: 'check_budget',
    status: 'completed',
    result: {
      allBudgetsAvailable,
      budgetResults: budgetResults.map(r => ({
        budgetLineCode: r.budgetLineCode,
        available: r.available,
        availableAmount: r.availableAmount,
        requestedAmount: r.totalAmount
      }))
    }
  });

  if (!allBudgetsAvailable) {
    logWarn('Budget insufficient for requisition %s, closing process...', requisitionId);

    const errorDetails = insufficientBudgets.map(b =>
      `${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`
    ).join('; ');

    await addWorkflowHistory(
      task.processInstanceId,
      'requisition',
      requisitionId,
      task.id,
      'Processus fermé',
      'PROCESS_CLOSED',
      `Budget insuffisant. Détails: ${errorDetails}`
    );

    if (requesterId) {
      emitNotification(
        requesterId,
        'Processus arrêté ⛔',
        `Le processus d'achat pour la réquisition ${requisitionNumber} a été arrêté en raison d'un budget insuffisant.\n\nDétails:\n${insufficientBudgets.map(b => `- ${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`).join('\n')}\n\nVeuillez contacter le responsable financier pour un ajustement budgétaire.`,
        'WARNING',
        `/requisitions/${requisitionId}`
      );
    }

    const financeUsers = await getFinanceUsers();
    for (const financeUser of financeUsers) {
      emitNotification(
        financeUser.id,
        'Alerte Budget Insuffisant ⚠️',
        `Budget insuffisant sur le projet ${projectName || 'Non spécifié'} pour la réquisition ${requisitionNumber}.\n\nLignes concernées:\n${insufficientBudgets.map(b => `- ${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`).join('\n')}`,
        'ERROR',
        `/budget`
      );
    }

    emitRequisitionUpdate(requisitionId, {
      status: 'BUDGET_INSUFFICIENT',
      processClosed: true,
      reason: `Budget insuffisant: ${errorDetails}`,
      budgetDetails: insufficientBudgets
    });

    await db.update('requisitions', {
      status: 'BUDGET_INSUFFICIENT',
      rejected_reason: `Budget insuffisant. Détails: ${errorDetails}`,
      updated_at: new Date()
    }, 'id', requisitionId);

    await camundaService.terminateProcess(job.processInstanceId, {
      budgetAvailable: false,
      terminationReason: 'BUDGET_INSUFFICIENT',
      budgetDetails: insufficientBudgets,
      requestedAmount: estimatedAmount
    });

    return {
      budgetAvailable: false,
      allBudgetsAvailable: false,
      budgetResults: budgetResults,
      insufficientBudgets: insufficientBudgets,
      processTerminated: true
    };
  }

  return {
    budgetAvailable: true,
    allBudgetsAvailable: true,
    budgetResults: budgetResults,
    availableAmount: estimatedAmount
  };
}

async function processClassifyProcurement(task) {
  logTask('[%s] Processing task: %s', 'classify_procurement', task.id);

  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found, closing task and process', requisitionId);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const estimatedAmount = getVariableValue(task.variables, 'estimatedAmount');
  const requesterId = getVariableValue(task.variables, 'requesterId');
  const requisitionNumber = getVariableValue(task.variables, 'requisitionNumber');

  logDebug('Requisition: %s, Amount: %d', requisitionId, estimatedAmount);

  const result = await requisitionModel.classifyProcurement(estimatedAmount, requisitionId);

  logDebug('Method: %s, Reason: %s', result.procurementMethod, result.classificationReason);

  await addWorkflowHistory(
    task.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Procurement Classification',
    result.procurementMethod,
    result.classificationReason
  );

  if (requesterId) {
    const methodLabels = {
      'DIRECT_PURCHASE': 'Achat direct',
      'MULTIPLE_QUOTATIONS': 'Multiples devis',
      'RFP': 'Appel d\'offres',
      'SOLE_SOURCE': 'Source unique'
    };
    emitNotification(
      requesterId,
      'Méthode d\'achat déterminée',
      `La réquisition ${requisitionNumber} suivra la méthode: ${methodLabels[result.procurementMethod] || result.procurementMethod}`,
      'INFO',
      `/requisitions/${requisitionId}`
    );
  }

  emitRequisitionUpdate(requisitionId, {
    status: `CLASSIFIED_${result.procurementMethod}`,
    procurementMethod: result.procurementMethod
  });

  emitWorkflowUpdate(task.processInstanceId, {
    taskId: task.id,
    topic: 'classify_procurement',
    status: 'completed',
    result: {
      procurementMethod: result.procurementMethod,
      classificationReason: result.classificationReason
    }
  });

  return {
    procurementMethod: result.procurementMethod
  };
}

async function processAnalyzeOffers(task) {
  logTask('[%s] Processing task: %s', 'analyze_offers', task.id);

  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found, closing task and process', requisitionId);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const offers = getVariableValue(task.variables, 'offers') || [];
  const requesterId = getVariableValue(task.variables, 'requesterId');

  logDebug('Requisition: %s, Offers count: %d', requisitionId, offers.length);

  let bestOffer = null;
  let lowestAmount = Infinity;

  for (const offer of offers) {
    if (offer.amount < lowestAmount) {
      lowestAmount = offer.amount;
      bestOffer = offer;
    }
  }

  const selectedSupplierId = bestOffer?.supplierId || null;
  const selectedAmount = bestOffer?.amount || 0;

  logDebug('Best offer: Supplier %s, Amount: %d', selectedSupplierId, selectedAmount);

  await addWorkflowHistory(
    task.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Offer Analysis',
    'Analyzed',
    `Selected supplier: ${selectedSupplierId}, Amount: ${selectedAmount}`
  );

  if (requesterId && bestOffer) {
    emitNotification(
      requesterId,
      'Offres analysées',
      `La meilleure offre provient du fournisseur ${bestOffer.supplierName} au montant de ${selectedAmount}`,
      'SUCCESS',
      `/requisitions/${requisitionId}`
    );
  }

  emitWorkflowUpdate(task.processInstanceId, {
    taskId: task.id,
    topic: 'analyze_offers',
    status: 'completed',
    result: {
      selectedSupplierId,
      selectedAmount,
      analysisComplete: true
    }
  });

  return {
    selectedSupplierId: selectedSupplierId,
    selectedAmount: selectedAmount,
    analysisComplete: true
  };
}

async function processSendPONotification(task) {
  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found, closing task and process', requisitionId);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const poId = getVariableValue(task.variables, 'poId');
  const po = await purchaseOrderModel.findById(poId);

  logDebug('PO ID: %s, PO Number: %s', poId, po?.po_number);

  if (po && po.supplier_email) {
    logDebug('Sending email to: %s', po.supplier_email);

    await notificationService.sendEmail(
      po.supplier_email,
      `Purchase Order ${po.po_number}`,
      `
      <h1>Purchase Order ${po.po_number}</h1>
      <p>Dear ${po.supplier_name},</p>
      <p>Please find attached your purchase order.</p>
      <h3>Order Details:</h3>
      <ul>
        <li>PO Number: ${po.po_number}</li>
        <li>Order Date: ${po.order_date}</li>
        <li>Delivery Date: ${po.delivery_date}</li>
        <li>Total Amount: ${po.total_amount} ${po.currency}</li>
      </ul>
      <p>Thank you for your business.</p>
      `
    );

    logSuccess('Email sent successfully');
  } else {
    logWarn('No email found for supplier, skipping notification');
  }

  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Send PO Notification',
    'Sent',
    `PO ${po?.po_number} sent to supplier`
  );

  if (poId) {
    emitPurchaseOrderUpdate(poId, {
      status: 'PO_SENT',
      po_number: po?.po_number
    });
  }

  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      'Commande envoyée',
      `La commande ${po.po_number} a été envoyée au fournisseur`,
      'SUCCESS',
      `/purchase-orders/${poId}`
    );
  }

  return {};
}

async function processInvoice(task) {
  logTask('[%s] Processing task: %s', 'process_invoice', task.id);

  const requisitionId = getVariableValue(task.variables, 'requisitionId');

  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    logError('Requisition %s not found, closing task and process', requisitionId);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const poId = getVariableValue(task.variables, 'poId');
  const invoiceAmount = getVariableValue(task.variables, 'invoiceAmount');
  const invoiceNumber = getVariableValue(task.variables, 'invoiceNumber');

  logDebug('PO ID: %s, Invoice: %s, Amount: %d', poId, invoiceNumber, invoiceAmount);

  const po = await purchaseOrderModel.findById(poId);

  let isValid = false;
  let validationMessage = '';

  if (po && invoiceAmount) {
    isValid = invoiceAmount <= po.total_amount;
    validationMessage = isValid
      ? `Invoice amount ${invoiceAmount} is within PO total ${po.total_amount}`
      : `Invoice amount ${invoiceAmount} exceeds PO total ${po.total_amount}`;
  } else {
    validationMessage = 'Invalid PO or invoice amount';
  }

  logDebug('Validation: %s - %s', isValid ? 'PASSED' : 'FAILED', validationMessage);

  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Invoice Processing',
    isValid ? 'Valid' : 'Invalid',
    validationMessage
  );

  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      isValid ? 'Facture validée ✅' : 'Facture invalide ❌',
      validationMessage,
      isValid ? 'SUCCESS' : 'ERROR',
      `/purchase-orders/${poId}`
    );
  }

  if (poId) {
    emitPurchaseOrderUpdate(poId, {
      invoiceValid: isValid,
      invoiceNumber: invoiceNumber,
      validationMessage: validationMessage
    });
  }

  return {
    invoiceValid: isValid,
    paymentApproved: isValid,
    validationMessage: validationMessage
  };
}

async function processGoodsReceipt(task) {
  logTask('[%s] Processing task: %s', 'goods_receipt', task.id);

  const poId = getVariableValue(task.variables, 'poId');
  const receivedQuantity = getVariableValue(task.variables, 'receivedQuantity');
  const receivedBy = getVariableValue(task.variables, 'receivedBy');

  logDebug('PO ID: %s, Quantity: %d, Received by: %s', poId, receivedQuantity, receivedBy);

  const po = await purchaseOrderModel.findById(poId);

  const receiptStatus = receivedQuantity > 0 ? 'PARTIAL' : 'PENDING';
  const receiptNumber = `GRN-${Date.now()}`;

  logDebug('Receipt Number: %s, Status: %s', receiptNumber, receiptStatus);

  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Goods Receipt',
    receiptStatus,
    `Received quantity: ${receivedQuantity}`
  );

  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      'Marchandises reçues',
      `${receivedQuantity} articles reçus pour la commande ${po.po_number}`,
      'INFO',
      `/purchase-orders/${poId}`
    );
  }

  if (poId) {
    emitPurchaseOrderUpdate(poId, {
      receiptStatus: receiptStatus,
      receiptNumber: receiptNumber,
      receivedQuantity: receivedQuantity
    });
  }

  return {
    receiptNumber: receiptNumber,
    receiptStatus: receiptStatus,
    receiptComplete: receiptStatus === 'COMPLETE'
  };
}

async function processServiceAcceptance(task) {
  logTask('[%s] Processing task: %s', 'service_acceptance', task.id);

  const poId = getVariableValue(task.variables, 'poId');
  const serviceQuality = getVariableValue(task.variables, 'serviceQuality');
  const acceptanceNotes = getVariableValue(task.variables, 'acceptanceNotes');

  logDebug('PO ID: %s, Quality: %s, Notes: %s', poId, serviceQuality, acceptanceNotes);

  const isAccepted = serviceQuality === 'GOOD' || serviceQuality === 'EXCELLENT';
  const acceptanceNumber = `SAN-${Date.now()}`;

  logDebug('Acceptance Number: %s, Accepted: %s', acceptanceNumber, isAccepted);

  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Service Acceptance',
    isAccepted ? 'Accepted' : 'Rejected',
    acceptanceNotes || 'No notes provided'
  );

  const po = await purchaseOrderModel.findById(poId);

  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      isAccepted ? 'Service accepté ✅' : 'Service refusé ❌',
      `Le service pour la commande ${po.po_number} a été ${isAccepted ? 'accepté' : 'refusé'}`,
      isAccepted ? 'SUCCESS' : 'WARNING',
      `/purchase-orders/${poId}`
    );
  }

  if (poId) {
    emitPurchaseOrderUpdate(poId, {
      acceptanceStatus: isAccepted ? 'ACCEPTED' : 'REJECTED',
      acceptanceNumber: acceptanceNumber,
      acceptanceNotes: acceptanceNotes
    });
  }

  return {
    acceptanceNumber: acceptanceNumber,
    isAccepted: isAccepted,
    acceptanceNotes: acceptanceNotes
  };
}

async function processUpdateSupplierRating(task) {
  logTask('[%s] Processing task: %s', 'update_supplier_rating', task.id);

  const supplierId = getVariableValue(task.variables, 'supplierId');
  const rating = getVariableValue(task.variables, 'rating');
  const performanceNotes = getVariableValue(task.variables, 'performanceNotes');

  logDebug('Supplier ID: %s, Rating: %d, Notes: %s', supplierId, rating, performanceNotes);

  await db.update('suppliers', {
    rating: rating,
    evaluation_comments: performanceNotes,
    last_evaluation_date: new Date()
  }, 'id', supplierId);

  logSuccess('Supplier rating updated');

  await addWorkflowHistory(
    task.processInstanceId,
    'supplier',
    supplierId,
    task.id,
    'Update Supplier Rating',
    'Updated',
    `New rating: ${rating}`
  );

  return {
    ratingUpdated: true,
    newRating: rating
  };
}

async function processTask(task) {
  const topicName = task.topicName;

  try {
    let result;

    switch (topicName) {
      case 'check_budget':
        result = await processCheckBudget(task);
        break;
      case 'classify_procurement':
        result = await processClassifyProcurement(task);
        break;
      case 'analyze_offers':
        result = await processAnalyzeOffers(task);
        break;
      case 'send_po_notification':
        result = await processSendPONotification(task);
        break;
      case 'process_invoice':
        result = await processInvoice(task);
        break;
      case 'goods_receipt':
        result = await processGoodsReceipt(task);
        break;
      case 'service_acceptance':
        result = await processServiceAcceptance(task);
        break;
      case 'update_supplier_rating':
        result = await processUpdateSupplierRating(task);
        break;
      default:
        logWarn('Unknown topic: %s', topicName);
        result = {};
    }

    await camunda.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: formatVariables(result)
    });

    logSuccess('Task %s (%s) completed successfully', task.id, topicName);

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

    if (tasks.length === 0) {
      return;
    }

    logInfo('Received %d task(s) from Camunda', tasks.length);

    await Promise.all(tasks.map(task => processTask(task)));

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
  logInfo('========================================');
  logInfo('Camunda URL: %s', CAMUNDA_REST_URL);
  logInfo('Username: %s', USERNAME ? '✓ set' : '✗ not set');
  logInfo('Worker ID: %s', WORKER_ID);
  logInfo('Topics subscribed:');
  logInfo('   - check_budget');
  logInfo('   - classify_procurement');
  logInfo('   - analyze_offers');
  logInfo('   - send_po_notification');
  logInfo('   - process_invoice');
  logInfo('   - goods_receipt');
  logInfo('   - service_acceptance');
  logInfo('   - update_supplier_rating');
  logInfo('========================================');

  const connected = await checkConnection();
  if (!connected) {
    logWarn('Continuing but workers may not function correctly');
  }

  await poll();

  const POLLING_INTERVAL = 5000;
  setInterval(poll, POLLING_INTERVAL);

  logInfo('Polling every %d seconds...', POLLING_INTERVAL / 1000);

  setInterval(() => {
    logInfo('Worker %s alive - %s', WORKER_ID, new Date().toISOString());
  }, 60000);
}

process.on('SIGINT', () => {
  logWarn('Shutting down workers...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logWarn('Shutting down workers...');
  process.exit(0);
});

startWorkers();

module.exports = { startWorkers, poll, setIo, emitNotification, emitRequisitionUpdate, emitPurchaseOrderUpdate, emitWorkflowUpdate };
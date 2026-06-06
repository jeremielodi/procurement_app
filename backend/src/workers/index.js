// backend/src/workers/simple-worker.js
const axios = require('axios');
const requisitionModel = require('../models/RequisitionModel');
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const notificationService = require('../services/NotificationService');
const camundaService = require('../services/CamundaService');
 const db = require('../config/database');

const CAMUNDA_URL = process.env.CAMUNDA_URL || 'http://localhost:8080/engine-rest';
const USERNAME = process.env.CAMUNDA_USERNAME;
const PASSWORD = process.env.CAMUNDA_PASSWORD;

const camunda = axios.create({
  baseURL: CAMUNDA_URL,
  auth: { username: USERNAME, password: PASSWORD },
  timeout: 30000
});

// Configuration du worker
const WORKER_ID = `worker-${process.pid}`;
const MAX_TASKS = 10;
const LOCK_DURATION = 60000;

// Référence à l'instance Socket.IO
let io = null;

/**
 * Définir l'instance Socket.IO
 */
function setIo(ioInstance) {
  io = ioInstance;
  console.log('✅ Socket.IO instance set in worker');
}

/**
 * Émettre une notification via Socket.IO
 */
function emitNotification(userId, title, message, type, link) {
  if (io) {
    io.to(`user-${userId}`).emit('notification', {
      title,
      message,
      type,
      link,
      timestamp: new Date().toISOString()
    });
    console.log(`🔔 Notification sent to user ${userId}: ${title}`);
  } else {
    console.log(`⚠️ Socket.IO not available, notification not sent to user ${userId}`);
  }
}

/**
 * Émettre une mise à jour de réquisition
 */
function emitRequisitionUpdate(requisitionId, data) {
  if (io) {
    io.to(`requisition-${requisitionId}`).emit('requisition-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    console.log(`📝 Requisition update sent for ${requisitionId}`);
  }
}

/**
 * Émettre une mise à jour de commande
 */
function emitPurchaseOrderUpdate(poId, data) {
  if (io) {
    io.to(`po-${poId}`).emit('po-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    console.log(`📦 PO update sent for ${poId}`);
  }
}

/**
 * Émettre une mise à jour de workflow
 */
function emitWorkflowUpdate(processInstanceId, data) {
  if (io) {
    io.to(`workflow-${processInstanceId}`).emit('workflow-update', {
      ...data,
      timestamp: new Date().toISOString()
    });
    console.log(`🔄 Workflow update sent for ${processInstanceId}`);
  }
}

/**
 * Récupérer la valeur d'une variable Camunda
 */
function getVariableValue(variables, key) {
  return variables?.[key]?.value;
}

/**
 * Formater les variables pour Camunda
 */
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

/**
 * Déterminer le type de variable
 */
function getVariableType(value) {
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'Double';
  if (typeof value === 'boolean') return 'Boolean';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return 'Object';
  return 'String';
}

/**
 * Enregistrer dans l'historique du workflow
 */
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
    console.error('Error adding workflow history:', error);
  }
}



/**
 * Vérifier si une réquisition existe
 */
async function checkRequisitionExists(requisitionId) {
  try {
   
    const result = await db.one('SELECT COUNT(*) as count FROM requisitions WHERE id = $1', [requisitionId]);
    return parseInt(result.count) > 0;
  } catch (error) {
    console.error('Error checking requisition existence:', error);
    return false;
  }
}

/**
 * Fermer une tâche et terminer le processus si la réquisition n'existe pas
 */
async function closeTaskAndProcess(task, processInstanceId, reason) {
  console.log(`🚫 Closing task ${task.id} and terminating process ${processInstanceId} - Reason: ${reason}`);
  
  try {
    // Ajouter l'historique de fermeture
    await addWorkflowHistory(
      processInstanceId,
      'requisition',
      null,
      task.id,
      'Processus terminé',
      'PROCESS_TERMINATED',
      reason
    );
    
    // Terminer le processus Camunda
    await camunda.post(`/process-instance/${processInstanceId}/delete`, {
      deleteReason: reason
    });
    
    // Compléter la tâche pour éviter les boucles
    await camunda.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: formatVariables({
        processTerminated: true,
        terminationReason: reason
      })
    });
    
    console.log(`✅ Task ${task.id} closed and process ${processInstanceId} terminated`);
  } catch (error) {
    console.error(`Error closing task ${task.id}:`, error.message);
    // En cas d'erreur, marquer la tâche comme échouée avec retry=0
    await camunda.post(`/external-task/${task.id}/failure`, {
      workerId: WORKER_ID,
      errorMessage: reason,
      retries: 0,
      retryTimeout: 0
    });
  }
}

/**
 * Traiter la tâche check_budget
 */
async function processCheckBudget(task) {

  console.log(`📋 [check_budget] Processing task: ${task.id}`);
  
  const requisitionId = getVariableValue(task.variables, 'requisitionId');
  
  // Vérifier si la réquisition existe
  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    console.log(`❌ Requisition ${requisitionId} not found, closing task and process`);
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
    console.error('Error parsing items:', error);
  }

  // Grouper les items par budgetLineId et calculer les totaux
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

  // Vérifier le budget pour chaque groupe
  const budgetResults = [];
  let allBudgetsAvailable = true;
  let insufficientBudgets = [];

  for (const [budgetLineId, group] of budgetGroups) {
    console.log(`Checking budget for line: ${group.budgetLineCode} - Amount: ${group.totalAmount}`);
    
    // Vérifier la disponibilité du budget
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
    
    // Enregistrer dans l'historique pour chaque ligne budgétaire
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

  // Enregistrer le résumé dans l'historique
  await addWorkflowHistory(
    job.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Budget Check Summary',
    allBudgetsAvailable ? 'All Budgets Available' : 'Budget Insufficient',
    `Total amount: ${estimatedAmount}, Lines checked: ${budgetResults.length}, All available: ${allBudgetsAvailable}`
  );

  // Émettre une notification
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
      // Construire un message détaillé des budgets insuffisants
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

  // Émettre une mise à jour du workflow
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

  // SI UN BUDGET N'EST PAS DISPONIBLE, FERMER LE PROCESSUS
  if (!allBudgetsAvailable) {
    console.log(`🚫 Budget insufficient for requisition ${requisitionId}, closing process...`);
    
    // Construire le message d'erreur détaillé
    const errorDetails = insufficientBudgets.map(b => 
      `${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`
    ).join('; ');
    
    // Ajouter un historique de fermeture
    await addWorkflowHistory(
      task.processInstanceId,
      'requisition',
      requisitionId,
      task.id,
      'Processus fermé',
      'PROCESS_CLOSED',
      `Budget insuffisant. Détails: ${errorDetails}`
    );

    // Émettre une notification supplémentaire de fermeture au demandeur
    if (requesterId) {
      emitNotification(
        requesterId,
        'Processus arrêté ⛔',
        `Le processus d'achat pour la réquisition ${requisitionNumber} a été arrêté en raison d'un budget insuffisant.\n\nDétails:\n${insufficientBudgets.map(b => `- ${b.budgetLineCode}: ${b.requestedAmount} demandé, ${b.availableAmount} disponible`).join('\n')}\n\nVeuillez contacter le responsable financier pour un ajustement budgétaire.`,
        'WARNING',
        `/requisitions/${requisitionId}`
      );
    }
    
    // Émettre une notification au finance (responsable budget)
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

    // Émettre une mise à jour de la réquisition
    emitRequisitionUpdate(requisitionId, {
      status: 'BUDGET_INSUFFICIENT',
      processClosed: true,
      reason: `Budget insuffisant: ${errorDetails}`,
      budgetDetails: insufficientBudgets
    });

    // Mettre à jour le statut de la réquisition
    await db.update('requisitions', {
      status: 'BUDGET_INSUFFICIENT',
      rejected_reason: `Budget insuffisant. Détails: ${errorDetails}`,
      updated_at: new Date()
    }, 'id', requisitionId);

    // Terminer le processus Camunda
    await camundaService.terminateProcess(job.processInstanceId, {
      budgetAvailable: false,
      terminationReason: 'BUDGET_INSUFFICIENT',
      budgetDetails: insufficientBudgets,
      requestedAmount: estimatedAmount
    });
    
    // Retourner les résultats pour la tâche (ne pas faire échouer la tâche)
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

/**
 * Récupérer les utilisateurs finance
 */
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
    console.error('Error getting finance users:', error);
    return [];
  }
}
/**
 * Traiter la tâche classify_procurement
 */
async function processClassifyProcurement(task) {
  console.log(`📋 [classify_procurement] Processing task: ${task.id}`);

   
  const requisitionId = getVariableValue(task.variables, 'requisitionId');
  
  // Vérifier si la réquisition existe
  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    console.log(`❌ Requisition ${requisitionId} not found, closing task and process`);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }
  

  
  const estimatedAmount = getVariableValue(task.variables, 'estimatedAmount');
  const requesterId = getVariableValue(task.variables, 'requesterId');
  const requisitionNumber = getVariableValue(task.variables, 'requisitionNumber');

  console.log(`   Requisition: ${requisitionId}, Amount: ${estimatedAmount}`);

  // Appeler la logique métier
  const result = await requisitionModel.classifyProcurement(estimatedAmount, requisitionId);

  console.log(`   Method: ${result.procurementMethod}, Reason: ${result.classificationReason}`);

  // Enregistrer dans l'historique
  await addWorkflowHistory(
    task.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Procurement Classification',
    result.procurementMethod,
    result.classificationReason
  );

  // Émettre une notification
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

  // Émettre une mise à jour de la réquisition
  emitRequisitionUpdate(requisitionId, {
    status: `CLASSIFIED_${result.procurementMethod}`,
    procurementMethod: result.procurementMethod
  });

  // Émettre une mise à jour du workflow
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

/**
 * Traiter la tâche analyze_offers
 */
async function processAnalyzeOffers(task) {
  console.log(`📋 [analyze_offers] Processing task: ${task.id}`);

  const requisitionId = getVariableValue(task.variables, 'requisitionId');
  
  // Vérifier si la réquisition existe
  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    console.log(`❌ Requisition ${requisitionId} not found, closing task and process`);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }


  const offers = getVariableValue(task.variables, 'offers') || [];
  const requesterId = getVariableValue(task.variables, 'requesterId');

  console.log(`   Requisition: ${requisitionId}, Offers count: ${offers.length}`);

  // Logique d'analyse des offres
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

  console.log(`   Best offer: Supplier ${selectedSupplierId}, Amount: ${selectedAmount}`);

  // Enregistrer dans l'historique
  await addWorkflowHistory(
    task.processInstanceId,
    'requisition',
    requisitionId,
    task.id,
    'Offer Analysis',
    'Analyzed',
    `Selected supplier: ${selectedSupplierId}, Amount: ${selectedAmount}`
  );

  // Émettre une notification
  if (requesterId && bestOffer) {
    emitNotification(
      requesterId,
      'Offres analysées',
      `La meilleure offre provient du fournisseur ${bestOffer.supplierName} au montant de ${selectedAmount}`,
      'SUCCESS',
      `/requisitions/${requisitionId}`
    );
  }

  // Émettre une mise à jour du workflow
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

/**
 * Traiter la tâche send_po_notification
 */
async function processSendPONotification(task) {
  
  const requisitionId = getVariableValue(task.variables, 'requisitionId');
  
  // Vérifier si la réquisition existe
  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    console.log(`❌ Requisition ${requisitionId} not found, closing task and process`);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }
  
  const poId = getVariableValue(task.variables, 'poId');
  const po = await purchaseOrderModel.findById(poId);

  console.log(`   PO ID: ${poId}, PO Number: ${po?.po_number}`);

  if (po && po.supplier_email) {
    console.log(`   Sending email to: ${po.supplier_email}`);

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

    console.log(`   ✅ Email sent successfully`);
  } else {
    console.log(`   ⚠️ No email found for supplier, skipping notification`);
  }

  // Enregistrer dans l'historique
  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Send PO Notification',
    'Sent',
    `PO ${po?.po_number} sent to supplier`
  );

  // Émettre une mise à jour de la commande
  if (poId) {
    emitPurchaseOrderUpdate(poId, {
      status: 'PO_SENT',
      po_number: po?.po_number
    });
  }

  // Émettre une notification au demandeur
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

/**
 * Traiter la tâche process_invoice
 */
async function processInvoice(task) {
  console.log(`📋 [process_invoice] Processing task: ${task.id}`);


  const requisitionId = getVariableValue(task.variables, 'requisitionId');
  
  // Vérifier si la réquisition existe
  const requisitionExists = await checkRequisitionExists(requisitionId);
  if (!requisitionExists) {
    console.log(`❌ Requisition ${requisitionId} not found, closing task and process`);
    await closeTaskAndProcess(task, task.processInstanceId, `Réquisition ${requisitionId} non trouvée dans la base de données`);
    return { processTerminated: true, reason: 'REQUISITION_NOT_FOUND' };
  }

  const poId = getVariableValue(task.variables, 'poId');
  const invoiceAmount = getVariableValue(task.variables, 'invoiceAmount');
  const invoiceNumber = getVariableValue(task.variables, 'invoiceNumber');

  console.log(`   PO ID: ${poId}, Invoice: ${invoiceNumber}, Amount: ${invoiceAmount}`);

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

  console.log(`   Validation: ${isValid ? 'PASSED' : 'FAILED'} - ${validationMessage}`);

  // Enregistrer dans l'historique
  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Invoice Processing',
    isValid ? 'Valid' : 'Invalid',
    validationMessage
  );

  // Émettre une notification
  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      isValid ? 'Facture validée ✅' : 'Facture invalide ❌',
      validationMessage,
      isValid ? 'SUCCESS' : 'ERROR',
      `/purchase-orders/${poId}`
    );
  }

  // Émettre une mise à jour de la commande
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

/**
 * Traiter la tâche goods_receipt
 */
async function processGoodsReceipt(task) {
  console.log(`📋 [goods_receipt] Processing task: ${task.id}`);

  const poId = getVariableValue(task.variables, 'poId');
  const receivedQuantity = getVariableValue(task.variables, 'receivedQuantity');
  const receivedBy = getVariableValue(task.variables, 'receivedBy');

  console.log(`   PO ID: ${poId}, Quantity: ${receivedQuantity}, Received by: ${receivedBy}`);

  const po = await purchaseOrderModel.findById(poId);

  // Logique de réception des marchandises
  const receiptStatus = receivedQuantity > 0 ? 'PARTIAL' : 'PENDING';
  const receiptNumber = `GRN-${Date.now()}`;

  console.log(`   Receipt Number: ${receiptNumber}, Status: ${receiptStatus}`);

  // Enregistrer dans l'historique
  await addWorkflowHistory(
    task.processInstanceId,
    'purchase_order',
    poId,
    task.id,
    'Goods Receipt',
    receiptStatus,
    `Received quantity: ${receivedQuantity}`
  );

  // Émettre une notification
  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      'Marchandises reçues',
      `${receivedQuantity} articles reçus pour la commande ${po.po_number}`,
      'INFO',
      `/purchase-orders/${poId}`
    );
  }

  // Émettre une mise à jour de la commande
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

/**
 * Traiter la tâche service_acceptance
 */
async function processServiceAcceptance(task) {
  console.log(`📋 [service_acceptance] Processing task: ${task.id}`);

  const poId = getVariableValue(task.variables, 'poId');
  const serviceQuality = getVariableValue(task.variables, 'serviceQuality');
  const acceptanceNotes = getVariableValue(task.variables, 'acceptanceNotes');

  console.log(`   PO ID: ${poId}, Quality: ${serviceQuality}, Notes: ${acceptanceNotes}`);

  // Logique d'acceptation de service
  const isAccepted = serviceQuality === 'GOOD' || serviceQuality === 'EXCELLENT';
  const acceptanceNumber = `SAN-${Date.now()}`;

  console.log(`   Acceptance Number: ${acceptanceNumber}, Accepted: ${isAccepted}`);

  // Enregistrer dans l'historique
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

  // Émettre une notification
  if (po?.requester_id) {
    emitNotification(
      po.requester_id,
      isAccepted ? 'Service accepté ✅' : 'Service refusé ❌',
      `Le service pour la commande ${po.po_number} a été ${isAccepted ? 'accepté' : 'refusé'}`,
      isAccepted ? 'SUCCESS' : 'WARNING',
      `/purchase-orders/${poId}`
    );
  }

  // Émettre une mise à jour de la commande
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

/**
 * Traiter la tâche update_supplier_rating
 */
async function processUpdateSupplierRating(task) {
  console.log(`📋 [update_supplier_rating] Processing task: ${task.id}`);

  const supplierId = getVariableValue(task.variables, 'supplierId');
  const rating = getVariableValue(task.variables, 'rating');
  const performanceNotes = getVariableValue(task.variables, 'performanceNotes');

  console.log(`   Supplier ID: ${supplierId}, Rating: ${rating}, Notes: ${performanceNotes}`);

  // Mettre à jour la note du fournisseur
  await db.update('suppliers', {
    rating: rating,
    evaluation_comments: performanceNotes,
    last_evaluation_date: new Date()
  }, 'id', supplierId);

  console.log(`   ✅ Supplier rating updated`);

  // Enregistrer dans l'historique
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

/**
 * Router vers le bon handler selon le topic
 */
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
        console.log(`⚠️ Unknown topic: ${topicName}`);
        result = {};
    }

    // Compléter la tâche avec les résultats
    await camunda.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: formatVariables(result)
    });

    console.log(`✅ Task ${task.id} (${topicName}) completed successfully`);

  } catch (error) {
    console.error(`❌ Error processing task ${task.id} (${topicName}):`, error.message);

    // Signaler l'échec à Camunda
    await camunda.post(`/external-task/${task.id}/failure`, {
      workerId: WORKER_ID,
      errorMessage: error.message,
      retries: 2,
      retryTimeout: 5000
    });
  }
}

/**
 * Récupérer et verrouiller les tâches externes
 */
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
      console.error('Error fetching tasks:', error.message);
    }
    return [];
  }
}

/**
 * Boucle principale de polling
 */
async function poll() {
  try {
    const tasks = await fetchAndLockTasks();

    if (tasks.length === 0) {
      // Pas de tâches, silence
      return;
    }

    console.log(`\n📨 Received ${tasks.length} task(s) from Camunda`);

    // Traiter les tâches en parallèle
    await Promise.all(tasks.map(task => processTask(task)));

  } catch (error) {
    console.error('Polling error:', error.message);
  }
}

/**
 * Vérifier la connexion à Camunda
 */
async function checkConnection() {
  try {
    await camunda.get('/engine');
    console.log('✅ Camunda connection successful');
    return true;
  } catch (error) {
    console.error('❌ Camunda connection failed:', error.message);
    return false;
  }
}

/**
 * Démarrer les workers
 */
async function startWorkers() {
  console.log('========================================');
  console.log('🚀 Starting Camunda Workers');
  console.log('========================================');
  console.log(`📡 Camunda URL: ${CAMUNDA_URL}`);
  console.log(`🔐 Username: ${USERNAME ? '✓ set' : '✗ not set'}`);
  console.log(`🆔 Worker ID: ${WORKER_ID}`);
  console.log(`📋 Topics subscribed:`);
  console.log(`   - check_budget`);
  console.log(`   - classify_procurement`);
  console.log(`   - analyze_offers`);
  console.log(`   - send_po_notification`);
  console.log(`   - process_invoice`);
  console.log(`   - goods_receipt`);
  console.log(`   - service_acceptance`);
  console.log(`   - update_supplier_rating`);
  console.log('========================================\n');

  const connected = await checkConnection();
  if (!connected) {
    console.log('⚠️ Continuing but workers may not function correctly\n');
  }

  // Premier poll immédiat
  await poll();

  // Puis intervalle régulier
  const POLLING_INTERVAL = 5000; // 5 secondes
  setInterval(poll, POLLING_INTERVAL);

  console.log(`⏳ Polling every ${POLLING_INTERVAL / 1000} seconds...\n`);

  // Heartbeat toutes les minutes
  setInterval(() => {
    console.log(`💓 Worker ${WORKER_ID} alive - ${new Date().toISOString()}`);
  }, 60000);
}

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down workers...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down workers...');
  process.exit(0);
});

// Démarrer
startWorkers();

module.exports = { startWorkers, poll, setIo, emitNotification, emitRequisitionUpdate, emitPurchaseOrderUpdate, emitWorkflowUpdate };
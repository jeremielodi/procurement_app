module.exports = (camundaClient, pool, io) => {
  camundaClient.subscribe('classifyProcurement', async ({ task, taskService }) => {
    try {
      const { requisitionId, estimatedAmount, requisitionItems } = task.variables.getAll();
      
      let procurementMethod = '';
      let classificationReason = '';
      
      // Classification logic based on amount
      const directPurchaseThreshold = 5000;
      const quotationThreshold = 25000;
      
      if (parseFloat(estimatedAmount) <= directPurchaseThreshold) {
        procurementMethod = 'DIRECT_PURCHASE';
        classificationReason = 'Amount below direct purchase threshold';
      } else if (parseFloat(estimatedAmount) <= quotationThreshold) {
        procurementMethod = 'MULTIPLE_QUOTATIONS';
        classificationReason = 'Amount requires multiple quotations';
      } else {
        procurementMethod = 'RFP';
        classificationReason = 'Amount requires formal tender process';
      }
      
      // Check for sole source justification
      const soleSourceCheck = await pool.query(
        `SELECT * FROM sole_source_justifications WHERE requisition_id = $1`,
        [requisitionId]
      );
      
      if (soleSourceCheck.rows.length > 0 && soleSourceCheck.rows[0].approved) {
        procurementMethod = 'SOLE_SOURCE';
        classificationReason = 'Approved sole source justification';
      }
      
      // Update requisition
      await pool.query(
        `UPDATE requisitions 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [`CLASSIFIED_${procurementMethod}`, requisitionId]
      );
      
      // Record classification
      await pool.query(
        `INSERT INTO workflow_history (process_instance_id, entity_type, entity_id, task_name, action, comments, performed_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [task.processInstanceId, 'requisition', requisitionId, 'Procurement Classification', 
         `Method: ${procurementMethod}`, classificationReason]
      );
      
      // Notify
      io.to(`workflow-${task.processInstanceId}`).emit('classified', {
        requisitionId,
        procurementMethod,
        classificationReason
      });
      
      await taskService.complete(task, {
        procurementMethod,
        classificationReason
      });
      
    } catch (error) {
      console.error('Classification service error:', error);
      await taskService.handleFailure(task, {
        errorMessage: 'Failed to classify procurement method',
        errorDetails: error.message,
        retries: 2,
        retryTimeout: 5000
      });
    }
  });
};
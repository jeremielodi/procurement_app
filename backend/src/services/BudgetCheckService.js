module.exports = (camundaClient, pool, io) => {
  camundaClient.subscribe('budgetCheck', async ({ task, taskService }) => {
    try {
      const { requisitionId, estimatedAmount, budgetLine, department } = task.variables.getAll();
      
      // Check budget availability from database
      const result = await pool.query(
        `SELECT * FROM budget_allocations 
         WHERE budget_line = $1 AND department = $2 AND fiscal_year = $3`,
        [budgetLine, department, new Date().getFullYear()]
      );
      
      let budgetAvailable = false;
      let availableAmount = 0;
      
      if (result.rows.length > 0) {
        const budget = result.rows[0];
        availableAmount = budget.allocated_amount - budget.utilized_amount;
        budgetAvailable = availableAmount >= parseFloat(estimatedAmount);
      }
      
      // Update requisition with budget check result
      await pool.query(
        `UPDATE requisitions 
         SET status = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [budgetAvailable ? 'BUDGET_CHECKED' : 'BUDGET_INSUFFICIENT', requisitionId]
      );
      
      // Record workflow history
      await pool.query(
        `INSERT INTO workflow_history (process_instance_id, entity_type, entity_id, task_name, action, performed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [task.processInstanceId, 'requisition', requisitionId, 'Budget Check', 
         budgetAvailable ? 'Budget Available' : 'Budget Insufficient']
      );
      
      // Notify via socket
      io.to(`workflow-${task.processInstanceId}`).emit('budget-checked', {
        requisitionId,
        budgetAvailable,
        availableAmount,
        requestedAmount: parseFloat(estimatedAmount)
      });
      
      // Complete the task
      await taskService.complete(task, {
        budgetAvailable,
        availableAmount,
        requestedAmount: parseFloat(estimatedAmount)
      });
      
    } catch (error) {
      console.error('Budget check service error:', error);
      await taskService.handleFailure(task, {
        errorMessage: 'Failed to check budget availability',
        errorDetails: error.message,
        retries: 2,
        retryTimeout: 5000
      });
    }
  });
};
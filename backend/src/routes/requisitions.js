const express = require('express');
const router = express.Router();

module.exports = (pool, io) => {
  // Create new requisition and start workflow
  router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        title, description, department, projectCode, budgetLine,
        estimatedAmount, currency, priority, justification, items
      } = req.body;
      
      const userId = req.user?.id || 1; // Should come from auth middleware
      
      // Generate requisition number
      const year = new Date().getFullYear();
      const countResult = await client.query(
        "SELECT COUNT(*) FROM requisitions WHERE EXTRACT(YEAR FROM created_at) = $1",
        [year]
      );
      const requisitionNumber = `REQ-${year}-${String(parseInt(countResult.rows[0].count) + 1).padStart(4, '0')}`;
      
      // Create requisition
      const requisitionResult = await client.query(
        `INSERT INTO requisitions 
         (requisition_number, title, description, department, project_code, 
          budget_line, estimated_amount, currency, requester_id, status, 
          priority, justification)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [requisitionNumber, title, description, department, projectCode,
         budgetLine, estimatedAmount, currency, userId, 'DRAFT',
         priority, justification]
      );
      
      const requisitionId = requisitionResult.rows[0].id;
      
      // Add requisition items
      for (const item of items) {
        await client.query(
          `INSERT INTO requisition_items 
           (requisition_id, item_description, quantity, unit_price, total_amount, specifications)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [requisitionId, item.description, item.quantity, 
           item.unitPrice, item.quantity * item.unitPrice, item.specifications]
        );
      }
      
      await client.query('COMMIT');
      
      // Start Camunda workflow
      const camundaRestUrl = `${process.env.CAMUNDA_URL}/process-definition/key/ProcurementProcess/start`;
      
      const workflowStart = await fetch(camundaRestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: {
            requisitionId: { value: requisitionId, type: 'Integer' },
            requisitionNumber: { value: requisitionNumber, type: 'String' },
            requester: { value: userId.toString(), type: 'String' },
            estimatedAmount: { value: estimatedAmount, type: 'Double' },
            department: { value: department, type: 'String' },
            budgetLine: { value: budgetLine, type: 'String' },
            description: { value: description, type: 'String' }
          }
        })
      });
      
    
      const workflowResult = await workflowStart.json();
      
      // Update requisition with process instance ID
      await pool.query(
        'UPDATE requisitions SET process_instance_id = $1 WHERE id = $2',
        [workflowResult.id, requisitionId]
      );
      
      res.status(201).json({
        message: 'Requisition created successfully',
        requisitionId,
        requisitionNumber,
        processInstanceId: workflowResult.id
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating requisition:', error);
      res.status(500).json({ error: 'Failed to create requisition' });
    } finally {
      client.release();
    }
  });
  
  // Get requisition with details
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const requisition = await pool.query(
        `SELECT r.*, u.first_name, u.last_name 
         FROM requisitions r
         LEFT JOIN users u ON r.requester_id = u.id
         WHERE r.id = $1`,
        [id]
      );
      
      if (requisition.rows.length === 0) {
        return res.status(404).json({ error: 'Requisition not found' });
      }
      
      const items = await pool.query(
        'SELECT * FROM requisition_items WHERE requisition_id = $1',
        [id]
      );
      
      const attachments = await pool.query(
        "SELECT * FROM attachments WHERE entity_type = 'requisition' AND entity_id = $1",
        [id]
      );
      
      const history = await pool.query(
        `SELECT * FROM workflow_history 
         WHERE entity_type = 'requisition' AND entity_id = $1 
         ORDER BY performed_at DESC`,
        [id]
      );
      
      res.json({
        ...requisition.rows[0],
        items: items.rows,
        attachments: attachments.rows,
        history: history.rows
      });
      
    } catch (error) {
      console.error('Error fetching requisition:', error);
      res.status(500).json({ error: 'Failed to fetch requisition' });
    }
  });
  
  // Get requisitions with filters
  router.get('/', async (req, res) => {
    try {
      const { status, department, fromDate, toDate, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;
      
      let query = `
        SELECT r.*, u.first_name, u.last_name
        FROM requisitions r
        LEFT JOIN users u ON r.requester_id = u.id
        WHERE 1=1
      `;
      const params = [];
      
      if (status) {
        params.push(status);
        query += ` AND r.status = $${params.length}`;
      }
      
      if (department) {
        params.push(department);
        query += ` AND r.department = $${params.length}`;
      }
      
      if (fromDate) {
        params.push(fromDate);
        query += ` AND r.created_at >= $${params.length}`;
      }
      
      if (toDate) {
        params.push(toDate);
        query += ` AND r.created_at <= $${params.length}`;
      }
      
      query += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      
      const countQuery = `SELECT COUNT(*) FROM requisitions r WHERE 1=1 ${status ? 'AND status = $1' : ''}`;
      const countResult = await pool.query(countQuery, status ? [status] : []);
      
      res.json({
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          pages: Math.ceil(countResult.rows[0].count / limit)
        }
      });
      
    } catch (error) {
      console.error('Error fetching requisitions:', error);
      res.status(500).json({ error: 'Failed to fetch requisitions' });
    }
  });
  
  return router;
};
const sanModel       = require('../models/ServiceAcceptanceModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');

class ServiceAcceptanceController {

  async create(req, res) {
    try {
      const { poId, comments, serviceAccepted, taskId } = req.body;
      const acceptedBy = req.body.acceptedBy || req.user?.id;

      if (!poId) {
        return res.status(400).json({ success: false, message: 'poId est requis' });
      }
      if (serviceAccepted === undefined || serviceAccepted === null) {
        return res.status(400).json({ success: false, message: 'serviceAccepted (true/false) est requis' });
      }

      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande introuvable' });
      }

      const result = await sanModel.create({
        poId, acceptedBy,
        comments,
        serviceAccepted: serviceAccepted === true || serviceAccepted === 'true'
      });

      // Complete Camunda Activity_ServiceAcceptance task
      let camundaTaskCompleted = false;
      const completionVars = {
        sanId: result.id,
        sanNumber: result.sanNumber,
        serviceAccepted: result.serviceAccepted,
        sanStatus: result.status
      };

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, completionVars);
          camundaTaskCompleted = true;
        } catch (e) {
          console.error('[SAN] Camunda completeTask (non-fatal):', e.message);
        }
      } else {
        try {
          const row = await db.one(
            `SELECT r.process_instance_id
             FROM requisitions r
             JOIN purchase_orders po ON po.requisition_id = r.id
             WHERE po.id = $1`,
            [poId]
          );
          if (row?.process_instance_id) {
            const tasks = await camundaService.getProcessTasks(row.process_instance_id);
            const sanTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_ServiceAcceptance');
            if (sanTask) {
              await camundaService.completeTask(sanTask.id, completionVars);
              camundaTaskCompleted = true;
            }
          }
        } catch (e) {
          console.error('[SAN] Camunda auto-complete (non-fatal):', e.message);
        }
      }

      if (req.io) {
        req.io.emit('san-created', { sanId: result.id, poId, serviceAccepted: result.serviceAccepted });
      }

      res.status(201).json({
        success: true,
        data: result,
        camundaTaskCompleted,
        message: 'Note d\'acceptation de service créée avec succès'
      });
    } catch (error) {
      console.error('Error creating SAN:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la création du SAN', error: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const { poId, status, page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [data, total] = await Promise.all([
        sanModel.findAll({ poId, status, limit: parseInt(limit), offset }),
        sanModel.count({ status })
      ]);

      res.json({
        success: true,
        data,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération SAN', error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const san = await sanModel.findById(req.params.id);
      if (!san) return res.status(404).json({ success: false, message: 'SAN non trouvé' });
      res.json({ success: true, data: san });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération SAN', error: error.message });
    }
  }

  async getByPO(req, res) {
    try {
      const { poId } = req.params;
      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) return res.status(404).json({ success: false, message: 'Commande introuvable' });
      const data = await sanModel.findByPOId(poId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération SAN', error: error.message });
    }
  }
}

module.exports = new ServiceAcceptanceController();

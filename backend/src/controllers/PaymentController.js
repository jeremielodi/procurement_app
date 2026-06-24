// backend/src/controllers/PaymentController.js
const paymentModel   = require('../models/PaymentModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');
const puppeteer      = require('puppeteer');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');

class PaymentController {

  async create(req, res) {
    try {
      const {
        invoiceId, poId, paymentDate, amount, currency,
        paymentMethod, reference, bankAccount, notes, taskId
      } = req.body;
      const createdBy = req.user?.id;

      if (!amount) {
        return res.status(400).json({ success: false, message: 'amount est requis' });
      }
      if (!invoiceId && !poId) {
        return res.status(400).json({ success: false, message: 'invoiceId ou poId est requis' });
      }

      if (invoiceId) {
        let inv;
        try { inv = await db.one('SELECT id FROM invoices WHERE id = $1', [invoiceId]); } catch (_) { inv = null; }
        if (!inv) {
          return res.status(404).json({ success: false, message: 'Facture introuvable' });
        }
      }

      // Resolve processInstanceId
      let processInstanceId = null;
      try {
        const pidCol = invoiceId
          ? `SELECT process_instance_id FROM invoices WHERE id = $1`
          : `SELECT r.process_instance_id FROM requisitions r JOIN purchase_orders po ON po.requisition_id = r.id WHERE po.id = $1`;
        const row = await db.one(pidCol, [invoiceId || poId]);
        processInstanceId = row?.process_instance_id || null;
      } catch { /**/ }

      const result = await paymentModel.create({
        invoiceId, poId, paymentDate, amount, currency,
        paymentMethod, reference, bankAccount, notes, createdBy,
        processInstanceId, camundaTaskId: taskId || null
      });

      // Complete Camunda Activity_ProcessPayment task
      let camundaTaskCompleted = false;
      const completionVars = {
        paymentId: result.id,
        paymentNumber: result.paymentNumber,
        paymentAmount: amount,
        paymentComplete: true
      };

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, completionVars);
          camundaTaskCompleted = true;
        } catch (e) {
          console.error('[Payment] Camunda completeTask (non-fatal):', e.message);
        }
      } else if (processInstanceId) {
        try {
          const tasks = await camundaService.getProcessTasks(processInstanceId);
          const payTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_ProcessPayment');
          if (payTask) {
            await camundaService.completeTask(payTask.id, completionVars);
            camundaTaskCompleted = true;
          }
        } catch (e) {
          console.error('[Payment] Camunda auto-complete (non-fatal):', e.message);
        }
      }

      if (req.io) {
        req.io.emit('payment-created', { paymentId: result.id, invoiceId, amount });
      }

      res.status(201).json({
        success: true,
        data: result,
        camundaTaskCompleted,
        message: 'Paiement enregistré avec succès'
      });
    } catch (error) {
      console.error('Error creating payment:', error);
      res.status(500).json({ success: false, message: 'Erreur création paiement', error: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const { invoiceId, poId, status, page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [data, total] = await Promise.all([
        paymentModel.findAll({ invoiceId, poId, status, limit: parseInt(limit), offset }),
        paymentModel.count({ status })
      ]);

      res.json({
        success: true, data,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération paiements', error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const pay = await paymentModel.findById(req.params.id);
      if (!pay) return res.status(404).json({ success: false, message: 'Paiement non trouvé' });
      res.json({ success: true, data: pay });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération paiement', error: error.message });
    }
  }

  async approve(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const pay = await paymentModel.findById(id);
      if (!pay) return res.status(404).json({ success: false, message: 'Paiement non trouvé' });
      await paymentModel.approve(id, userId);
      res.json({ success: true, message: 'Paiement approuvé' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur approbation paiement', error: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status) return res.status(400).json({ success: false, message: 'status requis' });
      await paymentModel.updateStatus(id, status);
      res.json({ success: true, message: 'Statut paiement mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur mise à jour', error: error.message });
    }
  }

  async generatePDF(req, res) {
    let browser = null;
    try {
      const pay = await paymentModel.findById(req.params.id);
      if (!pay) return res.status(404).json({ success: false, message: 'Paiement non trouvé' });

      const currency = pay.currency || await getEnterpriseCurrencyCode();
      const fmt = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(n) || 0);
      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

      const METHOD_LABELS = { BANK_TRANSFER: 'Virement bancaire', CHECK: 'Chèque', CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money' };
      const STATUS_LABELS = { PENDING: 'En attente', PROCESSING: 'En cours', PAID: 'Payé', FAILED: 'Échoué', CANCELLED: 'Annulé' };
      const STATUS_COLORS = { PENDING: '#D97706', PROCESSING: '#2563EB', PAID: '#059669', FAILED: '#DC2626', CANCELLED: '#6B7280' };

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Helvetica,Arial,sans-serif;padding:40px;color:#1F2937;font-size:13px}
.header{border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:30px;display:flex;justify-content:space-between;align-items:flex-end}
.title{font-size:24px;font-weight:700;color:#059669}
.subtitle{font-size:12px;color:#6B7280;margin-top:4px}
.badge{display:inline-block;padding:4px 14px;border-radius:9999px;font-size:12px;font-weight:700;color:white;background:${STATUS_COLORS[pay.status] || '#6B7280'}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.card{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px}
.card .lbl{font-size:10px;color:#6B7280;font-weight:700;text-transform:uppercase;margin-bottom:4px}
.card .val{font-size:15px;font-weight:600;color:#111827}
.amount-card{background:#ECFDF5;border:2px solid #6EE7B7}
.amount-card .val{font-size:22px;color:#065F46;font-weight:800}
.section{font-size:14px;font-weight:700;color:#374151;border-bottom:1px solid #E5E7EB;padding-bottom:8px;margin:24px 0 14px}
.ref-box{background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:14px;margin-bottom:24px}
.ref-row{display:flex;gap:32px}
.ref-row .item{flex:1}
.notes{background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px;margin-top:16px;font-size:12px;color:#78350F}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;display:flex;justify-content:space-between}
</style></head><body>
<div class="header">
  <div>
    <div class="title">Reçu de Paiement</div>
    <div class="subtitle">${pay.payment_number} · Émis le ${fmtDate(pay.created_at)}</div>
  </div>
  <span class="badge">${STATUS_LABELS[pay.status] || pay.status}</span>
</div>

<div class="grid3">
  <div class="card amount-card" style="grid-column:span 1">
    <div class="lbl">Montant payé</div>
    <div class="val">${fmt(pay.amount)}</div>
  </div>
  <div class="card">
    <div class="lbl">Mode de paiement</div>
    <div class="val">${METHOD_LABELS[pay.payment_method] || pay.payment_method || '—'}</div>
  </div>
  <div class="card">
    <div class="lbl">Date de paiement</div>
    <div class="val">${fmtDate(pay.payment_date)}</div>
  </div>
</div>

<div class="section">Références</div>
<div class="ref-box">
  <div class="ref-row">
    ${pay.invoice_number ? `<div class="item"><div class="lbl">Facture</div><div class="val" style="font-size:13px">${pay.invoice_number}</div></div>` : ''}
    ${pay.po_number ? `<div class="item"><div class="lbl">Commande (PO)</div><div class="val" style="font-size:13px">${pay.po_number}</div></div>` : ''}
    ${pay.supplier_name ? `<div class="item"><div class="lbl">Fournisseur</div><div class="val" style="font-size:13px">${pay.supplier_name}</div></div>` : ''}
    ${pay.reference ? `<div class="item"><div class="lbl">Référence</div><div class="val" style="font-size:13px">${pay.reference}</div></div>` : ''}
  </div>
</div>

${pay.bank_account ? `<div class="grid2"><div class="card"><div class="lbl">Compte bancaire</div><div class="val" style="font-size:13px">${pay.bank_account}</div></div></div>` : ''}

${pay.notes ? `<div class="notes"><strong>Notes :</strong> ${pay.notes}</div>` : ''}

<div class="footer">
  <span>Système de gestion des achats — WWF Procure</span>
  <span>Généré le ${new Date().toLocaleString('fr-FR')}</span>
</div>
</body></html>`;

      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '15px', bottom: '30px', left: '10px', right: '10px' },
        displayHeaderFooter: false
      });

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.length,
        'Content-Disposition': `inline; filename=payment_${pay.payment_number}.pdf`
      });
      return res.end(pdfBuffer);
    } catch (error) {
      console.error('Error generating payment PDF:', error);
      return res.status(500).json({ success: false, message: 'Erreur génération PDF', error: error.message });
    } finally {
      if (browser) await browser.close();
    }
  }
}

module.exports = new PaymentController();

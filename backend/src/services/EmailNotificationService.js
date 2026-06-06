const nodemailer = require('nodemailer');

module.exports = (camundaClient, pool, io) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  
  camundaClient.subscribe('sendNotification', async ({ task, taskService }) => {
    try {
      const { to, subject, message, entityType, entityId } = task.variables.getAll();
      
      // Get user email if to is user ID
      let recipientEmail = to;
      if (!to.includes('@')) {
        const userResult = await pool.query(
          'SELECT email FROM users WHERE id = $1',
          [parseInt(to)]
        );
        if (userResult.rows.length > 0) {
          recipientEmail = userResult.rows[0].email;
        }
      }
      
      // Send email
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: recipientEmail,
        subject: subject,
        html: message,
        text: message.replace(/<[^>]*>/g, '')
      });
      
      // Create notification in database
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [!to.includes('@') ? parseInt(to) : null, 
         subject, 
         message.replace(/<[^>]*>/g, ''), 
         'WORKFLOW',
         `/app/${entityType}/${entityId}`]
      );
      
      // Notify via socket
      io.emit('notification', {
        userId: to,
        title: subject,
        message: message.replace(/<[^>]*>/g, ''),
        type: 'WORKFLOW'
      });
      
      await taskService.complete(task);
      
    } catch (error) {
      console.error('Email notification service error:', error);
      await taskService.handleFailure(task, {
        errorMessage: 'Failed to send notification',
        errorDetails: error.message,
        retries: 3,
        retryTimeout: 10000
      });
    }
  });
};
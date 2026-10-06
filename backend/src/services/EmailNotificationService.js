const nodemailer = require('nodemailer');

// 1. Configure the transporter (SMTP_HOST est un nom d'hôte, pas un "service" nodemailer)
const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    // Les mots de passe d'application Google sont affichés avec des espaces
    pass: (process.env.SMTP_PASS || '').replace(/\s/g, '')
  }
});

class EmailNotificationService {
  /**
   * Envoie un email. Ne lève jamais d'exception : retourne { success, error? }
   * options.replyTo : adresse de réponse (ex. visiteur du formulaire de contact)
   */
  async sendEmail(receiverAddress, subject, htmlContent, { replyTo } = {}) {
    try {
      // 2. Define the email options
      const mailOptions = {
        from: process.env.SMTP_FROM,
        to: receiverAddress,
        subject,
        html: htmlContent,
        ...(replyTo ? { replyTo } : {}),
      };

      // 3. Send the email
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully to %s: %s', receiverAddress, info.response);
      return { success: true };
    } catch (error) {
      console.log('EmailNotification : Error occurred (%s): %s', receiverAddress, error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailNotificationService();

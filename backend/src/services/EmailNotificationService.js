const nodemailer = require('nodemailer');

// 1. Configure the transporter
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_HOST,
  auth: {
    user: process.env.SMTP_USER, // Replace with your Gmail address
    pass: process.env.SMTP_PASS    // Replace with your 16-digit Google App Password
  }
});

class EmailNotificationService {
 sendEmail(receiverAddress, subject, htmlContent) {
 try {
   // 2. Define the email options
  const mailOptions = {
    from: process.env.SMTP_FROM,     // Sender address
    to: receiverAddress, // Receiver address
    subject: subject, // Subject line
    html: htmlContent,
  };

  // 3. Send the email
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error occurred:', error.message);
    } else {
      console.log('Email sent successfully:', info.response);
    }
  });
 } catch (error) {
   console.log('EmailNotification : Error occurred:', error.message);
 }
}
}

module.exports = new EmailNotificationService();
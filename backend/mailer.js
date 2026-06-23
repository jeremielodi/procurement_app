const nodemailer = require('nodemailer');

// 1. Configure the transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'digitalessolutions6@gmail.com', // Replace with your Gmail address
    pass: 'qgdp lful tyzh baqj'    // Replace with your 16-digit Google App Password
  }
});

// 2. Define the email options
const mailOptions = {
  from: 'digitalessolutions6@gmail.com',     // Sender address
  to: 'jeremielodi@gmail.com', // Receiver address
  subject: 'Sending Email using Node.js and Nodemailer', // Subject line
  text: 'That was easy! Here is your automated message.' // Plain text body
  // html: '<h1>Hello!</h1><p>HTML version of the message.</p>' // Optional HTML body
};

// 3. Send the email
transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.log('Error occurred:', error.message);
  } else {
    console.log('Email sent successfully:', info.response);
  }
});
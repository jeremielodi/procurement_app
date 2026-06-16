// backend/src/config/puppeteer.js
const puppeteer = require('puppeteer');

const getBrowserOptions = () => {
  const options = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  };

  // Utiliser chromium préinstallé en production
  if (process.env.NODE_ENV === 'production') {
    options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
  }

  return options;
};

module.exports = { getBrowserOptions };
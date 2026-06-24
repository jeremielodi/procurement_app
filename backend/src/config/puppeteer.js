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

  // En production Linux : utiliser le chromium système ou l'env var
  // Sur Windows ou si l'env var pointe un chemin qui n'existe pas → laisser Puppeteer
  // trouver son propre Chromium bundlé (pas d'executablePath)
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicitPath) {
    options.executablePath = explicitPath;
  } else if (process.env.NODE_ENV === 'production' && process.platform !== 'win32') {
    options.executablePath = '/usr/bin/chromium-browser';
  }

  return options;
};

module.exports = { getBrowserOptions };
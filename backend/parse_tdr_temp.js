const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-extensions']
  });
  const page = await browser.newPage();

  await page.goto('file:///D:/apps/wwf_procure/wwf_tdr_app_procurement.pdf', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 4000));
  const text = await page.evaluate(() => document.documentElement.innerText || '');
  fs.writeFileSync('d:/apps/wwf_procure/tdr_full.txt', text, 'utf8');
  console.log('Done:', text.length, 'chars');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });

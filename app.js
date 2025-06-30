// app.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const juice = require('juice');
const puppeteer = require('puppeteer');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const app = express();

const UPLOAD_DIR = 'uploads';
const SCREENSHOT_DIR = path.join(__dirname, 'public', 'screenshots');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/screenshots', express.static(SCREENSHOT_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// --- Restored Full CLIENTS Array ---
const CLIENTS = [
  // --- Desktop Browsers (Current & Slightly Older) ---
  {
    name: 'desktop_chrome_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  },
  {
    name: 'desktop_chrome_older_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  },
  {
    name: 'desktop_edge_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    viewport: { width: 1440, height: 900 },
  },
   {
    name: 'desktop_safari_mac', // UA Simulation
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15',
    viewport: { width: 1280, height: 800 },
  },
  {
    name: 'desktop_firefox_windows', // UA Simulation (Needs launch config change for real Firefox)
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
    viewport: { width: 1366, height: 768 },
  },

  // --- iOS Devices (iPhone Examples) ---
   {
    name: 'ios_iphone_13pro', // Simulating Mail/Safari on iOS (WebKit engine)
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 390, height: 844 },
  },
  {
    name: 'ios_iphone_11', // Older popular model
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 414, height: 896 },
  },
  {
    name: 'ios_iphone_se', // Smaller screen
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 375, height: 667 },
  },

  // --- Android Devices (Examples) ---
  {
    name: 'android_pixel_7', // Simulating Mail/Chrome on Android (Blink engine)
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
  },
   {
    name: 'android_pixel_5', // Older popular model
    ua: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Mobile Safari/537.36',
    viewport: { width: 393, height: 851 },
  },
  {
    name: 'android_samsung_s21', // Popular manufacturer
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 800 },
  },

  // --- Tablet Example ---
  {
    name: 'ios_ipad_pro_12_9', // Simulating Safari/Mail on iPadOS
    ua: 'Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 1024, height: 1366 },
  }
];

// home form
app.get('/', (req, res) => {
  res.render('index');
});

// handle upload & preview
app.post('/preview', upload.single('emailFile'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).send('No email file uploaded.');
  }
  const uploadedFilePath = req.file.path;
  let browser;

  try {
    const rawHtml = fs.readFileSync(uploadedFilePath, 'utf-8');
    const inlinedHtml = juice(rawHtml);

    console.log('Attempting to launch browser...');
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const results = [];

    for (const client of CLIENTS) {
      console.log(`Processing client: ${client.name}`);
      const page = await browser.newPage();
      try {
          await page.setUserAgent(client.ua);
          await page.setViewport(client.viewport);
          console.log(`  Setting content for ${client.name}...`);
          await page.setContent(inlinedHtml, { waitUntil: 'networkidle0' });

          const filename = `${client.name}_${Date.now()}.png`;
          const outPath = path.join(SCREENSHOT_DIR, filename);
          console.log(`  Taking screenshot for ${client.name}...`);
          await page.screenshot({ path: outPath, fullPage: true });

          results.push({ name: client.name, filename: filename });
      } catch(pageError) {
          console.error(`  Error processing page for ${client.name}: ${pageError.message}`);
          results.push({ name: `${client.name} (Error)`, filename: null, error: pageError.message });
      } finally {
          console.log(`  Closing page for ${client.name}...`);
          await page.close();
      }
    }

    if (results.length >= 2 && results[0].filename && results[1].filename) {
      const [a, b] = results;
      const imgAPath = path.join(SCREENSHOT_DIR, a.filename);
      const imgBPath = path.join(SCREENSHOT_DIR, b.filename);
      console.log(`Attempting to compare ${a.name} and ${b.name}...`);
      try {
          const imgA = PNG.sync.read(fs.readFileSync(imgAPath));
          const imgB = PNG.sync.read(fs.readFileSync(imgBPath));
          if (imgA.width === imgB.width && imgA.height === imgB.height) {
              const { width, height } = imgA;
              const diff = new PNG({ width, height });
              const numDiffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold: 0.1 });
              console.log(`  Pixelmatch found ${numDiffPixels} differing pixels.`);
              const diffName = `${a.name}_vs_${b.name}_diff_${Date.now()}.png`;
              fs.writeFileSync(path.join(SCREENSHOT_DIR, diffName), PNG.sync.write(diff));
              results.push({ name: `diff (${a.name} vs ${b.name})`, filename: diffName });
          } else {
              console.warn(`  Skipping pixel comparison: Image dimensions do not match.`);
          }
      } catch (readError) {
           console.error(`  Error reading images for comparison: ${readError.message}`);
      }
    }

    console.log('Closing browser...');
    await browser.close();

    res.render('result', { results });

  } catch (err) {
    next(err);
  } finally {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        console.log(`Cleaning up uploaded file: ${uploadedFilePath}`);
        fs.unlinkSync(uploadedFilePath);
      }
  }
});

app.use((err, req, res, next) => {
  console.error("Global error handler caught:", err);
  res.status(500).send('Something went wrong. Check server logs for details.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email Preview UI running on port ${PORT}`);
});

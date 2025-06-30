// app.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const juice = require('juice');
// --- Vercel Puppeteer Setup ---
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chrome-aws-lambda');
// --- End Vercel Puppeteer Setup ---
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const app = express();

const UPLOAD_DIR = path.join(os.tmpdir(), 'uploads');
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'screenshots');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const CLIENTS = [
  {
    name: 'desktop_chrome_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  },
  {
    name: 'desktop_edge_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    viewport: { width: 1440, height: 900 },
  },
  {
    name: 'desktop_safari_mac',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15',
    viewport: { width: 1280, height: 800 },
  },
  {
    name: 'ios_iphone_13pro',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 390, height: 844 },
  },
  {
    name: 'ios_iphone_se',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15',
    viewport: { width: 375, height: 667 },
  },
  {
    name: 'android_pixel_7',
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
  },
  {
    name: 'android_samsung_s21',
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 800 },
  },
];

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/preview', upload.single('emailFile'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).send('No email file uploaded.');
  }
  const uploadedFilePath = req.file.path;
  let browser = null;

  try {
    const rawHtml = fs.readFileSync(uploadedFilePath, 'utf-8');
    const inlinedHtml = juice(rawHtml);

    console.log('Launching browser...');
    // --- Vercel-Compatible Browser Launch ---
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      // CORRECTED LINE: executablePath is a property, not a function.
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    // --- End Vercel-Compatible Browser Launch ---

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

        const imageBuffer = fs.readFileSync(outPath);
        const imageData = `data:image/png;base64,${imageBuffer.toString('base64')}`;

        results.push({ name: client.name, imageData: imageData, path: outPath });
      } catch (pageError) {
        console.error(`  Error processing page for ${client.name}: ${pageError.message}`);
        results.push({ name: `${client.name} (Error)`, imageData: null, error: pageError.message });
      } finally {
        console.log(`  Closing page for ${client.name}...`);
        await page.close();
      }
    }

    if (results.length >= 2 && results[0].path && results[1].path) {
      const [a, b] = results;
      const imgAPath = a.path;
      const imgBPath = b.path;
      console.log(`Attempting to compare ${a.name} and ${b.name}...`);
      try {
        const imgA = PNG.sync.read(fs.readFileSync(imgAPath));
        const imgB = PNG.sync.read(fs.readFileSync(imgBPath));
        if (imgA.width === imgB.width && imgA.height === imgB.height) {
          const { width, height } = imgA;
          const diff = new PNG({ width, height });
          console.log(`  Comparing ${a.name} (${width}x${height}) and ${b.name} (${width}x${height})...`);
          const numDiffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold: 0.1 });
          console.log(`  Pixelmatch found ${numDiffPixels} differing pixels.`);

          const diffName = `${a.name}_vs_${b.name}_diff_${Date.now()}.png`;
          const diffPath = path.join(SCREENSHOT_DIR, diffName);
          
          fs.writeFileSync(diffPath, PNG.sync.write(diff));

          const diffBuffer = fs.readFileSync(diffPath);
          const diffImageData = `data:image/png;base64,${diffBuffer.toString('base64')}`;
          results.push({ name: `diff (${a.name} vs ${b.name})`, imageData: diffImageData });
        } else {
          console.warn(`  Skipping pixel comparison between ${a.name} and ${b.name}: Image dimensions do not match (${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height})`);
        }
      } catch (readError) {
        console.error(`  Error reading images for comparison: ${readError.message}`);
      }
    } else {
      console.log("Skipping comparison: Less than two valid results generated.");
    }

    res.render('result', { results });

  } catch (err) {
    next(err);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    // Cleanup all generated files from /tmp
    const filesInUploads = fs.readdirSync(UPLOAD_DIR);
    for (const file of filesInUploads) {
        try {
            fs.unlinkSync(path.join(UPLOAD_DIR, file));
        } catch (e) {
            console.error(`Failed to delete upload file: ${e.message}`);
        }
    }
    const filesInScreenshots = fs.readdirSync(SCREENSHOT_DIR);
    for (const file of filesInScreenshots) {
        try {
            fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
        } catch(e) {
            console.error(`Failed to delete screenshot file: ${e.message}`);
        }
    }
  }
});

app.use((err, req, res, next) => {
  console.error("Global error handler caught:", err);
  res.status(500).send('Something went wrong. Check server logs for details.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email Preview UI running on http://localhost:${PORT}`);
});
// app.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os'); // Required to find the system's temporary directory
const multer = require('multer');
const juice = require('juice');
const puppeteer = require('puppeteer');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const app = express();

// --- Vercel-Compatible File Handling ---
// Use the /tmp directory for all file storage, as it's the only writable location in a Vercel serverless function.
const UPLOAD_DIR = path.join(os.tmpdir(), 'uploads');
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'screenshots');

// Ensure these temporary directories exist.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });


// configure view engine & static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Serve static files like CSS from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Note: We can no longer serve screenshots statically from SCREENSHOT_DIR as it's in /tmp.
// They will be embedded as base64 strings instead.

// --- Start: Expanded CLIENTS Array ---
// Define desktop, iOS, and Android client permutations
// Note: User Agents change frequently; these are examples. Viewports are logical CSS pixels.
// IMPORTANT: Changing UA does not change the underlying rendering engine (usually Chromium).
const CLIENTS = [
  // --- Desktop Browsers (Current & Slightly Older) ---
  {
    name: 'desktop_chrome_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', // Example Current Chrome UA
    viewport: { width: 1366, height: 768 },
  },
  {
    name: 'desktop_edge_windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0', // Example Edge UA
    viewport: { width: 1440, height: 900 },
  },
   {
    name: 'desktop_safari_mac', // UA Simulation
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15', // Example Safari Mac UA
    viewport: { width: 1280, height: 800 },
  },
  // --- iOS Devices (iPhone Examples) ---
   {
    name: 'ios_iphone_13pro', // Simulating Mail/Safari on iOS (WebKit engine)
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15', // Example iPhone Safari UA
    viewport: { width: 390, height: 844 }, // iPhone 13 Pro logical resolution
  },
  {
    name: 'ios_iphone_se', // Smaller screen
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/605.1.15', // Same UA as 13 Pro example, different viewport
    viewport: { width: 375, height: 667 }, // iPhone SE (2nd/3rd gen) logical resolution
  },

  // --- Android Devices (Examples) ---
  {
    name: 'android_pixel_7', // Simulating Mail/Chrome on Android (Blink engine)
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36', // Example Android Chrome UA
    viewport: { width: 412, height: 915 }, // Pixel 7 logical resolution
  },
   {
    name: 'android_samsung_s21', // Popular manufacturer
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36', // Example Samsung UA
    viewport: { width: 360, height: 800 }, // Galaxy S21 logical resolution
  },
];
// --- End: Expanded CLIENTS Array ---


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

    console.log('Launching browser...');
    // Launch Puppeteer with args recommended for serverless environments
    browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const results = [];
    const generatedFiles = []; // Keep track of files to delete

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
          generatedFiles.push(outPath); // Add to cleanup list

          console.log(`  Taking screenshot for ${client.name}...`);
          await page.screenshot({ path: outPath, fullPage: true });

          // Read the file and convert to base64 data URI
          const imageBuffer = fs.readFileSync(outPath);
          const imageData = `data:image/png;base64,${imageBuffer.toString('base64')}`;

          results.push({ name: client.name, imageData: imageData, path: outPath }); // Store path for diffing
      } catch(pageError) {
          console.error(`  Error processing page for ${client.name}: ${pageError.message}`);
          results.push({ name: `${client.name} (Error)`, imageData: null, error: pageError.message });
      } finally {
          console.log(`  Closing page for ${client.name}...`);
          await page.close();
      }
    }

    // Diff logic - currently compares the *first two* clients in the CLIENTS array
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
              generatedFiles.push(diffPath); // Add to cleanup list

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

    console.log('Closing browser...');
    await browser.close();
    browser = null;

    res.render('result', { results });

  } catch (err) {
    next(err);
  } finally {
      if (browser) {
        await browser.close();
      }
      // Cleanup all generated files from /tmp
      const filesToClean = [uploadedFilePath, ...fs.readdirSync(SCREENSHOT_DIR).map(f => path.join(SCREENSHOT_DIR, f))];
      for (const file of filesToClean) {
          if (file && fs.existsSync(file)) {
              console.log(`Cleaning up temporary file: ${file}`);
              try {
                  fs.unlinkSync(file);
              } catch (unlinkErr) {
                  console.error(`Error cleaning up temporary file: ${unlinkErr.message}`);
              }
          }
      }
  }
});

// error handler
app.use((err, req, res, next) => {
  console.error("Global error handler caught:", err);
  res.status(500).send('Something went wrong. Check server logs for details.');
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email Preview UI running on http://localhost:${PORT}`);
});

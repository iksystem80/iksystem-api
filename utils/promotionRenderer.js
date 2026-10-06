const { chromium } = require('playwright')

let browser = null

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    })
  }

  return browser
}

async function htmlToPng(html) {
  const browser = await getBrowser()

  const page = await browser.newPage({
    viewport: {
      width: 1080,
      height: 1350,
    },
    deviceScaleFactor: 1,
  })

  try {
    await page.setContent(html, {
      waitUntil: 'networkidle',
    })

    await page.evaluate(async () => {
      const images = Array.from(document.images)

      await Promise.all(
        images.map((image) => {
          if (image.complete) {
            return Promise.resolve()
          }

          return new Promise((resolve) => {
            image.onload = resolve

            image.onerror = resolve
          })
        })
      )
    })

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    })

    return screenshot
  } finally {
    await page.close()
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close()

    browser = null
  }
}

module.exports = {
  htmlToPng,
  closeBrowser,
}

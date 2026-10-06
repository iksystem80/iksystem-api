const fs = require('fs')

const { htmlToPng } = require('./utils/promotionRenderer')

async function test() {
  const html = `
        <!DOCTYPE html>

        <html>

        <head>

            <style>

                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    padding: 0;
                    font-family: Arial, sans-serif;
                }

                .promotion {
                    width: 1080px;
                    height: 1350px;

                    background:
                        linear-gradient(
                            135deg,
                            #fff5e6,
                            #ffd166
                        );

                    text-align: center;

                    padding: 60px;
                }

                h1 {
                    font-size: 56px;
                    color: #222;
                }

                h2 {
                    font-size: 72px;
                    color: #d62828;
                }

                p {
                    font-size: 28px;
                }

            </style>

        </head>

        <body>

            <div class="promotion">

                <h1>
                    Summer Sale
                </h1>

                <h2>
                    25% OFF
                </h2>

                <p>
                    Get 25% off your next purchase!
                </p>

            </div>

        </body>

        </html>
    `

  const png = await htmlToPng(html)

  fs.writeFileSync('test-promotion.png', png)

  console.log('PNG created: test-promotion.png')
}

test()

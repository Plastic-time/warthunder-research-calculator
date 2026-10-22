const launchOptions = () => ({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.env.CI ? {} : { channel: 'chrome' }),
});
module.exports = { launchOptions };

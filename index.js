const c = require('chalk');
const fs = require('fs');
const rp = require('request-promise-native');
const strip = require('striptags');
const mqtt = require('mqtt');


const config = require('./config');

const f = (key, value) => console.log(c.red(key), c.blue(value));

// Alert of New Bios
const newBiosConsoleAlert = (mobo, lastBios) => {
  console.log(`Your BIOS (${mobo.currentVersion}) for ${mobo.name}, is not up to date`);
  f(`Release Date`, lastBios.ReleaseDate);
  f(`Title`, lastBios.Title);
  f(`Description`, strip(lastBios.Description).replace(/  +/g, ' '));
  f(`URL`, lastBios.DownloadUrl.Global);
};

// Download New Bioses
const newBiosDownloadCheck = async (mobo, lastBios) => {
  const filePath = `./biosFiles/${mobo.name}-${lastBios.Version}.zip`;

  // If the File does not already exist
  if (!fs.existsSync(filePath)) {

    console.log(`Downloading ${filePath} (${lastBios.FileSize})`);

    // Grab The File
    const fileRes = await rp.get({
      url: lastBios.DownloadUrl.Global,
      encoding: null,
    });

    // Encode to buffer
    const fileBuffer = Buffer.from(fileRes, 'utf8');

    fs.writeFileSync(filePath, fileBuffer);
    console.log('Downloaded');
  } else {
    console.log('Already Downloaded');
  }
};

// Validate the API State
const invalidApiState = (biosResults) => biosResults.Status !== 'SUCCESS' ||
  !biosResults.Result ||
  !biosResults.Result.Obj ||
  !biosResults.Result.Obj[0] ||
  !biosResults.Result.Obj[0].Files ||
  !biosResults.Result.Obj[0].Files[0] ||
  !biosResults.Result.Obj[0].Files[0].Version ||
  !biosResults.Result.Obj[0].Files[0].FileSize ||
  !biosResults.Result.Obj[0].Files[0].Description ||
  !biosResults.Result.Obj[0].Files[0].DownloadUrl ||
  !biosResults.Result.Obj[0].Files[0].DownloadUrl.Global;

const newBiosMqttAlert = async (mobo, lastBios) => mqttClient.publish('newBiosAlert', `A New Bios is available for ${mobo.name} // ${lastBios.Version} // ${lastBios.Title} // ${strip(lastBios.Description).replace(/  +/g, ' ')}`);

// Application Entry Point
const app = async (mobos) => {
  for (const mobo of mobos) {
    const biosResults = await rp({
      uri: mobo.apiEndPoint,
      json: true,
    });

    // Verify The API state
    if (invalidApiState(biosResults)) {
      throw new Error('Something went wrong fetching the request for BIOS information');
    }

    const lastBios = biosResults.Result.Obj[0].Files[0];

    if (mobo.currentVersion >= parseInt(lastBios.Version, 10)) {
      console.log(`Your current BIOS for ${mobo.name} ${mobo.currentVersion}, is up to date`);
      continue;
    }

    newBiosConsoleAlert(mobo, lastBios);
    await newBiosDownloadCheck(mobo, lastBios);
    await newBiosMqttAlert(mobo, lastBios);
  }
};

// Create the MQTT Client
const mqttClient = mqtt.connect(config.broker);

// Client is connected
mqttClient.on('connect', () => {
  app(config.mobos)
    .then(() => {
      mqttClient.end(() => {
        process.exit(0);
      })
    })
    .catch(err => {
      console.log(err.message);
      process.exit(1);
    });
});

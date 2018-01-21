const c = require('chalk');
const fs = require('fs');
const rp = require('request-promise-native');
const strip = require('striptags');

// Formatter
const f = (key, value) => console.log(c.cyan(key || ''), c.blue(value || ''));

// Parse Desc as JS Object
const descToObject = (desc) => strip(desc).replace(/m\.2/gi, 'M2').split('.').map(x => x.trim()).filter(x => x !== '');

// Validate the API State
const validApiState = (biosResults) =>
    biosResults.Status === 'SUCCESS' &&
    biosResults.Result &&
    biosResults.Result.Obj &&
    biosResults.Result.Obj[0] &&
    biosResults.Result.Obj[0].Files &&
    biosResults.Result.Obj[0].Files[0] &&
    biosResults.Result.Obj[0].Files[0].Version &&
    biosResults.Result.Obj[0].Files[0].FileSize &&
    biosResults.Result.Obj[0].Files[0].Description &&
    biosResults.Result.Obj[0].Files[0].DownloadUrl &&
    biosResults.Result.Obj[0].Files[0].DownloadUrl.Global;

// Is Valid Motherboard State
const validMoboState = (mobo) => mobo &&
    mobo.currentVersion &&
    mobo.name &&
    mobo.apiEndPoint;

// Is Valid Configuration
const validConfig = (config) =>
    config.downloadPath &&
    config.mqttTitle &&
    config.mobos &&
    config.broker &&
    config.broker.host &&
    config.broker.username &&
    config.broker.password;

const asusMoboUpdater = async (config, mqttClient) => {
    // Validate Config
    if (!validConfig(config)) {
        throw new Error('Configuration Object is malformed');
    }

    // Get a Download file path
    const getFilePath = (mobo, lastBios) => `${config.downloadPath}/${mobo.name}-${lastBios.Version}.zip`;

    // Alert of New Bios
    const newBiosConsoleAlert = (mobo, lastBios) => {
        console.log(c.red(`Your current BIOS for ${mobo.name} ${mobo.currentVersion}, is not up to date`));

        f('Release Date', lastBios.ReleaseDate);
        f('Title', lastBios.Title);
        f('Description');
        f('URL', lastBios.DownloadUrl.Global);

        descToObject(lastBios.Description).forEach(note => console.log(c.yellow(`- ${note}`)));

        if (downloadExists(mobo, lastBios)) {
            f('Downloaded', getFilePath(mobo, lastBios));
        }
    };

    // Download file Exists
    const downloadExists = (mobo, lastBios) => {
        const filePath = getFilePath(mobo, lastBios);
        return fs.existsSync(filePath);
    };

    // Download New Bioses
    const newBiosDownloadCheck = async (mobo, lastBios) => {
        // If the File does not already exist
        if (!downloadExists(mobo, lastBios)) {
            const filePath = getFilePath(mobo, lastBios);
            console.log(`Downloading ${filePath} (${lastBios.FileSize})`);

            // Grab The File
            const fileRes = await rp.get({
                url: lastBios.DownloadUrl.Global,
                encoding: null,
            });

            fs.writeFileSync(filePath, Buffer.from(fileRes, 'utf8'));
            console.log('Downloaded');
            return;
        }

        console.log(c.yellow('Already Downloaded'));
    };

    // MQTT alert
    const newBiosMqttAlert = async (mobo, lastBios) =>
        mqttClient.publish(
            config.mqttTitle,
            `A New Bios is available for ${mobo.name} // ${lastBios.Version} // ${lastBios.Title} // ${strip(lastBios.Description).replace(/  +/g, ' ')}`
        );

    // Iterate over the mobos
    for (const mobo of config.mobos) {
        // Verify mobo state
        if (!validMoboState) {
            console.error('Malformed mobo entry');
            continue;
        }
        // Fetch the BIOS Results
        const biosResults = await rp({
            uri: mobo.apiEndPoint,
            json: true,
        });
        // Verify The API state
        if (!validApiState(biosResults)) {
            console.error(`Something went wrong fetching the BIOS information for ${mobo.name}`);
            continue;
        }
        // Hold on to the last BIOS
        const lastBios = biosResults.Result.Obj[0].Files[0];
        // BIOS is up to date
        if (mobo.currentVersion >= parseInt(lastBios.Version, 10)) {
            console.log(c.green(`Your current BIOS for ${mobo.name} ${mobo.currentVersion}, is up to date`));
            continue;
        }
        // BIOS is not up to date
        newBiosConsoleAlert(mobo, lastBios);
        await newBiosDownloadCheck(mobo, lastBios);
        // If mqttClient is available, broadcast
        if (mqttClient) await newBiosMqttAlert(mobo, lastBios);
    }
};

module.exports = asusMoboUpdater;

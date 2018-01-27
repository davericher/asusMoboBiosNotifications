/** @namespace biosResults.Status */
/** @namespace biosResults.Result */
/** @namespace biosResults.Obj */
/** @namespace biosResults.Onj.Files */
/** @namespace biosResults.Files.FileSize */
/** @namespace biosResults.Files.Version */
/** @namespace biosResults.Files.Description */
/** @namespace biosResults.Files.DownloadUrl */
/** @namespace biosResults.Files.DownloadUrl.Global */
/** @namespace lastBios.Title */
/** @namespace lastBios.ReleaseDate */

const c = require('chalk');
const fs = require('fs');
const rp = require('request-promise-native');
const strip = require('striptags');

/**
 * Console output formatter
 * @param key
 * @param value
 */
const formattedConsole = (key, value) => console.log(c.cyan(key || ''), c.blue(value || ''));

/**
 * Split a API Description into a Array
 * @param desc
 * @return {string[]}
 */
const descToObject = (desc) => strip(desc)
    .replace(/m\.2/gi, 'M2')
    .split('.')
    .map(x => x.trim())
    .filter(x => x !== '');

/**
 * Validate API Result Object
 * @param biosResults
 * @return {boolean}
 */
const validApiState = (biosResults) =>
    biosResults.Status === /** @type {boolean} */'SUCCESS' &&
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

/**
 * Validation Motherboard Object
 * @param mobo
 * @return {boolean}
 */
const validMoboState = (mobo) => mobo &&
    mobo.currentVersion &&
    mobo.name &&
    mobo.apiEndPoint;

/**
 *  Validate Configuration Object
 * @param config
 * @return {boolean}
 */
const validConfig = (config) =>
    config.downloadPath &&
    config.mqttTitle &&
    config.mobos &&
    config.broker &&
    config.broker.host &&
    config.broker.username &&
    config.broker.password;

/**
 * Check and Download for updated BIOS's from Asus
 * @param config
 * @param mqttClient
 * @return {Promise<void>}
 */
const asusMoboUpdater = async (config, mqttClient) => {
    // Validate Config
    if (!validConfig(config)) {
        throw new Error('Configuration Object is malformed');
    }

    /**
     * Generate potential file path
     * @param mobo
     * @param lastBios
     * @return {string}
     */
    const getFilePath = (mobo, lastBios) => {
        const fileResults = lastBios.DownloadUrl.Global.split('/');
        return `${config.downloadPath}/${fileResults[fileResults.length - 1]}`;
    };

    /**
     * Console Alert
     * @param mobo
     * @param lastBios
     */
    const newBiosConsoleAlert = (mobo, lastBios) => {
        console.log(c.red(`Your current BIOS for ${mobo.name} ${mobo.currentVersion}, is not up to date`));
        formattedConsole('Release Date', lastBios.ReleaseDate);
        formattedConsole('Title', lastBios.Title);
        formattedConsole('Description');
        formattedConsole('URL', lastBios.DownloadUrl.Global);

        descToObject(lastBios.Description).forEach(note => console.log(c.yellow(`- ${note}`)));

        if (downloadExists(mobo, lastBios)) {
            formattedConsole('Downloaded', lastBios.filePath);
        }
    };

    /**
     * Check to see if a BIOS was already downloaded
     * @param mobo
     * @param lastBios
     * @return {boolean}
     */
    const downloadExists = (mobo, lastBios) => fs.existsSync(lastBios.filePath);

    /**
     * Download New BIOS
     * @param mobo
     * @param lastBios
     * @return {Promise<boolean>}
     */
    const newBiosDownloadCheck = async (mobo, lastBios) => {
        // If the File does not already exist
        if (!downloadExists(mobo, lastBios)) {
            console.log(`Downloading ${lastBios.filePath} (${lastBios.FileSize})`);

            // Grab The File
            const fileRes = await rp.get({
                url: lastBios.DownloadUrl.Global,
                encoding: null,
            });

            fs.writeFileSync(lastBios.filePath, Buffer.from(fileRes, 'utf8'));

            console.log('Downloaded');
            return true;
        }

        console.log(c.yellow('Already Downloaded'));
        return false;
    };

    // MQTT alert
    /**
     * Send a MQTT Alert
     * @param mobo
     * @param lastBios
     * @return {Promise<*|MqttClient>}
     */
    const newBiosMqttAlert = async (mobo, lastBios) =>
        mqttClient.publish(
            config.mqttTitle,
            JSON.stringify({
                mobo,
                lastBios: Object.assign({}, lastBios, {
                    HTMLDescription: lastBios.Description,
                    Description: strip(lastBios.Description).replace(/ {2}/g, ' ')
                })
            }),
        );

    // Iterate over the motherboards
    for (const mobo of config.mobos) {
        // Verify mobo state
        if (!validMoboState(mobo)) {
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
        const lastBios = Object.assign({}, biosResults.Result.Obj[0].Files[0], {
            filePath: getFilePath(mobo, biosResults.Result.Obj[0].Files[0])
        });
        // BIOS is up to date
        if (mobo.currentVersion >= parseInt(lastBios.Version, 10)) {
            console.log(c.green(`Your current BIOS for ${mobo.name} ${mobo.currentVersion}, is up to date`));
            continue;
        }
        // BIOS is not up to date
        newBiosConsoleAlert(mobo, lastBios);
        try {
            await newBiosDownloadCheck(mobo, lastBios);
        } catch (err) {
            console.log('Something went wrong fetching a BIOS');
            console.dir({
                message: err.message,
                stack: err.stack,
                mobo,
                lastBios
            });
        }
        // If mqttClient is available, broadcast
        if (mqttClient) await newBiosMqttAlert(mobo, lastBios);
    }
};

module.exports = asusMoboUpdater;

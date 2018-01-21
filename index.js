const mqtt = require('mqtt');

const asusMoboUpdater = require('./asusMoboUpdater');
const config = require('./config');

// Create the MQTT Client
const mqttClient = mqtt.connect(config.broker);

// Client is connected
mqttClient.on('connect', async () => {
    try {
        await asusMoboUpdater(config, mqttClient);
        mqttClient.end(() => {
            process.exit(0);
        });
    } catch (err) {
        console.log(err.message);
        process.exit(1);
    }
});

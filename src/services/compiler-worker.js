const { parentPort, workerData } = require('node:worker_threads');
const { SolidityStackDiamondService } = require('./soliditystackdiamond-service');

try {
    const service = new SolidityStackDiamondService();
    parentPort.postMessage({ result: service.compile(workerData) });
} catch (error) {
    parentPort.postMessage({ error: {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode || 500,
        diagnostics: error.diagnostics || []
    } });
}

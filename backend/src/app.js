// This file sets up the Express server for the backend of the IoT Authentication Application. 
// It initializes the connection to the Hyperledger Fabric network and defines the API routes for handling requests from the frontend. 
// The server listens on a specified port and includes error handling for uncaught exceptions and unhandled promise rejections to ensure stability. 
// The use of CORS allows the frontend application to communicate with this backend server without cross-origin issues.
const express = require('express');
const cors = require('cors');
const { initFabric } = require('./fabricService');
const routes = require('./routes');
const { startCoapServer } = require('./coapServer');

const app = express();
const PORT = process.env.PORT || 3000;
const COAP_PORT = parseInt(process.env.COAP_PORT, 10) || 5683;

app.use(cors());
app.use(express.json());

app.use('/api/v1', routes);

// this async function initializes the connection to the Hyperledger Fabric network before starting the Express server.
async function startServer() {
    console.log('Initializing Fabric connections...');
    await initFabric();

    // server listens on port 3000 and binds to all network interfaces
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Backend Server listening on port ${PORT} (0.0.0.0)`);
    });

    // Start the CoAP server for IoT devices
    startCoapServer(COAP_PORT);

    console.log(`Gateway identity: ${process.env.FABRIC_MSP_ID || 'Org1MSP'} | HTTP :${PORT} | CoAP :${COAP_PORT}`);
    
    // Keep the process alive — the Fabric gRPC client unrefs internal sockets 
    // which can cause Node's event loop to drain and the process to exit prematurely
    const keepAlive = setInterval(() => {}, 1 << 30); // ~12 days
    server.on('close', () => clearInterval(keepAlive));
}

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});
process.on('exit', (code) => {
    console.log(`Process exiting with code ${code}`);
});

startServer();

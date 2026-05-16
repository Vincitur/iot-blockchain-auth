const coap = require('coap');
const { encode, decode } = require('cbor-x');
const controllers = require('./controllers');

function startCoapServer(port = 5683) {
    const server = coap.createServer();

    server.on('request', async (req, res) => {
        // CoAP request method (e.g. 'POST', 'GET')
        const method = req.method;
        // The URL path
        const url = req.url.split('?')[0];

        console.log(`[CoAP Server] Received ${method} request for ${url} from ${req.rsinfo.address}:${req.rsinfo.port}`);

        // Note on Security (DTLS / CoAPS):
        // In a production environment, this server should use CoAPS (CoAP over DTLS)
        // to encrypt the payload and prevent eavesdropping or tampering.
        // Currently, standard Node.js CoAP libraries do not natively support production-ready DTLS.
        // Typically, you would use an external proxy like Eclipse Californium or an Nginx/HAProxy layer
        // to terminate the DTLS connection and forward plain CoAP to this Node.js instance.

        let payload = {};
        if (req.payload && req.payload.length > 0) {
            try {
                payload = decode(req.payload);
            } catch (err) {
                console.error('CBOR decode error:', err);
                res.code = '4.00'; // Bad Request
                return res.end(encode({ error: 'Invalid CBOR payload' }));
            }
        }

        try {
            let result;
            if (method === 'POST' && url === '/api/v1/devices/register') {
                result = await controllers.registerDevice(payload);
                res.code = '2.01'; // Created
            } else if (method === 'POST' && url === '/api/v1/auth/challenge') {
                result = await controllers.requestChallenge(payload);
                res.code = '2.05'; // Content
            } else if (method === 'POST' && url === '/api/v1/auth/verify') {
                result = await controllers.verifyAuthentication(payload);
                res.code = '2.05'; // Content
            } else if (method === 'POST' && url === '/api/v1/metrics/latency') {
                result = controllers.recordLatency(payload);
                res.code = '2.01'; // Created
            } else {
                res.code = '4.04'; // Not Found
                console.log(`[CoAP Server] Endpoint not found: ${url}`);
                return res.end(encode({ error: 'Endpoint not found' }));
            }

            console.log(`[CoAP Server] Sending response for ${url} with code ${res.code}`);
            res.end(encode(result));

        } catch (error) {
            console.error(`CoAP Error [${method} ${url}]:`, error);
            const status = error.status || 500;
            // Map HTTP status codes to CoAP status codes roughly
            if (status === 400) res.code = '4.00'; // Bad Request
            else if (status === 401) res.code = '4.01'; // Unauthorized
            else if (status === 403) res.code = '4.03'; // Forbidden
            else if (status === 404) res.code = '4.04'; // Not Found
            else res.code = '5.00'; // Internal Server Error
            
            res.end(encode({ error: error.message || 'Internal error' }));
        }
    });

    server.listen(port, () => {
        console.log(`CoAP Gateway listening on UDP port ${port}`);
    });

    return server;
}

module.exports = { startCoapServer };

// Marius-Remus Dumitrel - AuthApp - Backend API Unit Tests
const request = require('supertest');
const express = require('express');
const routes = require('../src/routes');
const controllers = require('../src/controllers');

// Mock controllers to avoid connecting to a real Fabric network
jest.mock('../src/controllers');

// we create an Express app instance and use the routes for testing
const app = express();
app.use(express.json());
app.use('/api/v1', routes);

// These tests cover the main API routes for device registration, authentication verification & device revocation. 
// We mock the controller functions to simulate their behavior without needing a real Fabric network connection. 
// Each test checks the expected status codes and response bodies based on different scenarios, including successful operations and error handling.
describe('Backend API Routes', () => {
    
    beforeEach(() => {
        jest.clearAllMocks(); // Clear mock history before each test
    });

    // Test the device registration endpoint
    describe('POST /api/v1/devices/register', () => {
        it('should successfully register a device', async () => {
            const mockResponse = { message: 'Device registered successfully' };
            controllers.registerDevice.mockResolvedValueOnce(mockResponse);

            const res = await request(app)   // we use supertest to send a POST request to the device registration endpoint with a sample payload
                .post('/api/v1/devices/register')
                .send({
                    deviceId: 'device1',
                    deviceType: 'sensor',
                    publicKey: 'sample-key'
                });
            // expect successful registration to return a 201 status code and the mock response
            // and also verify that the registerDevice controller was called with the correct parameters
            expect(res.status).toBe(201);
            expect(res.body).toEqual(mockResponse);
            expect(controllers.registerDevice).toHaveBeenCalledWith({
                deviceId: 'device1',
                deviceType: 'sensor',
                publicKey: 'sample-key'
            });
        });

        // I also tested the error handling by simulating a controller rejection and checking that the API returns the appropriate error response
        it('should return error if controller throws', async () => {
            controllers.registerDevice.mockRejectedValueOnce({ status: 400, message: 'Invalid payload' });

            const res = await request(app)
                .post('/api/v1/devices/register')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'Invalid payload' });
        });
    });

    // Test the authentication verification endpoint
    describe('POST /api/v1/auth/verify', () => {

        // we test successful authentication verification by mocking the controller to return a success response and checking that the API returns the expected status and body
        it('should successfully verify authentication', async () => {
            controllers.verifyAuthentication.mockResolvedValueOnce({ success: true });

            const res = await request(app)
                .post('/api/v1/auth/verify')
                .send({
                    deviceId: 'device1',
                    nonce: '123',
                    timestamp: '2024-05-31T00:00:00Z',
                    signature: 'sig'
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });
        });
    });

    // Test the device revocation endpoint
    describe('POST /api/v1/devices/revoke', () => {

        // I test the access control for the device revocation endpoint by checking that requests without a valid admin API key are blocked with a 403 status code
        // while requests with the correct key are allowed and return the expected response
        it('should block request if admin API key is missing', async () => {
            const res = await request(app)
                .post('/api/v1/devices/revoke')
                .send({ deviceId: 'device1' });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({ error: 'Forbidden: Invalid or missing admin API key' });
            expect(controllers.revokeDevice).not.toHaveBeenCalled();
        });

        it('should block request if admin API key is incorrect', async () => {
            const res = await request(app)
                .post('/api/v1/devices/revoke')
                .set('x-api-key', 'wrong-key')
                .send({ deviceId: 'device1' });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({ error: 'Forbidden: Invalid or missing admin API key' });
            expect(controllers.revokeDevice).not.toHaveBeenCalled();
        });

        // Finally, I test that a request with the correct admin API key is processed successfully and that the revokeDevice controller is called with the expected parameters
        it('should allow request if admin API key is correct', async () => {
            // By default the admin key is 'iot-admin-key-2024'
            controllers.revokeDevice.mockResolvedValueOnce({ success: true });

            const res = await request(app)
                .post('/api/v1/devices/revoke')
                .set('x-api-key', 'iot-admin-key-2024')
                .send({ deviceId: 'device1' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });
            expect(controllers.revokeDevice).toHaveBeenCalledWith({ deviceId: 'device1' });
    });
    });
});

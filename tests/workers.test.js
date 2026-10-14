const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Server } = require('../src/server');
const source = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0; contract Counter { uint public count; }';

test('real worker threads compile queued and immediate requests within the same limit', async () => {
    const server = new Server(0, { logging: false, minWorkers: 2, maxWorkers: 2, scaleThreshold: 1 });
    const service = server.service;
    try {
        const first = service.compileQueued({ source });
        const second = service.compileQueued({ source });
        const third = service.compileQueued({ source });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(service.workers.size, 2);
        assert.equal(service.getMetrics().activeWorkers, 2);
        assert.equal(service.getMetrics().queueDepth, 1);
        assert.ok([...service.workers].every(worker => worker.threadId > 0));
        const health = await request(server.app).get('/health').expect(200);
        assert.equal(health.body.status, 'healthy');
        const artifacts = await Promise.all([first, second, third]);
        assert.ok(artifacts.every(result => result.contracts[0].bytecode.length > 2));
        assert.equal(service.getMetrics().completed, 3);
        assert.equal(service.workers.size, 0);
    } finally { await server.stop(); }
});

test('worker failures retain diagnostics and release capacity for the next job', async () => {
    const server = new Server(0, { logging: false, maxWorkers: 1 });
    try {
        const failure = server.service.compileQueued({ source: 'contract Broken {' });
        const next = server.service.compileQueued({ source });
        await assert.rejects(failure, error => error.statusCode === 422 && error.diagnostics[0].severity === 'error');
        assert.equal((await next).contracts[0].name, 'Counter');
        assert.equal(server.service.workers.size, 0);
    } finally { await server.stop(); }
});

test('shutdown rejects pending requests and terminates compiler workers', async () => {
    const server = new Server(0, { logging: false, maxWorkers: 1 });
    const pending = [server.service.compileQueued({ source }), server.service.compileQueued({ source })];
    const results = Promise.allSettled(pending);
    await new Promise(resolve => setImmediate(resolve));
    await server.stop();
    assert.ok((await results).every(result => result.status === 'rejected'));
    assert.equal(server.service.workers.size, 0);
    assert.throws(() => server.service.submit({ source }), /closed/);
});

import nock from 'nock';
import myProbotApp from '../src/index.js';
import { Probot, ProbotOctokit } from 'probot';
import fs from 'fs';
import path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';

const privateKey = fs.readFileSync(
	path.join(__dirname, 'fixtures/mock-cert.pem'),
	'utf-8',
);

describe('GitHub Deployment App', () => {
	let probot: any;

	beforeEach(() => {
		nock.disableNetConnect();
		probot = new Probot({
			appId: 456,
			privateKey,
			Octokit: ProbotOctokit.defaults({
				retry: { enabled: false },
				throttle: { enabled: false },
			}),
		});
		probot.load(myProbotApp);
	});

	afterEach(() => {
		nock.cleanAll();
		nock.enableNetConnect();
	});

	test('app loads and can receive webhooks', async () => {
		const mock = nock('https://api.github.com');
		// .post('/app/installations/12345678/access_tokens')
		// .reply(200, { token: 'test' });

		await probot.receive({
			name: 'ping',
			payload: {
				installation: { id: 12345678 },
				repository: {
					owner: { login: 'test-org' },
					name: 'test-repo',
				},
			},
		});

		expect(mock.pendingMocks()).toStrictEqual([]);
	});
});

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../../src/policy/evaluator.js';
import type { PolicyConfig, PolicyContext } from '../../src/policy/types.js';
import * as client from '../../src/client.js';

describe('PolicyEvaluator', () => {
	const baseConfig: PolicyConfig = {
		policy: {
			approval: [],
		},
		approval_rules: [],
	};

	// Mock GitHub context
	const mockGithubContext = {
		repo: vi.fn(),
		octokit: {
			rest: {
				orgs: {
					listMembers: vi.fn(),
				},
				teams: {
					listMembersInOrg: vi.fn(),
				},
			},
		},
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	} as any;

	// Mock client functions
	vi.mock('../../src/client.js', () => ({
		listTeamMembers: vi.fn(),
		listOrganizationMembers: vi.fn(),
	}));

	beforeEach(() => {
		vi.clearAllMocks();
		// Simple mock returns - all users are in all teams/orgs for simplicity
		vi.mocked(client.listTeamMembers).mockResolvedValue([
			{ login: 'test-reviewer', id: 789 } as any,
			{ login: 'team-member', id: 123 } as any,
			{ login: 'test-author', id: 123 } as any,
			{ login: 'reviewer-a', id: 1 } as any,
			{ login: 'reviewer-b', id: 2 } as any,
			{ login: 'trusted-user', id: 123 } as any,
			{ login: 'org-member', id: 123 } as any,
		]);
		vi.mocked(client.listOrganizationMembers).mockResolvedValue([
			{ login: 'test-committer', id: 456 } as any,
			{ login: 'org-member', id: 123 } as any,
			{ login: 'test-author', id: 123 } as any,
			{ login: 'trusted-user', id: 123 } as any,
			{ login: 'test-reviewer', id: 789 } as any,
			{ login: 'team-member', id: 123 } as any,
			{ login: 'reviewer-a', id: 1 } as any,
			{ login: 'reviewer-b', id: 2 } as any,
		]);
	});

	const baseContext: PolicyContext = {
		environment: {
			name: 'production',
		},
		deployment: {
			commit: {
				sha: 'test-sha',
				author: {
					login: 'test-author',
					id: 123,
				},
				committer: {
					login: 'test-committer',
					id: 456,
				},
				verification: {
					verified: true,
					reason: 'valid',
				},
			},
		},
		commits: [
			{
				sha: 'test-sha',
				author: {
					login: 'test-author',
					id: 123,
				},
				committer: {
					login: 'test-committer',
					id: 456,
				},
				verification: {
					verified: true,
					reason: 'valid',
				},
			},
		],
		reviews: [
			{
				id: 1,
				state: 'APPROVED',
				commit_id: 'test-sha',
				submitted_at: '2021-01-01T00:00:00Z',
				user: {
					id: 123,
					login: 'test-reviewer',
				},
			},
		],
	};

	const mockPayload = {
		environment: 'production',
		deployment: {
			sha: 'abc123',
		},
		repository: {
			owner: {
				login: 'test-org',
			},
			name: 'test-repo',
		},
	};

	test('returns false when no approval rules are present', async () => {
		const config: PolicyConfig = {
			policy: {
				approval: [],
			},
			approval_rules: [],
		};

		const context: PolicyContext = {
			environment: {
				name: mockPayload.environment,
			},
			deployment: {
				environment: mockPayload.environment,
				event: 'push',
				commit: {
					sha: mockPayload.deployment.sha,
				},
			},
			reviews: [],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('returns false when approval rules are present but not met', async () => {
		const config: PolicyConfig = {
			policy: {
				approval: ['require_review'],
			},
			approval_rules: [
				{
					name: 'require_review',
					requires: {
						count: 1,
					},
					methods: {
						github_review: true,
					},
				},
			],
		};

		const context: PolicyContext = {
			environment: {
				name: mockPayload.environment,
			},
			deployment: {
				environment: mockPayload.environment,
				event: 'push',
				commit: {
					sha: mockPayload.deployment.sha,
				},
			},
			reviews: [],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('returns true when was_authored_by rule is met', async () => {
		const config: PolicyConfig = {
			policy: {
				approval: ['require_author'],
			},
			approval_rules: [
				{
					name: 'require_author',
					if: {
						was_authored_by: {
							users: ['test-user'],
						},
					},
				},
			],
		};

		const context: PolicyContext = {
			environment: {
				name: mockPayload.environment,
			},
			deployment: {
				environment: mockPayload.environment,
				event: 'push',
				commit: {
					sha: mockPayload.deployment.sha,
				},
			},
			reviews: [],
			commits: [
				{
					sha: 'abc123',
					author: {
						id: 1,
						login: 'test-user',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('returns false when was_authored_by rule is not met', async () => {
		const config: PolicyConfig = {
			policy: {
				approval: ['require_author'],
			},
			approval_rules: [
				{
					name: 'require_author',
					if: {
						was_authored_by: {
							users: ['test-user'],
						},
					},
				},
			],
		};

		const context: PolicyContext = {
			environment: {
				name: mockPayload.environment,
			},
			deployment: {
				environment: mockPayload.environment,
				event: 'push',
				commit: {
					sha: mockPayload.deployment.sha,
				},
			},
			reviews: [],
			commits: [
				{
					sha: 'abc123',
					author: {
						id: 1,
						login: 'different-user',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('evaluates simple OR rule', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['test-rule-1', 'test-rule-2'],
			},
			approval_rules: [
				{
					name: 'test-rule-1',
					requires: {
						count: 1,
						teams: ['test-team'],
					},
					methods: {
						github_review: true,
					},
				},
				{
					name: 'test-rule-2',
					requires: {
						count: 1,
						users: ['test-reviewer'],
					},
					methods: {
						github_review: true,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [
				{
					id: 1,
					user: {
						id: 789,
						login: 'test-reviewer',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('evaluates environment conditions', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['env-rule'],
			},
			approval_rules: [
				{
					name: 'env-rule',
					if: {
						environment: {
							matches: ['production', 'staging'],
						},
					},
					requires: {
						count: 1,
					},
					methods: {
						github_review: true,
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(baseContext)).toBe(false); // No approvals yet
	});

	test('evaluates signature verification conditions', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['sig-rule'],
			},
			approval_rules: [
				{
					name: 'sig-rule',
					if: {
						has_valid_signatures_by: {
							users: ['test-author'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext, console);
		expect(await evaluator.evaluate(baseContext)).toBe(false); // Should fail because no commits have signatures
	});

	test('evaluates team membership conditions', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['team-rule'],
			},
			approval_rules: [
				{
					name: 'team-rule',
					if: {
						was_authored_by: {
							teams: ['test-org/security-team'],
						},
					},
					requires: {
						count: 1,
						teams: ['test-org/security-team'],
					},
					methods: {
						github_review: true,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [
				{
					id: 1,
					user: {
						id: 789,
						login: 'test-reviewer',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [
				{
					...baseContext.deployment!.commit,
					author: {
						id: 123,
						login: 'test-author',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('evaluates was_authored_by conditions', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['author-rule'],
			},
			approval_rules: [
				{
					name: 'author-rule',
					if: {
						was_authored_by: {
							users: ['test-author'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [],
			commits: [
				{
					sha: 'test-sha-1',
					author: {
						id: 123,
						login: 'test-author',
					},
				},
				{
					sha: 'test-sha-2',
					author: {
						id: 123,
						login: 'test-author',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true); // Should pass because all commits are by test-author
	});

	test('evaluates was_authored_by conditions with team requirements', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['author-team-rule'],
			},
			approval_rules: [
				{
					name: 'author-team-rule',
					if: {
						was_authored_by: {
							teams: ['test-org/security-team'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [],
			commits: [
				{
					sha: 'test-sha-1',
					author: {
						id: 123,
						login: 'test-author',
					},
				},
				{
					sha: 'test-sha-2',
					author: {
						id: 456,
						login: 'team-member',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true); // Should pass because all commits are by security-team members
	});

	test('evaluates was_authored_by conditions with organization requirements', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['author-org-rule'],
			},
			approval_rules: [
				{
					name: 'author-org-rule',
					if: {
						was_authored_by: {
							organizations: ['test-org'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [],
			commits: [
				{
					sha: 'test-sha-1',
					author: {
						id: 123,
						login: 'test-author',
					},
				},
				{
					sha: 'test-sha-2',
					author: {
						id: 456,
						login: 'team-member',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true); // Should pass because all commits are by test-org members
	});

	test('evaluates AND conditions with distinct team requirements', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: [
					{
						and: ['rule-1', 'rule-2'],
					},
				],
			},
			approval_rules: [
				{
					name: 'rule-1',
					requires: {
						count: 1,
						teams: ['org/team-a'],
					},
					methods: { github_review: true },
				},
				{
					name: 'rule-2',
					requires: {
						count: 1,
						teams: ['org/team-b'],
					},
					methods: { github_review: true },
				},
			],
		};

		// Only one review from team member, but we need 2 distinct reviews, should fail
		let context: PolicyContext = {
			...baseContext,
			reviews: [
				{
					id: 2,
					user: {
						id: 1,
						login: 'nonexistent-user',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};
		let evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);

		// Add two reviews from team members, should pass
		context = {
			...context,
			reviews: [
				{
					id: 2,
					user: {
						id: 1,
						login: 'reviewer-a',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
				{
					id: 3,
					user: {
						id: 2,
						login: 'reviewer-b',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};
		evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('throws error for non-existent named rule', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['non-existent-rule'],
			},
			approval_rules: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		await expect(() => evaluator.evaluate(baseContext)).rejects.toThrow(
			'Rule "non-existent-rule" not found in configuration',
		);
	});

	// Test cases for better coverage
	test('evaluates environment not_matches condition', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['env-not-match-rule'],
			},
			approval_rules: [
				{
					name: 'env-not-match-rule',
					if: {
						environment: {
							not_matches: ['development'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			environment: {
				name: 'production',
			},
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);

		// Test with excluded environment
		const devContext: PolicyContext = {
			...baseContext,
			environment: {
				name: 'development',
			},
		};
		expect(await evaluator.evaluate(devContext)).toBe(false);
	});

	test('evaluates has_valid_signatures_by with organization requirements', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['sig-org-rule'],
			},
			approval_rules: [
				{
					name: 'sig-org-rule',
					if: {
						has_valid_signatures_by: {
							organizations: ['test-org'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			commits: [
				{
					sha: 'test-sha',
					author: {
						id: 123,
						login: 'test-author',
					},
					committer: {
						id: 456,
						login: 'test-committer',
					},
					verification: {
						verified: true,
						reason: 'valid',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext, console);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('evaluates has_valid_signatures_by with team requirements', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['sig-team-rule'],
			},
			approval_rules: [
				{
					name: 'sig-team-rule',
					if: {
						has_valid_signatures_by: {
							teams: ['test-org/security-team'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			commits: [
				{
					sha: 'test-sha',
					author: {
						id: 123,
						login: 'test-author',
					},
					committer: {
						id: 123,
						login: 'test-author',
					},
					verification: {
						verified: true,
						reason: 'valid',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext, console);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('handles invalid commit verification', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['sig-rule'],
			},
			approval_rules: [
				{
					name: 'sig-rule',
					if: {
						has_valid_signatures_by: {
							users: ['test-author'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			commits: [
				{
					sha: 'test-sha',
					author: {
						id: 123,
						login: 'test-author',
					},
					committer: {
						id: 123,
						login: 'test-author',
					},
					verification: {
						verified: false,
						reason: 'unsigned',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext, console);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('handles missing environment name', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['env-rule'],
			},
			approval_rules: [
				{
					name: 'env-rule',
					if: {
						environment: {
							matches: ['production'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			environment: undefined,
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('handles review comment patterns with regex', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['comment-rule'],
			},
			approval_rules: [
				{
					name: 'comment-rule',
					requires: {
						count: 1,
						users: ['test-reviewer'],
					},
					methods: {
						github_review_comment_patterns: ['/^approve/i'],
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [
				{
					id: 4,
					user: {
						id: 789,
						login: 'test-reviewer',
					},
					state: 'COMMENTED',
					body: 'Approve this change',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
	});

	test('handles invalid regex patterns', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['invalid-regex-rule'],
			},
			approval_rules: [
				{
					name: 'invalid-regex-rule',
					requires: {
						count: 1,
						users: ['test-reviewer'],
					},
					methods: {
						github_review_comment_patterns: ['/[/'],
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			reviews: [
				{
					id: 5,
					user: {
						id: 789,
						login: 'test-reviewer',
					},
					state: 'COMMENTED',
					body: 'test comment',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		await expect(() => evaluator.evaluate(context)).rejects.toThrow(
			'Pattern "/[/" is not a valid regex',
		);
	});

	test('handles empty commits for was_authored_by condition', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['author-rule'],
			},
			approval_rules: [
				{
					name: 'author-rule',
					if: {
						was_authored_by: {
							users: ['test-user'],
						},
					},
					requires: {
						count: 0,
					},
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	test('evaluates OR rule structure', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: [
					{
						or: ['rule-1', 'rule-2'],
					},
				],
			},
			approval_rules: [
				{
					name: 'rule-1',
					requires: {
						count: 2,
						users: ['nonexistent-user'],
					},
					methods: { github_review: true },
				},
				{
					name: 'rule-2',
					requires: {
						count: 0,
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(baseContext)).toBe(true);
	});

	test('evaluates implied OR rule structure', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['rule-1', 'rule-2'],
			},
			approval_rules: [
				{
					name: 'rule-1',
					requires: {
						count: 2,
						users: ['nonexistent-user'],
					},
					methods: { github_review: true },
				},
				{
					name: 'rule-2',
					requires: {
						count: 0,
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(baseContext)).toBe(true);
	});

	test('handles reviews from different commit SHA', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: ['review-rule'],
			},
			approval_rules: [
				{
					name: 'review-rule',
					requires: {
						count: 1,
						users: ['test-reviewer'],
					},
					methods: { github_review: true },
				},
			],
		};

		const context: PolicyContext = {
			...baseContext,
			deployment: {
				commit: {
					sha: 'deployment-sha',
				},
			},
			reviews: [
				{
					id: 6,
					user: {
						id: 789,
						login: 'test-reviewer',
					},
					state: 'APPROVED',
					commit_id: 'different-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
			],
			commits: [],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(false);
	});

	describe('signature validation', () => {
		let mockLogger: any;

		beforeEach(() => {
			mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			};
		});

		const createSignatureConfig = (): PolicyConfig => ({
			policy: {
				approval: ['signature-rule'],
			},
			approval_rules: [
				{
					name: 'signature-rule',
					if: {
						has_valid_signatures_by: {
							users: ['trusted-user'],
						},
					},
				},
			],
		});

		const createSignatureContext = (overrides: any = {}): PolicyContext => ({
			environment: {
				name: 'production',
			},
			deployment: {
				environment: 'production',
				event: 'push',
				commit: {
					sha: 'test-sha',
				},
			},
			commits: [
				{
					sha: 'test-sha',
					verification: {
						verified: true,
						reason: 'valid',
					},
					committer: {
						id: 123,
						login: 'trusted-user',
					},
					...overrides,
				},
			],
			reviews: [],
		});

		test('passes when commit is verified and committer is authorized user', async () => {
			const config = createSignatureConfig();
			const context = createSignatureContext();

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('signed by an authorized user: trusted-user'),
			);
		});

		test('fails when commit is not GitHub-verified', async () => {
			const config = createSignatureConfig();
			const context = createSignatureContext({
				verification: {
					verified: false,
					reason: 'unsigned',
				},
			});

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('signature not verified by GitHub: unsigned'),
			);
		});

		test('fails when committer is not authorized', async () => {
			const config = createSignatureConfig();
			const context = createSignatureContext({
				committer: {
					id: 456,
					login: 'unauthorized-user',
				},
			});

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					'signed by an unauthorized user: unauthorized-user',
				),
			);
		});

		test('fails when committer information is missing', async () => {
			const config = createSignatureConfig();
			const context = createSignatureContext({
				committer: undefined,
			});

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(false);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('has no committer information'),
			);
		});

		test('validates signatures for team members', async () => {
			const config: PolicyConfig = {
				policy: {
					approval: ['team-signature-rule'],
				},
				approval_rules: [
					{
						name: 'team-signature-rule',
						if: {
							has_valid_signatures_by: {
								teams: ['myorg/security-team'],
							},
						},
					},
				],
			};

			const context = createSignatureContext({
				committer: {
					id: 123,
					login: 'team-member',
				},
			});

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('signed by an authorized user: team-member'),
			);
		});

		test('validates signatures for organization members', async () => {
			const config: PolicyConfig = {
				policy: {
					approval: ['org-signature-rule'],
				},
				approval_rules: [
					{
						name: 'org-signature-rule',
						if: {
							has_valid_signatures_by: {
								organizations: ['trusted-org'],
							},
						},
					},
				],
			};

			const context = createSignatureContext({
				committer: {
					id: 123,
					login: 'org-member',
				},
			});

			const evaluator = new PolicyEvaluator(
				config,
				mockGithubContext,
				mockLogger,
			);
			const result = await evaluator.evaluate(context);

			expect(result).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('signed by an authorized user: org-member'),
			);
		});
	});
});

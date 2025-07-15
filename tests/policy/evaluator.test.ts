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
			debug: vi.fn(),
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

	test('evaluates simple AND rule', async () => {
		const config: PolicyConfig = {
			...baseConfig,
			policy: {
				approval: [
					{
						and: ['test-rule-1', 'test-rule-2'],
					},
				],
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
						login: 'team-member',
					},
					state: 'APPROVED',
					commit_id: 'test-sha',
					submitted_at: '2021-01-01T00:00:00Z',
				},
				{
					id: 2,
					user: {
						id: 678,
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

	describe('environment condition', () => {
		test('passes when environment is in matches', async () => {
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
							count: 0,
						},
						methods: {
							github_review: true,
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(baseContext)).toBe(true);
		});

		test('passes when environment is not in not_matches', async () => {
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

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(baseContext)).toBe(true);
		});

		test('fails when environment is not in matches', async () => {
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
							count: 0,
						},
						methods: {
							github_review: true,
						},
					},
				],
			};

			const context: PolicyContext = {
				...baseContext,
				environment: {
					name: 'development',
				},
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when environment is in not_matches', async () => {
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
					name: 'development',
				},
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});
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
						only_has_contributors_in: {
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
					committer: {
						id: 123,
						login: 'test-author',
					},
				},
			],
		};

		const evaluator = new PolicyEvaluator(config, mockGithubContext);
		expect(await evaluator.evaluate(context)).toBe(true);
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
			'Pattern "/[/" is not valid: SyntaxError: Invalid regular expression: /[/: Unterminated character class',
		);
	});

	describe('only_has_contributors_in condition', () => {
		test('passes when all contributors are in allowed users', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_contributors_in: {
								users: ['test-author', 'test-committer'],
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('passes when all contributors are in allowed teams', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						if: {
							only_has_contributors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'team-member',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('passes when all contributors are in allowed organizations', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['org-rule'],
				},
				approval_rules: [
					{
						name: 'org-rule',
						if: {
							only_has_contributors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'org-member',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('fails when contributor is not in allowed users', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_contributors_in: {
								users: ['allowed-user'],
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'unauthorized-user',
						},
						committer: {
							id: 456,
							login: 'unauthorized-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when contributor is not in allowed teams', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						if: {
							only_has_contributors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when contributor is not in allowed organizations', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['org-rule'],
				},
				approval_rules: [
					{
						name: 'org-rule',
						if: {
							only_has_contributors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 999,
							login: 'external-author',
						},
						committer: {
							id: 888,
							login: 'external-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when there are no commits', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_contributors_in: {
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
	});

	describe('only_has_authors_in condition', () => {
		test('passes when all authors are in allowed users', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_authors_in: {
								users: ['test-author', 'second-author'],
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
					{
						sha: 'test-sha-2',
						author: {
							id: 789,
							login: 'second-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('passes when all authors are in allowed teams', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						if: {
							only_has_authors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
					{
						sha: 'test-sha-2',
						author: {
							id: 789,
							login: 'team-member',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('passes when all authors are in allowed organizations', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['org-rule'],
				},
				approval_rules: [
					{
						name: 'org-rule',
						if: {
							only_has_authors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'test-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
					{
						sha: 'test-sha-2',
						author: {
							id: 789,
							login: 'org-member',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(true);
		});

		test('fails when author is not in allowed users', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_authors_in: {
								users: ['allowed-user'],
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
						sha: 'test-sha-1',
						author: {
							id: 123,
							login: 'unauthorized-user',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when author is not in allowed teams', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						if: {
							only_has_authors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 999,
							login: 'external-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when author is not in allowed organizations', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['org-rule'],
				},
				approval_rules: [
					{
						name: 'org-rule',
						if: {
							only_has_authors_in: {
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
						sha: 'test-sha-1',
						author: {
							id: 999,
							login: 'external-author',
						},
						committer: {
							id: 456,
							login: 'test-committer',
						},
					},
				],
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			expect(await evaluator.evaluate(context)).toBe(false);
		});

		test('fails when there are no commits', async () => {
			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['author-rule'],
				},
				approval_rules: [
					{
						name: 'author-rule',
						if: {
							only_has_authors_in: {
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

	describe('API error handling', () => {
		test('handles API errors gracefully and allows other rules to pass', async () => {
			// Mock one function to fail and another to succeed
			vi.mocked(client.listTeamMembers).mockRejectedValue(
				new Error('Team not found'),
			);
			vi.mocked(client.listOrganizationMembers).mockResolvedValue([
				{ login: 'test-reviewer', id: 789 } as any,
			]);

			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule', 'org-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						requires: {
							count: 1,
							teams: ['nonexistent-org/nonexistent-team'],
						},
						methods: {
							github_review: true,
						},
					},
					{
						name: 'org-rule',
						requires: {
							count: 1,
							organizations: ['test-org'],
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
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			const result = await evaluator.evaluate(context);

			// Should pass because the org-rule passes even though team-rule fails
			expect(result).toBe(true);
		});

		test('handles both API errors and continues evaluation', async () => {
			// Mock both functions to fail
			vi.mocked(client.listTeamMembers).mockRejectedValue(
				new Error('Team not found'),
			);
			vi.mocked(client.listOrganizationMembers).mockRejectedValue(
				new Error('Org not found'),
			);

			const config: PolicyConfig = {
				...baseConfig,
				policy: {
					approval: ['team-rule', 'user-rule'],
				},
				approval_rules: [
					{
						name: 'team-rule',
						requires: {
							count: 1,
							teams: ['nonexistent-org/nonexistent-team'],
						},
						methods: {
							github_review: true,
						},
					},
					{
						name: 'user-rule',
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
			};

			const evaluator = new PolicyEvaluator(config, mockGithubContext);
			const result = await evaluator.evaluate(context);

			// Should pass because the user-rule passes even though team-rule fails
			expect(result).toBe(true);
		});
	});

	describe('signature validation', () => {
		let mockLogger: any;

		beforeEach(() => {
			mockLogger = {
				debug: vi.fn(),
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

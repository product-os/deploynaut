import type { Context } from 'probot';
import type {
	PolicyContext,
	ApprovalRule,
	NamedApprovalRule,
	PolicyConfig,
	RuleCondition,
	ApprovalRequirement,
	ApprovalMethods,
} from './types.js';
import { minimatch } from 'minimatch';
import { listTeamMembers, listOrganizationMembers } from '../client.js';

/**
 * Logger interface for outputting evaluation messages
 */
interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * Result type for rule evaluation
 * - true: rule passed
 * - false: rule failed
 * - 'skipped': rule conditions not met, so it was skipped
 */
type RuleResult = boolean | 'skipped';

/**
 * PolicyEvaluator evaluates deployment policies based on configured approval rules
 *
 * The evaluator supports:
 * - OR logic between top-level approval rules
 * - AND logic within rule groups
 * - Conditional rules based on environment, signatures, and authorship
 * - Multiple approval methods (GitHub reviews, comment patterns)
 * - Team, organization, and user-based requirements
 * - Simplified signature validation using GitHub's verification status and committer authorization
 */
export class PolicyEvaluator {
	private config: PolicyConfig;
	private context: PolicyContext;
	private logger: Logger;
	private githubContext: Context;
	/**
	 * Create a new PolicyEvaluator
	 * @param config Policy configuration containing approval rules
	 * @param logger Logger for outputting evaluation messages (defaults to console)
	 */
	constructor(
		config: PolicyConfig,
		githubContext: Context,
		logger: Logger = console,
	) {
		this.config = config;
		this.logger = logger;
		this.githubContext = githubContext;
	}

	/**
	 * Evaluate the policy against the given context
	 * @param context The deployment context containing commits, reviews, environment, etc.
	 * @returns true if policy allows deployment, false otherwise
	 */
	async evaluate(context: PolicyContext): Promise<boolean> {
		this.context = context;
		const approvalRules = this.config.policy.approval;

		// If no approval rules are configured, do not allow deployment
		if (!approvalRules || approvalRules.length === 0) {
			this.logger.warn('No approval rules found - deployment not allowed');
			return false;
		}

		// Evaluate all approval rules (OR logic at top level)
		const result = await this.evaluateRules(approvalRules);
		if (result === false) {
			this.logger.warn('Policy evaluation failed - deployment not allowed');
		}
		return result === true;
	}

	/**
	 * Evaluate a collection of rules using OR logic
	 * @param rules Array of rule names or rule objects to evaluate
	 * @returns 'skipped' if all rules were skipped, otherwise boolean result
	 */
	private async evaluateRules(
		rules: string[] | ApprovalRule[],
	): Promise<RuleResult> {
		// Evaluate each rule in the collection
		const results = await Promise.all(
			rules.map((rule) => this.evaluateRule(rule)),
		);

		// Filter out skipped rules to get actual results
		const nonSkippedResults = results.filter(
			(r): r is boolean => r !== 'skipped',
		);

		// If all rules were skipped, return skipped
		if (nonSkippedResults.length === 0) {
			return 'skipped';
		}

		// For OR logic, return true if any rule passed
		return nonSkippedResults.some((r) => r === true);
	}

	/**
	 * Evaluate a single rule (can be a named rule, AND group, OR group, or array)
	 * @param rule The rule to evaluate
	 * @returns Result of rule evaluation
	 */
	private async evaluateRule(rule: string | ApprovalRule): Promise<RuleResult> {
		this.logger.info(`Evaluating approval: ${JSON.stringify(rule)}`);

		// Handle named rule references
		if (typeof rule === 'string') {
			const namedRule = this.findNamedRule(rule);
			if (!namedRule) {
				this.logger.error(`Rule "${rule}" not found in configuration`);
				throw new Error(`Rule "${rule}" not found in configuration`);
			}
			return await this.evaluateNamedRule(namedRule);
		}

		// Handle AND logic: all sub-rules must pass
		if (rule.and) {
			const results = await Promise.all(
				rule.and.map((subRule) => this.evaluateRule(subRule)),
			);
			const nonSkippedResults = results.filter(
				(r): r is boolean => r !== 'skipped',
			);

			// If all sub-rules were skipped, skip this rule too
			if (nonSkippedResults.length === 0) {
				return 'skipped';
			}

			// For AND logic, all non-skipped rules must pass
			return nonSkippedResults.every((r) => r === true);
		}

		// Handle arrays as OR rules
		if (Array.isArray(rule)) {
			return await this.evaluateRules(rule);
		}

		// Handle explicit OR rules
		if (rule.or) {
			return await this.evaluateRules(rule.or);
		}

		// Unknown rule format
		return false;
	}

	/**
	 * Find a named approval rule by name in the configuration
	 * @param name Name of the rule to find
	 * @returns The named rule if found, undefined otherwise
	 */
	private findNamedRule(name: string): NamedApprovalRule | undefined {
		return this.config.approval_rules.find(
			(rule: NamedApprovalRule) => rule.name === name,
		);
	}

	/**
	 * Evaluate a named approval rule
	 * @param rule The named rule to evaluate
	 * @returns Result of rule evaluation
	 */
	private async evaluateNamedRule(
		rule: NamedApprovalRule,
	): Promise<RuleResult> {
		this.logger.info(`Evaluating rule: ${JSON.stringify(rule)}`);

		// First check if rule conditions are met
		if (rule.if && !(await this.evaluateConditions(rule.if))) {
			this.logger.info(`Rule "${rule.name}" skipped - conditions not met`);
			return 'skipped';
		}

		// If no requirements or count is 0, rule passes automatically
		if (!rule.requires || rule.requires.count < 1) {
			this.logger.info(`Rule "${rule.name}" is satisfied with no requirements`);
			return true;
		}

		// Check if approval requirements are met
		if (!(await this.evaluateRequirements(rule.requires, rule.methods))) {
			this.logger.warn(`Policy requirements not met for rule "${rule.name}"`);
			return false;
		}

		return true;
	}

	/**
	 * Evaluate rule conditions (environment, signatures, authorship)
	 * @param conditions The conditions to evaluate
	 * @returns true if all conditions are met, false otherwise
	 */
	private async evaluateConditions(
		conditions: RuleCondition,
	): Promise<boolean> {
		// Check environment conditions
		if (conditions.environment) {
			const envName = this.context.environment?.name;
			if (!envName) {
				this.logger.warn('No environment name found in context');
				return false;
			}

			// Check if environment matches allowed list
			if (
				conditions.environment.matches &&
				!conditions.environment.matches.includes(envName)
			) {
				this.logger.warn(
					`Environment "${envName}" does not match any allowed environments`,
				);
				return false;
			}

			// Check if environment is in excluded list
			if (conditions.environment.not_matches?.includes(envName)) {
				this.logger.warn(
					`Environment "${envName}" does not match any allowed environments`,
				);
				return false;
			}
		}

		if (conditions.has_valid_signatures_by) {
			const commits = this.context.commits;
			const { users, organizations, teams } =
				conditions.has_valid_signatures_by;

			// Check signature verification using GitHub's verification status
			for (const commit of commits) {
				const isValid = await this.validateCommitSignature(commit, {
					users,
					organizations,
					teams,
				});

				if (!isValid) {
					return false;
				}
			}
		}

		if (conditions.was_authored_by) {
			const { users, organizations, teams } = conditions.was_authored_by;
			const commits = this.context.commits;

			// If there are no commits, return false
			if (commits.length === 0) {
				return false;
			}

			// Check that all commits were authored by the specified users/organizations/teams
			const results = await Promise.all(
				commits.map(
					async (commit: { sha: string; author?: { login?: string } }) => {
						const author = commit.author;
						return this.isUserInAny(
							author?.login ?? '',
							users ?? [],
							organizations ?? [],
							teams ?? [],
						);
					},
				),
			);
			return results.every(Boolean);
		}

		return true;
	}

	private async evaluateRequirements(
		requirements: ApprovalRequirement,
		methods?: ApprovalMethods,
	): Promise<boolean> {
		const { count, teams, users, organizations } = requirements;
		const reviews = this.context.reviews;
		const commits = this.context.commits;
		const deploymentSha = this.context.deployment?.commit?.sha;

		// Filter reviews based on methods and user conditions
		const validReviews = reviews.filter((review) => {
			this.logger.info(`Evaluating review: ${JSON.stringify(review)}`);

			// Check if review is for the current deployment
			if (deploymentSha && review.commit_id !== deploymentSha) {
				this.logger.warn(
					`Review for commit "${review.commit_id}" is not for the current deployment`,
				);
				return false;
			}

			// Check if reviewer is not the author or committer
			for (const commit of commits) {
				if (
					review.user.id === commit.author?.id ||
					review.user.id === commit.committer?.id
				) {
					this.logger.warn(
						`Review for commit "${review.commit_id}" is by the author or committer`,
					);
					return false;
				}
			}

			// Check review state and methods
			if (methods?.github_review) {
				if (review.state === 'APPROVED') {
					return true;
				}
			}

			const configValStart = new RegExp(/^!?\//);
			const configValEnd = new RegExp(/\/i?$/);

			function isRegexPattern(input: string): boolean {
				return (
					typeof input === 'string' &&
					configValStart.test(input) &&
					configValEnd.test(input)
				);
			}

			function parseRegexMatch(input: string): RegExp | null {
				try {
					const regexString = input
						.replace(configValStart, '')
						.replace(configValEnd, '');
					return input.endsWith('i')
						? new RegExp(regexString, 'i')
						: new RegExp(regexString);
				} catch {
					// no-op
				}
				return null;
			}

			// Check for comment patterns
			if (
				methods?.github_review_comment_patterns &&
				review.body &&
				review.state === 'COMMENTED'
			) {
				return methods.github_review_comment_patterns.some((pattern) => {
					// If pattern is wrapped in forward slashes, treat as regex
					if (isRegexPattern(pattern)) {
						const regex = parseRegexMatch(pattern);
						if (!(regex instanceof RegExp)) {
							this.logger.error(`Pattern "${pattern}" is not a valid regex`);
							throw new Error(`Pattern "${pattern}" is not a valid regex`);
						}
						this.logger.info(
							`Regex pattern: ${pattern} match: ${regex.test(review.body ?? '')}`,
						);
						return regex.test(review.body ?? '');
					}

					// Otherwise treat as glob pattern using minimatch
					const re = minimatch.makeRe(pattern, {
						matchBase: true,
						partial: true,
						dot: true,
					});
					if (!(re instanceof RegExp)) {
						this.logger.error(`Pattern "${pattern}" is not a valid glob`);
						throw new Error(`Pattern "${pattern}" is not a valid glob`);
					}
					this.logger.info(
						`Minimatch pattern: ${pattern} match: ${re.test(review.body ?? '')}`,
					);
					return re.test(review.body ?? '');
				});
			}

			this.logger.warn(
				`Review for commit "${review.commit_id}" does not meet the requirements`,
			);
			return false;
		});

		this.logger.info(`Valid reviews: ${validReviews.length}`);

		// Filter by reviews that meet membership requirements
		const reviewChecks = await Promise.all(
			validReviews.map(async (review) => {
				const authorized = await this.isUserInAny(
					review.user.login,
					users ?? [],
					organizations ?? [],
					teams ?? [],
				);
				if (authorized) {
					this.logger.info(
						`Review ${review.id} authored by an authorized user ${review.user.login}`,
					);
				} else {
					this.logger.warn(
						`Review ${review.id} authored by an unauthorized user ${review.user.login}`,
					);
				}
				return authorized;
			}),
		);

		const approvedReviews = validReviews.filter((_, idx) => reviewChecks[idx]);

		return approvedReviews.length >= count;
	}

	private async isUserInAny(
		user: string,
		users: string[],
		organizations: string[],
		teams: string[],
	): Promise<boolean> {
		// Check users list first (synchronous)
		if (users.includes(user)) {
			return true;
		}

		// Check organization memberships
		for (const organization of organizations) {
			if (await this.isUserInOrganization(user, organization)) {
				return true;
			}
		}

		// Check team memberships
		for (const team of teams) {
			if (await this.isUserInTeam(user, team)) {
				return true;
			}
		}

		return false;
	}

	private async isUserInTeam(user: string, team: string): Promise<boolean> {
		const [org, slug] = team.split('/');
		const teamMembers = await listTeamMembers(this.githubContext, org, slug);
		return teamMembers.some((member) => member.login === user);
	}

	private async isUserInOrganization(
		user: string,
		organization: string,
	): Promise<boolean> {
		const organizationMembers = await listOrganizationMembers(
			this.githubContext,
			organization,
		);
		return organizationMembers.some((member) => member.login === user);
	}

	/**
	 * Validate a commit signature using GitHub's verification status and committer field
	 * @param commit The commit to validate
	 * @param policy The signature validation policy
	 * @returns true if signature is valid and authorized
	 */
	private async validateCommitSignature(
		commit: any,
		policy: { users?: string[]; organizations?: string[]; teams?: string[] },
	): Promise<boolean> {
		// Check if GitHub verified the signature
		if (!commit.verification?.verified) {
			this.logger.warn(
				`Commit "${commit.sha}" signature not verified by GitHub: ${commit.verification?.reason ?? 'unknown'}`,
			);
			return false;
		}

		// Get the committer information
		const committer = commit.committer;
		if (!committer) {
			this.logger.warn(`Commit "${commit.sha}" has no committer information`);
			return false;
		}

		// Check if committer is authorized
		const committerLogin = committer.login;

		if (
			await this.isUserInAny(
				committerLogin,
				policy.users ?? [],
				policy.organizations ?? [],
				policy.teams ?? [],
			)
		) {
			this.logger.info(
				`Commit "${commit.sha}" signed by an authorized user: ${committerLogin}`,
			);
			return true;
		}

		this.logger.warn(
			`Commit "${commit.sha}" signed by an unauthorized user: ${committerLogin}`,
		);
		return false;
	}
}

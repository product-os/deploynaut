import { Probot } from "probot";

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    await context.octokit.issues.createComment(issueComment);
  });

  app.on("deployment_protection_rule.requested", async (context) => {
    console.log("Deployment protection rule requested");
    console.log(JSON.stringify(context.payload, null, 2));
  });

  app.on("issue_comment.created", async (context) => {
    console.log("Issue comment created");
    console.log(JSON.stringify(context.payload, null, 2));
  });
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
